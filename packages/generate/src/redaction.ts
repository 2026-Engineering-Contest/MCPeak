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
