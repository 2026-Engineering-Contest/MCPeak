import {
  SuiteValidationError,
  type SuiteValidationIssue,
  type SuiteValidationIssueCode,
  type SuiteValidationResult,
  type TestSuiteSpec,
} from "./types.js";

const plain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const issue = (issues: SuiteValidationIssue[], code: SuiteValidationIssueCode, path: string) =>
  issues.push({
    code,
    path,
    message: `명세 필드 '${path}'가 유효하지 않습니다.`,
    hint: "명세 계약에 맞게 필드와 값을 확인하세요.",
  });
const nonEmpty = (v: unknown) => typeof v === "string" && /\S/.test(v);
/**
 * 승인 지문의 형식. sha256 hex 64자, 소문자만 받는다.
 * 대문자 hex 는 sha256 이 내지 않는 값이므로 사람이 손으로 넣었거나 다른 도구가 만든 것이다.
 * 받아주면 지문이 절대 일치하지 않는데 원인이 보이지 않는다.
 * 값이 맞는지는 여기서 보지 않는다. 대조는 실행 시점의 관심사다.
 */
const HEX64 = /^[0-9a-f]{64}$/;
const RESPONSE_SCHEMA_KEYWORDS = [
  "type",
  "const",
  "enum",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "minItems",
  "minLength",
  "maxLength",
  "stringContains",
  "minimum",
  "maximum",
] as const;

const RESPONSE_SCHEMA_TYPES = [
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null",
] as const;

/** 각 키워드가 요구하는 type 값. 설계 문서 §4.4. 프로토타입 오염을 피해 Map으로 둔다. */
const KEYWORD_TYPES = new Map<string, readonly string[]>([
  ["required", ["object"]],
  ["properties", ["object"]],
  ["additionalProperties", ["object"]],
  ["items", ["array"]],
  ["minItems", ["array"]],
  ["minLength", ["string"]],
  ["maxLength", ["string"]],
  ["stringContains", ["string"]],
  ["minimum", ["number", "integer"]],
  ["maximum", ["number", "integer"]],
]);

const SUPPORTED_KEYWORD_LIST = RESPONSE_SCHEMA_KEYWORDS.join(", ");

/**
 * operation 종류별로 허용하는 단언. 색인 키가 사용자 입력이므로 Map을 쓴다.
 * 객체 리터럴을 쓰면 operation.type이 "toString"일 때 프로토타입의 함수가 잡혀
 * allowed.includes가 TypeError를 던진다.
 */
const ALLOWED_ASSERTIONS = new Map<string, readonly string[]>([
  ["listTools", ["toolExists"]],
  ["callTool", ["isError", "bodyMatchesSchema"]],
]);

const KNOWN_ASSERTIONS = ["toolExists", "isError", "bodyMatchesSchema"] as const;

const nonNegativeInt = (v: unknown): boolean =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

const finiteNumber = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v);

/** 기존 issue()는 고정 문안만 낸다. 새 코드 두 개는 전용 문안이 필요하다. */
const issueWith = (
  issues: SuiteValidationIssue[],
  code: SuiteValidationIssueCode,
  path: string,
  message: string,
  hint: string,
) => issues.push({ code, path, message, hint });
const timeout = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 1 && v <= 2_147_483_647;
const unknowns = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: SuiteValidationIssue[],
) =>
  Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .sort()
    .forEach((key) => {
      issue(issues, "UNKNOWN_FIELD", path ? `${path}.${key}` : key);
    });
const required = (
  value: Record<string, unknown>,
  names: readonly string[],
  path: string,
  issues: SuiteValidationIssue[],
) =>
  names.forEach((name) => {
    if (!(name in value)) issue(issues, "MISSING_REQUIRED_FIELD", path ? `${path}.${name}` : name);
  });
function json(
  value: unknown,
  path: string,
  issues: SuiteValidationIssue[],
  active: Set<object>,
): boolean {
  type Frame = { type: "visit"; value: unknown; path: string } | { type: "leave"; value: object };
  const frames: Frame[] = [{ type: "visit", value, path }];
  let valid = true;

  while (frames.length > 0) {
    const frame = frames.pop();
    if (frame === undefined) break;
    if (frame.type === "leave") {
      active.delete(frame.value);
      continue;
    }

    const current = frame.value;
    if (current === null || typeof current === "string" || typeof current === "boolean") continue;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        issue(issues, "INVALID_JSON_VALUE", frame.path);
        valid = false;
      }
      continue;
    }
    if (!Array.isArray(current) && !plain(current)) {
      issue(issues, "INVALID_JSON_VALUE", frame.path);
      valid = false;
      continue;
    }
    if (active.has(current)) {
      issue(issues, "INVALID_JSON_VALUE", frame.path);
      valid = false;
      continue;
    }

    active.add(current);
    frames.push({ type: "leave", value: current });
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index--)
        frames.push({ type: "visit", value: current[index], path: `${frame.path}[${index}]` });
      continue;
    }
    const keys = Object.keys(current);
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index];
      if (key !== undefined)
        frames.push({ type: "visit", value: current[key], path: `${frame.path}.${key}` });
    }
  }

  return valid;
}
/**
 * ResponseSchema를 검증한다. 재귀가 아니라 명시적 프레임 스택으로 순회해
 * 깊게 중첩한 스키마에서도 스택이 넘치지 않게 한다. validation.ts의 json()과 같은 방식이다.
 * 방문 순서는 properties(선언 순서), additionalProperties, items 이며,
 * 이 순서가 곧 issue 배열의 순서다.
 */
