import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  extractResponseText,
  formatArmorStatus,
  scoreResponseText,
  type ArmorState,
} from "./src/armor.ts";
import { createProfileTool, loadPromptText } from "./src/profile.ts";

const STATUS_KEY = "infinite-gen2";
const PROMPT_SECTION = "infinite_gen2";

/**
 * Register Infinite Generation Two with a Pi API and configure its session hooks.
 *
 * The bundled prompt is verified before registration. Each runtime owns isolated,
 * nonpersistent toggle and verdict state. Pi retains its existing instructions,
 * tools, provider, and approvals; this factory starts no background resources.
 *
 * :param pi: ExtensionAPI; host API for tools, commands, flags, and lifecycle events.
 * return None: void; no value is returned.
 */
export default function infiniteGen2Extension(pi: ExtensionAPI): void {
  const promptText = loadPromptText();
  let state: ArmorState = { enabled: true, running: false, score: null, outcome: null };

  /**
   * Publish the current session state to a Pi context without writing headless output.
   *
   * The keyed UI status is available to interactive and supported RPC clients.
   * Print and JSON modes remain silent and do not need a terminal component.
   *
   * :param ctx: ExtensionContext; current live Pi context and optional UI.
   * return None: void; no value is returned.
   */
  function publishArmorStatus(ctx: ExtensionContext): void {
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, formatArmorStatus(state));
  }

  /**
   * Reset session status from the startup flag and publish the initial state.
   *
   * A new, resumed, forked, or reloaded session does not inherit another session's
   * toggle or response verdict. No historical messages are replayed or persisted.
   *
   * :param ctx: ExtensionContext; new session context receiving the idle status.
   * return None: void; no value is returned.
   */
  function resetArmorStatus(ctx: ExtensionContext): void {
    state = {
      enabled: pi.getFlag("infinite-gen2-off") !== true,
      running: false,
      score: null,
      outcome: null,
    };
    publishArmorStatus(ctx);
  }

  pi.registerFlag("infinite-gen2-off", {
    type: "boolean",
    default: false,
    description: "Start Infinite Generation Two with prompt injection and monitoring disabled",
  });
  pi.registerTool(createProfileTool(promptText));

  pi.registerCommand("infinite-gen2", {
    description: "Show or change Infinite Generation Two status: on | off | status",
    /**
     * Apply a status command and report the result without starting a model turn.
     *
     * Changes affect future runs, not instructions already sent to a provider.
     * Invalid arguments leave state unchanged. Headless reporting uses a custom
     * message with no continuation request instead of unsolicited console output.
     *
     * :param args: string; on, off, status, or empty input for status.
     * :param ctx: ExtensionCommandContext; command's current session and UI context.
     * return None: Promise<void>; no value is returned.
     */
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase() || "status";
      let message: string;
      if (action === "on" || action === "off") {
        state = { ...state, enabled: action === "on", score: null, outcome: null };
        publishArmorStatus(ctx);
        message = formatArmorStatus(state);
      } else if (action === "status") {
        message = formatArmorStatus(state);
      } else {
        message = "Usage: /infinite-gen2 [on|off|status]";
      }
      if (ctx.hasUI) {
        ctx.ui.notify(message, action === "on" || action === "off" || action === "status" ? "info" : "warning");
      } else {
        pi.sendMessage({
          customType: "infinite-gen2-status",
          content: message,
          display: true,
        }, { triggerTurn: false });
      }
    },
  });

  pi.on("session_start", (_event, ctx) => resetArmorStatus(ctx));
  pi.on("session_tree", (_event, ctx) => {
    state = { ...state, running: false, score: null, outcome: null };
    publishArmorStatus(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  pi.on("before_agent_start", (event) => {
    if (state.enabled) {
      event.systemPromptOptions.sections[PROMPT_SECTION] = promptText;
    } else {
      delete event.systemPromptOptions.sections[PROMPT_SECTION];
    }
  });

  pi.on("agent_start", (_event, ctx) => {
    state = { ...state, running: true, score: null, outcome: null };
    publishArmorStatus(ctx);
  });
  pi.on("message_end", (event, ctx) => {
    if (!state.enabled || event.message.role !== "assistant") return;
    const message = event.message;
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      state = { ...state, score: null, outcome: message.stopReason };
    } else {
      const text = extractResponseText(message.content);
      if (!text.trim()) return;
      state = { ...state, score: scoreResponseText(text), outcome: null };
    }
    publishArmorStatus(ctx);
  });
  pi.on("session_compact_failed", (event, ctx) => {
    if (!state.enabled || !state.running || event.reason === "manual") return;
    state = { ...state, score: null, outcome: event.aborted ? "aborted" : "error" };
    publishArmorStatus(ctx);
  });
  pi.on("agent_settled", (_event, ctx) => {
    state = { ...state, running: false };
    publishArmorStatus(ctx);
  });
}
