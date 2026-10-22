import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type MessageEndEvent,
} from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { extractResponseText, formatArmorStatus, scoreResponseText } from "../src/armor.ts";
import { createProfileTool, loadPromptText } from "../src/profile.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const promptUrl = new URL("../prompts/infinite-gen-2.md", import.meta.url);
const expectedHash = "02679eb726507d5a6bfe0a327c8469965440be7a7c5104cab57b8d1e529ec466";

/**
 * Create an isolated real Pi session for a test and return its observable boundaries.
 *
 * The loader, runner, command dispatcher, and tool registry are real. Only the UI
 * output sink is replaced; no prompt reaches a model or the user's agent files.
 * Cleanup disposes the session and removes its temporary directory.
 *
 * :param t: TestContext; owner of cleanup and diagnostic assertions.
 * :param disabled: boolean; initial value of the extension's off flag.
 * :param withUI: boolean; whether Pi exposes an observable UI sink.
 * return fixture: Promise<object>; real session, runner, status, and notifications.
 */
async function createFixture(t: TestContext, disabled = false, withUI = true) {
  const directory = await mkdtemp(join(tmpdir(), "infinite-gen2-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const agentDir = join(directory, "agent");
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
  });
  const loader = new DefaultResourceLoader({
    cwd: directory,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalExtensionPaths: [join(root, "index.ts")],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, [], "the native Pi loader must accept the extension");
  assert.equal(loader.getExtensions().extensions.length, 1);
  assert.deepEqual(loader.getPrompts().prompts, [], "the system asset is not a slash-command template");
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
    modelsStorePath: join(agentDir, "models-cache.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const { session } = await createAgentSession({
    cwd: directory,
    agentDir,
    resourceLoader: loader,
    modelRuntime,
    sessionManager: SessionManager.inMemory(directory),
    settingsManager,
    noTools: "builtin",
  });
  t.after(() => session.dispose());
  const runner = session.extensionRunner;
  const errors: string[] = [];
  t.after(() => assert.deepEqual(errors, [], "Pi must not swallow extension failures"));
  runner.setFlagValue("infinite-gen2-off", disabled);
  const statuses = new Map<string, string | undefined>();
  const notifications: string[] = [];
  await session.bindExtensions({
    mode: withUI ? "tui" : "print",
    uiContext: withUI ? {
      ...runner.getUIContext(),
      setStatus: (key, text) => { statuses.set(key, text); },
      notify: (text) => { notifications.push(text); },
    } : undefined,
    onError: (error) => { errors.push(error.error); },
  });
  return { session, runner, statuses, notifications };
}

/**
 * Build a complete assistant message event from text and return its Pi event value.
 *
 * The fixture includes protocol metadata so the test follows the same contract
 * as actual message_end events rather than relying on partial unknown objects.
 *
 * :param text: string; assistant-visible text to score.
 * :param stopReason: string; finalized outcome to exercise.
 * return event: MessageEndEvent; completed assistant event with zero usage.
 */
function createAssistantEvent(
  text: string,
  stopReason: "stop" | "toolUse" | "error" | "aborted" = "stop",
): MessageEndEvent & { message: Extract<MessageEndEvent["message"], { role: "assistant" }> } {
  return {
    type: "message_end",
    message: {
      role: "assistant",
      content: text ? [{ type: "text", text }] : [],
      api: "openai-completions",
      provider: "test",
      model: "test",
      usage: {
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason,
      timestamp: 0,
    },
  };
}

test("the bundled prompt retains its original raw bytes", async () => {
  const bytes = await readFile(promptUrl);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHash);
  assert.equal(loadPromptText(), bytes.toString("utf8"));
});

test("the prompt loader rejects changed and missing assets", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "infinite-gen2-asset-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const changed = pathToFileURL(join(directory, "changed.md"));
  await writeFile(changed, "changed prompt");
  assert.throws(() => loadPromptText(changed), /integrity/i);
  assert.throws(() => loadPromptText(pathToFileURL(join(directory, "missing.md"))), /ENOENT/);
});