function validateResponseSchema(
  root: unknown,
  rootPath: string,
  issues: SuiteValidationIssue[],
): void {
  type Frame = { type: "visit"; value: unknown; path: string } | { type: "leave"; value: object };
  const frames: Frame[] = [{ type: "visit", value: root, path: rootPath }];
  // 지금 내려가고 있는 조상 스키마들. json()과 같은 방식으로 순환을 잡는다.
  const active = new Set<object>();

  while (frames.length > 0) {
    const frame = frames.pop();
    if (frame === undefined) break;
    if (frame.type === "leave") {
      active.delete(frame.value);
      continue;
    }
    const { value, path } = frame;
    if (!plain(value)) {
      issue(issues, "INVALID_TYPE", path);
      continue;
    }
    // 순환하는 스키마는 프레임이 무한히 늘고 경로 문자열이 계속 길어져 결국 프로세스가 죽는다.
    if (active.has(value)) {
      issueWith(
        issues,
        "INVALID_JSON_VALUE",
        path,
        "스키마가 자기 자신을 참조해 순환합니다.",
        "순환 참조를 없애세요. 명세는 JSON으로 직렬화할 수 있어야 합니다.",
      );
      continue;
    }
    active.add(value);
    frames.push({ type: "leave", value });
    // 빈 스키마는 어떤 응답에도 위반을 내지 않아 영원히 통과하는 단언을 만든다.
    if (Object.keys(value).length === 0) {
      issueWith(
        issues,
        "INVALID_VALUE",
        path,
        "스키마가 비어 있어 검사할 제약이 없습니다.",
        `type, required, properties, const, enum 같은 키워드를 하나 이상 넣으세요. 지원 키워드는 ${SUPPORTED_KEYWORD_LIST} 입니다.`,
      );
      continue;
    }

    for (const key of Object.keys(value).sort())
      if (!(RESPONSE_SCHEMA_KEYWORDS as readonly string[]).includes(key))
        issueWith(
          issues,
          "UNSUPPORTED_SCHEMA_KEYWORD",
          `${path}.${key}`,
          "지원하지 않는 스키마 키워드입니다.",
          `지원 키워드는 ${SUPPORTED_KEYWORD_LIST} 입니다.`,
        );

    const declared = Object.hasOwn(value, "type") ? value.type : undefined;
    if (
      declared !== undefined &&
      (typeof declared !== "string" ||
        !(RESPONSE_SCHEMA_TYPES as readonly string[]).includes(declared))
    )
      issue(issues, "INVALID_VALUE", `${path}.type`);

    for (const keyword of [...KEYWORD_TYPES.keys()].sort()) {
      const allowed = KEYWORD_TYPES.get(keyword);
      if (!Object.hasOwn(value, keyword) || allowed === undefined) continue;
      if (typeof declared !== "string" || !allowed.includes(declared))
        issueWith(
          issues,
          "SCHEMA_KEYWORD_REQUIRES_TYPE",
          `${path}.${keyword}`,
          `'${keyword}'은 type이 ${allowed.join(" 또는 ")}일 때만 쓸 수 있습니다.`,
          `같은 스키마에 "type": "${allowed[0]}"를 추가하세요.`,
        );
    }

    if ("const" in value) json(value.const, `${path}.const`, issues, new Set());
    if ("enum" in value) {
      if (!Array.isArray(value.enum) || value.enum.length === 0)
        issue(issues, "INVALID_TYPE", `${path}.enum`);
      else
        value.enum.forEach((candidate, index) => {
          json(candidate, `${path}.enum[${index}]`, issues, new Set());
        });
    }
    if ("required" in value) {
      if (!Array.isArray(value.required)) issue(issues, "INVALID_TYPE", `${path}.required`);
      else if (value.required.length === 0)
        issueWith(
          issues,
          "INVALID_VALUE",
          `${path}.required`,
          "required가 비어 있어 검사할 필드가 없습니다.",
          "필수 필드 이름을 넣거나 required를 제거하세요.",
        );
      else
        value.required.forEach((key, index) => {
          if (!nonEmpty(key))
            issue(
              issues,
              typeof key === "string" ? "INVALID_VALUE" : "INVALID_TYPE",
              `${path}.required[${index}]`,
            );
        });
    }
    for (const key of ["minItems", "minLength", "maxLength"] as const)
      if (key in value && !nonNegativeInt(value[key]))
        issue(issues, "INVALID_VALUE", `${path}.${key}`);
    for (const key of ["minimum", "maximum"] as const)
      if (key in value && !finiteNumber(value[key]))
        issue(issues, "INVALID_VALUE", `${path}.${key}`);
    if ("stringContains" in value && !nonEmpty(value.stringContains))
      issue(
        issues,
        typeof value.stringContains === "string" ? "INVALID_VALUE" : "INVALID_TYPE",
        `${path}.stringContains`,
      );

    // 역순으로 push해 pop 순서가 properties, additionalProperties, items 가 되게 한다.
    if ("items" in value) frames.push({ type: "visit", value: value.items, path: `${path}.items` });
    if ("additionalProperties" in value && typeof value.additionalProperties !== "boolean")
      frames.push({
        type: "visit",
        value: value.additionalProperties,
        path: `${path}.additionalProperties`,
      });
    if ("properties" in value) {
      if (!plain(value.properties)) issue(issues, "INVALID_TYPE", `${path}.properties`);
      else if (Object.keys(value.properties).length === 0)
        issueWith(
          issues,
          "INVALID_VALUE",
          `${path}.properties`,
          "properties가 비어 있어 검사할 필드가 없습니다.",
          "검사할 필드를 넣거나 properties를 제거하세요.",
        );
      else {
        const keys = Object.keys(value.properties);
        for (let index = keys.length - 1; index >= 0; index--) {
          const key = keys[index];
          if (key !== undefined)
            frames.push({
              type: "visit",
              value: (value.properties as Record<string, unknown>)[key],
              path: `${path}.properties.${key}`,
            });
        }
      }
    }
  }
}
export function validateMcpSuite(input: unknown): SuiteValidationResult {
  const issues: SuiteValidationIssue[] = [];
  if (!plain(input)) {
    issue(issues, "INVALID_TYPE", "$");
    return { valid: false, issues };
  }
  if (!("schemaVersion" in input)) issue(issues, "MISSING_REQUIRED_FIELD", "schemaVersion");
  else if (input.schemaVersion !== 1) issue(issues, "UNSUPPORTED_SCHEMA_VERSION", "schemaVersion");
  for (const key of ["id", "name"] as const)
    if (!(key in input)) issue(issues, "MISSING_REQUIRED_FIELD", key);
    else if (!nonEmpty(input[key]))
      issue(issues, typeof input[key] === "string" ? "INVALID_VALUE" : "INVALID_TYPE", key);
  if ("defaultTimeoutMs" in input && !timeout(input.defaultTimeoutMs))
    issue(issues, "INVALID_TIMEOUT", "defaultTimeoutMs");
  if ("approval" in input) {
    const approval = input.approval;
    if (!plain(approval)) issue(issues, "INVALID_TYPE", "approval");
    else {
      if (!("fingerprint" in approval))
        issue(issues, "MISSING_REQUIRED_FIELD", "approval.fingerprint");
      else if (typeof approval.fingerprint !== "string")
        issue(issues, "INVALID_TYPE", "approval.fingerprint");
      else if (!HEX64.test(approval.fingerprint))
        issue(issues, "INVALID_VALUE", "approval.fingerprint");
      unknowns(approval, ["fingerprint"], "approval", issues);
    }
  }
  unknowns(
    input,
    ["schemaVersion", "id", "name", "approval", "defaultTimeoutMs", "cases"],
    "",
    issues,
  );
  if (!("cases" in input)) {
    issue(issues, "MISSING_REQUIRED_FIELD", "cases");
    return { valid: false, issues };
  }
  if (!Array.isArray(input.cases)) {
    issue(issues, "INVALID_TYPE", "cases");
    return { valid: false, issues };
  }
  if (input.cases.length === 0) issue(issues, "EMPTY_CASES", "cases");
  const seen = new Set<string>();
  input.cases.forEach((caseValue, index) => {
    validateCase(caseValue, index, seen, issues);
  });
  return issues.length === 0
    ? { valid: true, value: input as unknown as TestSuiteSpec }
    : { valid: false, issues };
}
function validateCase(
  value: unknown,
  index: number,
  seen: Set<string>,
  issues: SuiteValidationIssue[],
): void {
  const path = `cases[${index}]`;
  if (!plain(value)) {
    issue(issues, "INVALID_TYPE", path);
    return;
  }
  for (const key of ["id", "name"] as const)
    if (!(key in value)) issue(issues, "MISSING_REQUIRED_FIELD", `${path}.${key}`);
    else if (!nonEmpty(value[key]))
      issue(
        issues,
        typeof value[key] === "string" ? "INVALID_VALUE" : "INVALID_TYPE",
        `${path}.${key}`,
      );
  if (typeof value.id === "string" && nonEmpty(value.id)) {
    if (seen.has(value.id)) issue(issues, "DUPLICATE_CASE_ID", `${path}.id`);
    else seen.add(value.id);
  }
  if ("timeoutMs" in value && !timeout(value.timeoutMs))
    issue(issues, "INVALID_TIMEOUT", `${path}.timeoutMs`);
  unknowns(value, ["id", "name", "timeoutMs", "operation", "assertions"], path, issues);
  const operation = value.operation;
  const kind = plain(operation) && typeof operation.type === "string" ? operation.type : undefined;
  validateOperation(operation, kind, `${path}.operation`, issues);
  validateAssertions(value.assertions, kind, `${path}.assertions`, issues);
}
function validateOperation(
  value: unknown,
  kind: string | undefined,
  path: string,
  issues: SuiteValidationIssue[],
): void {
  if (value === undefined) {
    issue(issues, "MISSING_REQUIRED_FIELD", path);
    return;
  }
  if (!plain(value)) {
    issue(issues, "INVALID_TYPE", path);
    return;
  }
  required(value, ["type"], path, issues);
  if (kind !== "listTools" && kind !== "callTool") {
    if ("type" in value) {
      issue(issues, "INVALID_VALUE", `${path}.type`);
      unknowns(value, ["type"], path, issues);
    }
    return;
  }
  const keys = kind === "listTools" ? ["type"] : ["type", "tool", "input"];
  required(value, keys, path, issues);
  if (kind === "callTool") {
    if ("tool" in value && !nonEmpty(value.tool))
      issue(
        issues,
        typeof value.tool === "string" ? "INVALID_VALUE" : "INVALID_TYPE",
        `${path}.tool`,
      );
    if ("input" in value) {
      if (plain(value.input)) json(value.input, `${path}.input`, issues, new Set());
      else issue(issues, "INVALID_JSON_VALUE", `${path}.input`);
    }
  }
  unknowns(value, keys, path, issues);
}
function validateAssertions(
  value: unknown,
  kind: string | undefined,
  path: string,
  issues: SuiteValidationIssue[],
): void {
  if (value === undefined) {
    issue(issues, "MISSING_REQUIRED_FIELD", path);
    return;
  }
  if (!Array.isArray(value)) {
    if (value !== undefined) issue(issues, "INVALID_TYPE", path);
    return;
  }
  if (value.length === 0) {
    issue(issues, "EMPTY_ASSERTIONS", path);
    return;
  }
  value.forEach((assertion, index) => {
    const itemPath = `${path}[${index}]`;
    if (!plain(assertion)) {
      issue(issues, "INVALID_TYPE", itemPath);
      return;
    }
    const type = assertion.type;
    if (kind !== undefined) {
      const allowed = ALLOWED_ASSERTIONS.get(kind);
      if (allowed === undefined || typeof type !== "string" || !allowed.includes(type)) {
        issue(issues, "INCOMPATIBLE_ASSERTION", itemPath);
        return;
      }
    } else if (
      typeof type !== "string" ||
      !(KNOWN_ASSERTIONS as readonly string[]).includes(type)
    ) {
      required(assertion, ["type"], itemPath, issues);
      if ("type" in assertion)
        issue(
          issues,
          typeof type === "string" ? "INVALID_VALUE" : "INVALID_TYPE",
          `${itemPath}.type`,
        );
      unknowns(assertion, ["type"], itemPath, issues);
      return;
    }
    if (type === "toolExists") {
      required(assertion, ["type", "tool"], itemPath, issues);
      if ("tool" in assertion && !nonEmpty(assertion.tool))
        issue(
          issues,
          typeof assertion.tool === "string" ? "INVALID_VALUE" : "INVALID_TYPE",
          `${itemPath}.tool`,
        );
      unknowns(assertion, ["type", "tool"], itemPath, issues);
    } else if (type === "isError") {
      required(assertion, ["type", "expected"], itemPath, issues);
      if ("expected" in assertion && typeof assertion.expected !== "boolean")
        issue(issues, "INVALID_TYPE", `${itemPath}.expected`);
      unknowns(assertion, ["type", "expected"], itemPath, issues);
    } else {
      required(assertion, ["type", "schema"], itemPath, issues);
      if ("schema" in assertion)
        validateResponseSchema(assertion.schema, `${itemPath}.schema`, issues);
      unknowns(assertion, ["type", "schema"], itemPath, issues);
    }
  });
}
export function defineMcpSuite<const T extends TestSuiteSpec>(spec: T): T {
  const result = validateMcpSuite(spec);
  if (!result.valid) throw new SuiteValidationError(result.issues);
  return spec;
}
