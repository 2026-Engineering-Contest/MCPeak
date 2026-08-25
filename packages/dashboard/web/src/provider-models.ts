export type AiProvider = "claude" | "codex";

/** Generate와 repair가 같은 provider별 모델 목록을 쓴다. */
export const MODEL_OPTIONS = {
  codex: [
    ["gpt-5.6-sol", "Sol"],
    ["gpt-5.6-terra", "Terra"],
    ["gpt-5.6-luna", "Luna"],
  ],
  claude: [
    ["sonnet", "Sonnet"],
    ["haiku", "Haiku"],
    ["opus", "Opus"],
  ],
} as const satisfies Record<AiProvider, readonly (readonly [string, string])[]>;