for (const [text, verdict, words] of [
  ["Here is the implementation.", "pass", []],
  ["I CANNOT ASSIST with that.", "refusal", ["i cannot assist"]],
  ["我不能协助这个请求。", "refusal", ["我不能协助"]],
  ["Instead, I can show a different example.", "fallback", ["instead, i can"]],
  ["我只能提供一个替代方案。", "fallback", ["我只能提供"]],
  ["I cannot assist; instead, I can explain.", "refusal", ["i cannot assist", "instead, i can"]],
  ["I cannot assist guarantee", "pass", []],
  ["无法保证结果，不能确定时间。", "pass", []],
] as const) {
  test(`response scoring preserves the inherited heuristic for ${JSON.stringify(text)}`, () => {
    assert.deepEqual(scoreResponseText(text), { verdict, words });
  });
}

test("response scoring caps reported matches at three", () => {
  assert.deepEqual(scoreResponseText("i cannot assist. i cannot assist. i cannot assist. i cannot assist."), {
    verdict: "refusal", words: ["i cannot assist", "i cannot assist", "i cannot assist"],
  });
});

test("text extraction excludes thinking, tools, and malformed blocks", () => {
  assert.equal(extractResponseText([
    { type: "thinking", thinking: "i cannot assist" },
    { type: "text", text: "First" },
    { type: "toolCall", name: "read", arguments: {} },
    null,
    { type: "text", text: 42 },
    { type: "text", text: "Second" },
  ]), "First\nSecond");
  assert.equal(extractResponseText(undefined), "");
  assert.equal(extractResponseText("not a block list"), "");
});

test("status formatting prioritizes disabled and busy over previous outcomes", () => {
  const state = { enabled: true, running: false, score: null, outcome: null } as const;
  assert.equal(formatArmorStatus(state), "Infinite Gen 2: on");
  assert.equal(formatArmorStatus({ ...state, running: true }), "Infinite Gen 2: thinking");
  assert.equal(formatArmorStatus({ ...state, enabled: false, running: true }), "Infinite Gen 2: off");
  assert.equal(formatArmorStatus({ ...state, outcome: "error" }), "Infinite Gen 2: error");
  assert.equal(formatArmorStatus({ ...state, outcome: "aborted" }), "Infinite Gen 2: aborted");
  assert.equal(formatArmorStatus({ ...state, score: { verdict: "pass", words: [] } }), "Infinite Gen 2: pass (heuristic)");
});

test("Pi inserts exactly the unchanged section without replacing other instructions", async (t) => {
  const { runner } = await createFixture(t);
  const options = {
    cwd: root,
    customPrompt: "Pi base instructions",
    sections: { another_extension: "Keep this section" },
  };
  const first = await runner.emitBeforeAgentStart("test", undefined, options);
  assert.equal(first.systemPromptOptions.customPrompt, "Pi base instructions");
  assert.equal(first.systemPromptOptions.forceSystemPrompt, undefined);
  assert.equal(first.systemPromptOptions.sections.another_extension, "Keep this section");
  assert.equal(first.systemPromptOptions.sections.infinite_gen2, (await readFile(promptUrl)).toString("utf8"));
  const second = await runner.emitBeforeAgentStart("again", undefined, first.systemPromptOptions);
  assert.equal(second.systemPromptOptions.sections.infinite_gen2, first.systemPromptOptions.sections.infinite_gen2);
  assert.deepEqual(Object.keys(second.systemPromptOptions.sections).sort(), ["another_extension", "infinite_gen2"]);
});

test("the registered profile tool returns schema-valid, unchanged prompt data", async (t) => {
  const { runner, session } = await createFixture(t);
  assert.ok(session.getActiveToolNames().includes("infinite_gen2_profile"));
  const tool = runner.getToolDefinition("infinite_gen2_profile");
  assert.ok(tool);
  const result = await tool.execute("profile-test", {}, undefined, undefined, runner.createToolContext("profile-test", undefined));
  assert.ok(tool.outputSchema);
  assert.equal(Value.Check(tool.outputSchema, result.structuredContent), true);
  const data = result.structuredContent as Record<string, unknown>;
  assert.equal(data.prompt, (await readFile(promptUrl)).toString("utf8"));
  assert.equal(data.promptSha256, expectedHash);
  assert.equal(data.version, "0.3.0");
  assert.equal(data.promptVersion, "0.2.3");
  assert.equal(data.displayName, "无限二代");
  assert.deepEqual(data.strengthCalibration, { v4Obey: 100, infiniteGen2: 85, infiniteGen1: 60 });
  assert.deepEqual(result.details, data);
  assert.equal(result.content[0].type, "text");
  if (result.content[0].type === "text") assert.deepEqual(JSON.parse(result.content[0].text), data);
  assert.equal(Value.Check(tool.parameters, { unexpected: true }), false);
});

