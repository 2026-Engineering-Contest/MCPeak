export const LATEST_SENSITIVE_KEYS_VERSION: 1;

export function sensitiveKeysOf(version: number): readonly string[];
export function keyWords(key: string): string[];
export function sensitiveKeyIn(keys: readonly string[], key: string): boolean;
