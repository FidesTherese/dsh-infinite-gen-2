export type ResponseScore = {
  verdict: "pass" | "refusal" | "fallback";
  words: string[];
};

export type ArmorState = {
  enabled: boolean;
  running: boolean;
  score: ResponseScore | null;
  outcome: "error" | "aborted" | null;
};

// Preserve the upstream phrase lists and 12-character exclusion window.
const REFUSAL_MARKERS = [
  "i cannot assist", "i can't assist", "i won't help",
  "cannot provide", "can't provide", "unable to provide",
  "not able to assist", "not able to help", "refuse to",
  "i must refuse", "i'm sorry, i can't", "i'm sorry, i cannot",
  "i'm sorry, but i can't", "as an ai language model",
  "as an ai assistant", "out of my scope", "against my policy",
  "抱歉，我不能", "抱歉，我无法", "很抱歉，我",
  "我无法满足", "无法满足你的", "不能满足你的",
  "我不能协助", "无法协助", "不能协助你",
  "我无法提供", "无法提供任何", "无法提供具体",
  "无法帮你", "不能帮你", "我无法完成", "不能完成这个",
  "我不能这么做", "我不能做这件事", "我不能回答", "无法回答",
  "拒绝回答", "拒绝提供", "不予提供", "不予协助",
  "请理解我不能", "作为AI语言模型", "作为人工智能助手",
  "这超出了我的能力", "不在我的能力范围",
  "出于安全考虑", "出于安全原因", "涉及敏感内容", "违反规定", "不合规",
];
const FALLBACK_MARKERS = [
  "instead, i can", "instead i can", "我只能提供", "可改为", "改为授权",
  "合法替代", "安全替代", "建议通过合法",
];
const NON_REFUSAL_TAIL = [
  "保证", "确定", "避免", "预测", "承诺", "guarantee", "predict", "avoid",
];

/**
 * Extract displayable response text from content blocks and return their joined text.
 *
 * Only string-valued text blocks contribute to the result. Thinking, image,
 * tool-call, null, and malformed content is ignored rather than misclassified.
 *
 * :param content: unknown; provider message content to inspect defensively.
 * return text: string; valid text blocks joined by newlines, or an empty string.
 */
export function extractResponseText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
}

/**
 * Find inherited markers in folded response text and return the matching labels.
 *
 * Matches are non-overlapping per marker. The next twelve characters exclude
 * non-refusal continuations; repeated valid occurrences retain repeated labels.
 *
 * :param text: string; lowercase response text to search.
 * :param markers: readonly string[]; phrases in inherited detection order.
 * return matches: string[]; original marker labels for accepted occurrences.
 */
function findMarkerMatches(text: string, markers: readonly string[]): string[] {
  const matches: string[] = [];
  for (const marker of markers) {
    const key = marker.toLowerCase();
    let from = 0;
    for (;;) {
      const index = text.indexOf(key, from);
      if (index === -1) break;
      const tail = text.slice(index + key.length, index + key.length + 12);
      if (!NON_REFUSAL_TAIL.some((ending) => tail.includes(ending))) matches.push(marker);
      from = index + key.length;
    }
  }
  return matches;
}

/**
 * Classify a response string and return its inherited phrase-based verdict.
 *
 * Refusal markers take precedence over fallback markers. At most three matching
 * labels are returned. This heuristic observes wording, not model effectiveness.
 *
 * :param text: string; completed assistant text to classify.
 * return score: ResponseScore; verdict and up to three matching marker labels.
 */
export function scoreResponseText(text: string): ResponseScore {
  const folded = text.toLowerCase();
  const refusal = findMarkerMatches(folded, REFUSAL_MARKERS);
  const fallback = findMarkerMatches(folded, FALLBACK_MARKERS);
  return {
    verdict: refusal.length ? "refusal" : fallback.length ? "fallback" : "pass",
    words: refusal.concat(fallback).slice(0, 3),
  };
}

/**
 * Format extension state and return a compact English status label.
 *
 * Disabled and running states take precedence over previous outcomes. Errors and
 * aborts never appear as passing; scored results are explicitly labeled heuristic.
 *
 * :param state: ArmorState; current session-local enablement and response state.
 * return label: string; plain text suitable for Pi's keyed status UI.
 */
export function formatArmorStatus(state: ArmorState): string {
  const prefix = "Infinite Gen 2: ";
  if (!state.enabled) return prefix + "off";
  if (state.running) return prefix + "thinking";
  if (state.outcome) return prefix + state.outcome;
  if (!state.score) return prefix + "on";
  const marker = state.score.words[0];
  return `${prefix}${state.score.verdict} (heuristic)${marker ? `: ${marker}` : ""}`;
}