test("profile results do not share mutable metadata arrays", async () => {
  const tool = createProfileTool(loadPromptText());
  const first = await tool.execute("first", {}, undefined, undefined, {} as never);
  first.details.lineage.push("mutated");
  const second = await tool.execute("second", {}, undefined, undefined, {} as never);
  assert.deepEqual(second.details.lineage, ["deepseek-unrestricted-v4-obey", "gpt-5.6-sol-unrestricted (v35)"]);
});

test("on/off commands affect only the owned section and never start a model turn", async (t) => {
  const { session, runner, statuses } = await createFixture(t);
  await session.prompt("/infinite-gen2 off");
  assert.equal(statuses.get("infinite-gen2"), "Infinite Gen 2: off");
  const disabled = await runner.emitBeforeAgentStart("test", undefined, {
    cwd: root,
    sections: { infinite_gen2: "stale section", other: "preserve" },
  });
  assert.deepEqual(disabled.systemPromptOptions.sections, { other: "preserve" });
  assert.equal(session.messages.filter((message) => message.role === "user").length, 0);
  assert.ok(runner.getToolDefinition("infinite_gen2_profile"));
  await session.prompt("/infinite-gen2 ON");
  const enabled = await runner.emitBeforeAgentStart("test", undefined, { cwd: root });
  assert.equal(enabled.systemPromptOptions.sections.infinite_gen2, loadPromptText());
});

test("invalid commands report usage without changing enablement", async (t) => {
  const { session, statuses, notifications } = await createFixture(t);
  await session.prompt("/infinite-gen2 invalid");
  assert.match(notifications.at(-1) ?? "", /Usage: \/infinite-gen2/);
  assert.equal(statuses.get("infinite-gen2"), "Infinite Gen 2: on");
  await session.prompt("/infinite-gen2");
  assert.equal(notifications.at(-1), "Infinite Gen 2: on");
});

test("the startup flag disables injection and session reset restores its default", async (t) => {
  const { session, runner, statuses } = await createFixture(t, true);
  const result = await runner.emitBeforeAgentStart("test", undefined, { cwd: root });
  assert.equal(result.systemPromptOptions.sections.infinite_gen2, undefined);
  await session.prompt("/infinite-gen2 on");
  assert.equal(statuses.get("infinite-gen2"), "Infinite Gen 2: on");
  await runner.emit({ type: "session_start", reason: "new" });
  assert.equal(statuses.get("infinite-gen2"), "Infinite Gen 2: off");
});

test("busy status lasts until settlement and ignores user/tool text", async (t) => {
  const { runner, statuses } = await createFixture(t);
  await runner.emit({ type: "agent_start" });
  await runner.emitMessageEnd({ type: "message_end", message: { role: "user", content: "i cannot assist", timestamp: 0 } });
  await runner.emitMessageEnd(createAssistantEvent("Here is the code."));
  await runner.emit({ type: "agent_end", messages: [] });
  assert.equal(statuses.get("infinite-gen2"), "Infinite Gen 2: thinking");
  await runner.emit({ type: "agent_settled" });
  assert.equal(statuses.get("infinite-gen2"), "Infinite Gen 2: pass (heuristic)");
  await runner.emit({ type: "agent_start" });
  await runner.emitMessageEnd(createAssistantEvent("i cannot assist"));
  await runner.emit({ type: "agent_settled" });
  assert.equal(statuses.get("infinite-gen2"), "Infinite Gen 2: refusal (heuristic): i cannot assist");
});

for (const outcome of ["error", "aborted"] as const) {
  test(`${outcome} outcomes do not receive a passing score`, async (t) => {
    const { runner, statuses } = await createFixture(t);
    await runner.emit({ type: "agent_start" });
    await runner.emitMessageEnd(createAssistantEvent("Earlier text."));
    await runner.emitMessageEnd(createAssistantEvent("", outcome));
    await runner.emit({ type: "agent_settled" });
    assert.equal(statuses.get("infinite-gen2"), `Infinite Gen 2: ${outcome}`);
  });
}

