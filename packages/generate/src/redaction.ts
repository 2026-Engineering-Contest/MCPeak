import {
  DEFAULT_SENSITIVE_KEYS,
  REDACTED,
  type RunnerRedactionOptions,
  type TestSuiteSpec,
} from "@ohmymcp/runner";

export interface RedactedSuite {
  readonly suite: TestSuiteSpec;
  readonly redactedPaths: readonly string[];
}

export function redactAuthoringSuite(
  suite: TestSuiteSpec,
  options?: RunnerRedactionOptions,
): RedactedSuite {
  const copy = structuredClone(suite);
  const paths: string[] = [];
  for (const [index, item] of copy.cases.entries()) {
    if (item.operation.type !== "callTool") continue;
    const before = JSON.stringify(item.operation.input);
    const input = sanitize(item.operation.input, options);
    if (JSON.stringify(input) !== before) paths.push(`cases[${index}].operation.input`);
    item.operation.input = input as typeof item.operation.input;
  }
  return { suite: copy, redactedPaths: paths };
}
export { REDACTED };

/**
 * 민감 키·값 치환의 단일 구현. suite input과 request payload가 같은 규칙을 쓰도록
 * 여기 한 곳에만 둔다. 두 벌로 두면 한쪽만 고쳐져 redaction이 조용히 어긋난다.
 */
export function sanitizeRedactable(value: unknown, options?: RunnerRedactionOptions): unknown {
  return sanitize(value, options);
}
function sanitize(value: unknown, options?: RunnerRedactionOptions): unknown {
  const keys = new Set(DEFAULT_SENSITIVE_KEYS);
  for (const key of options?.sensitiveKeys ?? []) keys.add(normalize(key));
  const sensitiveValues = new Set(options?.sensitiveValues ?? []);
  const visit = (current: unknown): unknown => {
    if (typeof current === "string") return sensitiveValues.has(current) ? REDACTED : current;
    if (current === null || typeof current !== "object") return current;
    if (Array.isArray(current)) return current.map(visit);
    return Object.fromEntries(
      Object.entries(current).map(([key, nested]) => [
        key,
        keys.has(normalize(key)) ? REDACTED : visit(nested),
      ]),
    );
  };
  return visit(value);
}
function normalize(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}
