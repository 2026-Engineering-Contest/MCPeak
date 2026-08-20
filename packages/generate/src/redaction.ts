import {
  DEFAULT_SENSITIVE_KEYS,
  REDACTED,
  type RunnerRedactionOptions,
  type TestSuiteSpec,
} from "@mcpeak/runner";

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
 * 값 기반 치환에서 제외할 경로를 판정한다. 경로는 root 기준 `cases[0].operation.tool` 꼴이다.
 * suite id나 툴 이름이 [REDACTED]로 바뀌면 suite identity 대조와 툴 allowlist가 깨져
 * 정상 요청이 invalid로 떨어진다. 그래서 계약 식별자는 값 치환 대상에서 뺀다.
 */
export type RedactionPathGuard = (path: string) => boolean;
/** provider 요청에 실어 보내는 suite에서 값 치환을 적용하지 않는 계약 식별자 경로. */
export const SUITE_CONTRACT_PATHS: RedactionPathGuard = (path) =>
  /^(id|schemaVersion)$/.test(path) ||
  /^cases\[\d+\]\.(id|name)$/.test(path) ||
  /^cases\[\d+\]\.operation\.(type|tool)$/.test(path);
/** provider 요청에 실어 보내는 도구 목록에서 값 치환을 적용하지 않는 경로. */
export const TOOL_CONTRACT_PATHS: RedactionPathGuard = (path) => /^\[\d+\]\.name$/.test(path);

/**
 * 민감 키·값 치환의 단일 구현. suite input과 request payload가 같은 규칙을 쓰도록
 * 여기 한 곳에만 둔다. 두 벌로 두면 한쪽만 고쳐져 redaction이 조용히 어긋난다.
 */
export function sanitizeRedactable(
  value: unknown,
  options?: RunnerRedactionOptions,
  contractPath?: RedactionPathGuard,
): unknown {
  return sanitize(value, options, contractPath);
}
function sanitize(
  value: unknown,
  options?: RunnerRedactionOptions,
  contractPath?: RedactionPathGuard,
): unknown {
  const keys = new Set(DEFAULT_SENSITIVE_KEYS);
  for (const key of options?.sensitiveKeys ?? []) keys.add(normalize(key));
  const sensitiveValues = new Set(options?.sensitiveValues ?? []);
  const visit = (current: unknown, path: string): unknown => {
    if (typeof current === "string")
      return sensitiveValues.has(current) && contractPath?.(path) !== true ? REDACTED : current;
    if (current === null || typeof current !== "object") return current;
    if (Array.isArray(current))
      return current.map((item, index) => visit(item, `${path}[${index}]`));
    return Object.fromEntries(
      Object.entries(current).map(([key, nested]) => [
        key,
        // 키 기반 치환은 경로와 무관하게 그대로 적용한다. 계약 식별자 키는 민감 키 목록에 없다.
        keys.has(normalize(key)) ? REDACTED : visit(nested, path === "" ? key : `${path}.${key}`),
      ]),
    );
  };
  return visit(value, "");
}
function normalize(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}
