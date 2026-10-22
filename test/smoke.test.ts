import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = fileURLToPath(new URL(
  "../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js", import.meta.url,
));

test("Pi installs and discovers a local package without changing user settings", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "infinite-gen2-install-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = {
    cwd: directory,
    env: { ...process.env, PI_CODING_AGENT_DIR: join(directory, "agent"), PI_OFFLINE: "1" },
    encoding: "utf8" as const,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  };
  const installed = spawnSync(process.execPath, [cli, "install", root, "--no-approve"], options);
  assert.equal(installed.error, undefined);
  assert.equal(installed.status, 0, installed.stderr);
  const loaded = spawnSync(process.execPath, [
    cli, "--offline", "--no-skills", "--no-prompt-templates", "--no-themes",
    "--no-context-files", "--no-approve", "--help",
  ], options);
  assert.equal(loaded.error, undefined);
  assert.equal(loaded.status, 0, loaded.stderr);
  assert.match(loaded.stdout, /--infinite-gen2-off/);
});

for (const entry of [root, join(root, "index.ts")]) {
  test(`Pi CLI loads ${entry === root ? "the package manifest" : "the explicit extension"} offline`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "infinite-gen2-cli-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const result = spawnSync(process.execPath, [
      cli, "--offline", "--no-extensions", "--no-skills", "--no-prompt-templates",
      "--no-themes", "--no-context-files", "--no-approve", "--extension", entry, "--help",
    ], {
      cwd: directory,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: join(directory, "agent"),
        PI_OFFLINE: "1",
      },
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--infinite-gen2-off/);
    assert.doesNotMatch(result.stderr, /failed to load|extension error|cannot find/i);
  });
}
