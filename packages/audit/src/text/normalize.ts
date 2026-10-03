import type { TextForm } from "../types.js";

export interface NormalizedText {
  readonly forms: ReadonlyArray<{ readonly form: TextForm; readonly text: string }>;
}

export function normalizeText(_raw: string): NormalizedText {
  throw new Error("not implemented");
}