test("tool-only replies do not produce a passing verdict", async (t) => {
  const { runner, statuses } = await createFixture(t);
  await runner.emit({ type: "agent_start" });
  const event = createAssistantEvent("", "toolUse");
  event.message.content = [{ type: "toolCall", id: "call", name: "read", arguments: { path: "test" } }];
  await runner.emitMessageEnd(event);
  await runner.emit({ type: "agent_settled" });
  assert.equal(statuses.get("infinite-gen2"), "Infinite Gen 2: on");
});

test("tree changes clear stale verdicts and shutdown removes the status", async (t) => {
  const { runner, statuses } = await createFixture(t);
  await runner.emitMessageEnd(createAssistantEvent("i cannot assist"));
  await runner.emit({ type: "session_tree", newLeafId: null, oldLeafId: null });
  assert.equal(statuses.get("infinite-gen2"), "Infinite Gen 2: on");
  await runner.emit({ type: "session_shutdown", reason: "quit" });
  assert.equal(statuses.get("infinite-gen2"), undefined);
});

test("headless commands report through custom messages without model calls", async (t) => {
  const { session, runner, statuses } = await createFixture(t, false, false);
  await session.prompt("/infinite-gen2 off");
  assert.equal(statuses.size, 0);
  assert.ok(session.messages.some((message) => message.role === "custom"));
  const options = await runner.emitBeforeAgentStart("test", undefined, { cwd: root });
  assert.equal(options.systemPromptOptions.sections.infinite_gen2, undefined);
});

for (const aborted of [true, false]) {
  test(`automatic compaction ${aborted ? "cancellation" : "failure"} replaces a prior pass`, async (t) => {
    const { runner, statuses } = await createFixture(t);
    await runner.emit({ type: "agent_start" });
    await runner.emitMessageEnd(createAssistantEvent("Completed response."));
    await runner.emit({
      type: "session_compact_failed", reason: "threshold", aborted,
      willRetry: false, fromExtension: false,
    });
    await runner.emit({ type: "agent_settled" });
    assert.equal(statuses.get("infinite-gen2"), `Infinite Gen 2: ${aborted ? "aborted" : "error"}`);
  });
}

test("idle manual compaction does not replace a completed verdict", async (t) => {
  const { runner, statuses } = await createFixture(t);
  await runner.emitMessageEnd(createAssistantEvent("Completed response."));
  await runner.emit({
    type: "session_compact_failed", reason: "manual", aborted: true,
    willRetry: false, fromExtension: false,
  });
  assert.equal(statuses.get("infinite-gen2"), "Infinite Gen 2: pass (heuristic)");
});

test("on and off/on commands preserve an active run until settlement", async (t) => {
  const { session, runner, statuses } = await createFixture(t);
  await runner.emit({ type: "agent_start" });
  await session.prompt("/infinite-gen2 on");
  assert.equal(statuses.get("infinite-gen2"), "Infinite Gen 2: thinking");
  await session.prompt("/infinite-gen2 off");
  assert.equal(statuses.get("infinite-gen2"), "Infinite Gen 2: off");
  await session.prompt("/infinite-gen2 on");
  assert.equal(statuses.get("infinite-gen2"), "Infinite Gen 2: thinking");
  await runner.emit({ type: "agent_settled" });
  assert.equal(statuses.get("infinite-gen2"), "Infinite Gen 2: on");
});

test("enabling during an initially disabled run still shows busy", async (t) => {
  const { session, runner, statuses } = await createFixture(t, true);
  await runner.emit({ type: "agent_start" });
  await runner.emitMessageEnd(createAssistantEvent("i cannot assist"));
  assert.equal(statuses.get("infinite-gen2"), "Infinite Gen 2: off");
  await session.prompt("/infinite-gen2 on");
  assert.equal(statuses.get("infinite-gen2"), "Infinite Gen 2: thinking");
  await runner.emit({ type: "agent_settled" });
  assert.equal(statuses.get("infinite-gen2"), "Infinite Gen 2: on");
});

test("independent sessions do not share toggle state", async (t) => {
  const first = await createFixture(t);
  const second = await createFixture(t);
  await first.session.prompt("/infinite-gen2 off");
  const result = await second.runner.emitBeforeAgentStart("test", undefined, { cwd: root });
  assert.equal(result.systemPromptOptions.sections.infinite_gen2, loadPromptText());
});
