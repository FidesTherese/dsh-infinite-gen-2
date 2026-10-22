import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

const PROMPT_SHA256 = "02679eb726507d5a6bfe0a327c8469965440be7a7c5104cab57b8d1e529ec466";
const PROFILE_PARAMETERS = Type.Object({}, { additionalProperties: false });
const PROFILE_SCHEMA = Type.Object({
  name: Type.Literal("infinite-gen-2"),
  displayName: Type.String(),
  version: Type.String(),
  promptVersion: Type.String(),
  baseline: Type.String(),
  lineage: Type.Array(Type.String()),
  strengthCalibration: Type.Object({
    v4Obey: Type.Number(),
    infiniteGen2: Type.Number(),
    infiniteGen1: Type.Number(),
  }),
  stabilityFeatures: Type.Array(Type.String()),
  prompt: Type.String(),
  promptSha256: Type.String(),
}, { additionalProperties: false });

export type InfiniteGen2Profile = Static<typeof PROFILE_SCHEMA>;

/**
 * Load a bundled prompt URL and return its integrity-verified UTF-8 text.
 *
 * SHA-256 is checked against the original Git asset before decoding. Missing
 * files raise filesystem errors; changed bytes raise an integrity error. The
 * loader never trims, translates, or normalizes the prompt.
 *
 * :param promptUrl: URL; local asset URL, defaulting to the bundled prompt.
 * return promptText: string; exact original prompt decoded as UTF-8.
 */
export function loadPromptText(
  promptUrl: URL = new URL("../prompts/infinite-gen-2.md", import.meta.url),
): string {
  const bytes = readFileSync(promptUrl);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== PROMPT_SHA256) {
    throw new Error("Infinite Gen 2 prompt integrity check failed: the bundled prompt must remain unchanged.");
  }
  return bytes.toString("utf8");
}

/**
 * Build a profile from verified prompt text and return fresh metadata.
 *
 * The adapter version is separate from the unchanged upstream prompt version.
 * Legacy calibration labels describe upstream claims, not measured performance.
 * Every call owns new arrays and objects so consumer mutations cannot leak.
 *
 * :param promptText: string; unchanged prompt obtained from the integrity loader.
 * return profile: InfiniteGen2Profile; serializable metadata and original prompt.
 */
export function buildProfile(promptText: string): InfiniteGen2Profile {
  return {
    name: "infinite-gen-2",
    displayName: "无限二代",
    version: "0.3.0",
    promptVersion: "0.2.3",
    baseline: "deepseek-unrestricted-v5-stable (dsh-deepseek-v4-obey)",
    lineage: ["deepseek-unrestricted-v4-obey", "gpt-5.6-sol-unrestricted (v35)"],
    strengthCalibration: { v4Obey: 100, infiniteGen2: 85, infiniteGen1: 60 },
    stabilityFeatures: [
      "fixed precedence ladder",
      "task-class templates",
      "placeholder normalization",
      "bilingual routing",
      "canned deterministic workflows",
      "web-pentest routing + canned slots",
      "no-refusal-string hard rules",
      "no-loop / no-followup anchor",
    ],
    prompt: promptText,
    promptSha256: PROMPT_SHA256,
  };
}

/**
 * Create a Pi profile tool from prompt text and return its native definition.
 *
 * The read-only tool remains available when injection is disabled. Model text,
 * rendering details, and structured JSON contain the same schema-checked value;
 * execution makes no model call, filesystem mutation, or follow-up request.
 *
 * :param promptText: string; verified prompt captured for this extension runtime.
 * return tool: ToolDefinition; parameterless, directly callable profile tool.
 */
export function createProfileTool(
  promptText: string,
): ToolDefinition<typeof PROFILE_PARAMETERS, InfiniteGen2Profile> {
  return {
    name: "infinite_gen2_profile",
    label: "Infinite Gen 2 profile",
    description: "Return the unchanged bundled Infinite Generation Two system prompt and upstream calibration metadata.",
    parameters: PROFILE_PARAMETERS,
    outputSchema: PROFILE_SCHEMA,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    /**
     * Return a fresh profile result for the bundled prompt.
     *
     * This operation has no arguments or external side effects and exposes the
     * same value to the model, UI, and programmatic tool callers.
     *
     * return result: Promise<AgentToolResult<InfiniteGen2Profile>>; complete profile result.
     */
    async execute() {
      const profile = buildProfile(promptText);
      return {
        content: [{ type: "text", text: JSON.stringify(profile) }],
        details: profile,
        structuredContent: profile,
      };
    },
  };
}
