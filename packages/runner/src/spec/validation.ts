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
/**
 * 호출 지점이 이미 손에 쥔 값. 문안을 구체화하는 데만 쓴다.
 * 안 넘기면 문장이 한 단계 일반화될 뿐 깨지지 않으므로, 새 호출 지점이 빠뜨려도 안전하다.
 */
interface IssueDetail {
  /** 이 자리가 받는 값. 예: `"1"`, `"비어 있지 않은 문자열"`, `"listTools, callTool"` */
  readonly expects?: string;
  /** 실제로 온 값. 문안에 값을 실을지 타입 이름만 실을지는 코드별 함수가 정한다. */
  readonly actual?: unknown;
  /** `INCOMPATIBLE_ASSERTION` 의 대조 왼쪽 — operation 종류. */
  readonly operation?: string;
}

/** 사용자가 읽는 두 줄. `SuiteValidationIssue` 의 같은 이름 필드로 그대로 들어간다. */
interface IssueText {
  readonly message: string;
  readonly hint: string;
}

/** 값이 아니라 타입 이름. 타입이 틀린 자리는 값을 실어봐야 읽는 사람이 할 일이 안 바뀐다. */
const typeName = (value: unknown): string =>
  value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

/**
 * 짧은 스칼라만 그대로 보여주고 나머지는 타입 이름으로 줄인다.
 * 명세는 사용자 파일이라 서버 응답보다 안전하지만, 긴 값이 화면을 밀어내는 쪽이 손해다.
 */
const shortValue = (value: unknown): string => {
  if (typeof value === "string") return value.length <= 32 ? `'${value}'` : typeName(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null)
    return String(value);
  return typeName(value);
};

const expected = (detail: IssueDetail): string =>
  detail.expects === undefined ? "" : ` 받는 값: ${detail.expects}.`;
const receivedValue = (detail: IssueDetail): string =>
  Object.hasOwn(detail, "actual") ? ` 받은 값: ${shortValue(detail.actual)}.` : "";
const receivedType = (detail: IssueDetail): string =>
  Object.hasOwn(detail, "actual") ? ` 받은 값: ${typeName(detail.actual)}.` : "";

/**
 * 코드별 전용 문안. **이 표가 이 파일의 제품이다.**
 *
 * 예전에는 `issue()` 가 모든 코드에 `명세 필드 'X'가 유효하지 않습니다.` 하나를 붙여서, 필드가
 * *없는* 것과 값이 *틀린* 것과 단언이 operation 과 *안 맞는* 것이 화면에서 구분되지 않았다.
 * 코드 이름을 읽고 사용자가 스스로 해석해야 했다 (이슈 #352).
 *
 * 키가 우리 유니온 타입이라 (사용자 입력이 아니다) `ALLOWED_ASSERTIONS` 와 달리 객체 리터럴을
 * 쓴다. `Record` 로 두면 코드를 새로 넣을 때 문안을 빠뜨리는 것을 타입 검사가 막는다.
 */
const ISSUE_TEXT: Readonly<
  Record<SuiteValidationIssueCode, (path: string, detail: IssueDetail) => IssueText>
> = {
  MISSING_REQUIRED_FIELD: (path, detail) => ({
    message: `'${path}' 필드가 없습니다.${expected(detail)}`,
    hint: `'${path}' 필드를 명세에 추가하세요.`,
  }),
  UNKNOWN_FIELD: (path, detail) => ({
    message: `'${path}' 필드는 명세가 받지 않습니다.`,
    hint:
      detail.expects === undefined
        ? "오타가 아니면 지우세요."
        : `오타가 아니면 지우세요. 이 자리가 받는 필드: ${detail.expects}`,
  }),
  UNSUPPORTED_SCHEMA_VERSION: (path, detail) => ({
    message: `'${path}' 값을 이 버전이 읽지 못합니다.${receivedValue(detail)}`,
    hint: "받는 값은 1 하나입니다.",
  }),
  // 진단(받은 값)은 message, 고치는 법(받는 값)은 hint 로 가른다. 두 줄이 같은 말을 하지 않는다.
  INVALID_TYPE: (path, detail) => ({
    message: `'${path}' 필드의 타입이 다릅니다.${receivedType(detail)}`,
    hint:
      detail.expects === undefined
        ? `'${path}' 필드가 받는 타입을 명세 계약에서 확인하세요.`
        : `'${path}' 필드가 받는 타입: ${detail.expects}`,
  }),
  INVALID_VALUE: (path, detail) => ({
    message: `'${path}' 필드의 값이 계약을 벗어납니다.${receivedValue(detail)}`,
    hint:
      detail.expects === undefined
        ? `'${path}' 필드가 받는 값을 명세 계약에서 확인하세요.`
        : `'${path}' 필드가 받는 값: ${detail.expects}`,
  }),
  DUPLICATE_CASE_ID: (_path, detail) => ({
    message: `케이스 id ${shortValue(detail.actual)} 가 두 번 있습니다.`,
    hint: "id 는 명세 안에서 유일해야 합니다. 뒤에 온 케이스의 id 를 바꾸세요.",
  }),
  EMPTY_CASES: () => ({
    message: "cases 가 비어 있어 실행할 케이스가 없습니다.",
    hint: "케이스를 하나 이상 넣으세요. 빈 명세는 통과로 보이지만 아무것도 검증하지 않습니다.",
  }),
  EMPTY_ASSERTIONS: (_path, detail) => ({
    message: "단언이 없어 이 케이스는 무엇도 검사하지 않습니다.",
    hint:
      detail.expects === undefined
        ? "assertions 에 단언을 하나 이상 넣으세요."
        : `assertions 에 단언을 하나 이상 넣으세요. '${detail.operation}' operation 이 받는 단언: ${detail.expects}`,
  }),
  INCOMPATIBLE_ASSERTION: (_path, detail) => {
    const operation = detail.operation ?? "알 수 없는";
    // 허용 목록이 없다는 것은 operation 종류 자체를 모른다는 뜻이다. 대조할 오른쪽이 없다.
    if (detail.expects === undefined)
      return {
        message: `'${operation}' operation 은 아는 종류가 아니라 단언을 대조할 수 없습니다.`,
        hint: `operation.type 을 ${[...ALLOWED_ASSERTIONS.keys()].join(" 또는 ")} 로 바꾸세요.`,
      };
    const hint = "단언 type 을 허용 목록의 것으로 바꾸거나 operation 을 확인하세요.";
    if (typeof detail.actual !== "string")
      return {
        message: `단언에 type 이 없거나 문자열이 아닙니다. '${operation}' operation 이 받는 단언: ${detail.expects}`,
        hint,
      };
    return {
      message: `'${operation}' operation 은 '${detail.actual}' 단언을 받지 않습니다. 허용: ${detail.expects}`,
      hint,
    };
  },
  INVALID_JSON_VALUE: (path, detail) => ({
    message:
      detail.expects === undefined
        ? `'${path}' 자리에 JSON 으로 옮길 수 없는 값이 있습니다.${receivedType(detail)}`
        : `'${path}' 자리가 받는 값은 ${detail.expects} 하나입니다.${receivedType(detail)}`,
    hint: "문자열·수·불리언·null·배열·평범한 객체만 넣을 수 있습니다. 명세는 JSON 으로 직렬화할 수 있어야 합니다.",
  }),
  INVALID_TIMEOUT: (path, detail) => ({
    message: `'${path}' 필드가 타임아웃 값이 아닙니다.${receivedValue(detail)}`,
    hint: "1 이상 2147483647 이하의 정수 밀리초를 넣으세요.",
  }),
  // 아래 둘은 오늘 issueWith() 가 자기 문안을 직접 넘긴다. Record 가 요구하는 기본값이자,
  // 새 호출 지점이 issue() 로 이 코드를 낼 때 문장 없이 나가는 것을 막는 그물이다.
  UNSUPPORTED_SCHEMA_KEYWORD: (path) => ({
    message: `'${path}' 키워드를 지원하지 않습니다.`,
    hint: `지원 키워드는 ${SUPPORTED_KEYWORD_LIST} 입니다.`,
  }),
  SCHEMA_KEYWORD_REQUIRES_TYPE: (path, detail) => ({
    message: `'${path}' 키워드는 type 이 맞을 때만 쓸 수 있습니다.${expected(detail)}`,
    hint: "같은 스키마에 맞는 type 을 추가하세요.",
  }),
};

const issue = (
  issues: SuiteValidationIssue[],
  code: SuiteValidationIssueCode,
  path: string,
  detail: IssueDetail = {},
) => issues.push({ code, path, ...ISSUE_TEXT[code](path, detail) });
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
      // 받는 필드 목록은 이 자리가 이미 갖고 있다. 오타를 찾는 사람에게 이것이 답이다.
      issue(issues, "UNKNOWN_FIELD", path ? `${path}.${key}` : key, {
        expects: [...allowed].sort().join(", "),
      });
    });
/**
 * `expects` 는 필드 이름별로 "넣어야 할 값" 을 준다. 없는 이름은 일반 문안으로 떨어진다.
 * `names` 가 우리 리터럴이라 키가 사용자 입력일 수 없지만, 프로토타입을 타지 않게 `hasOwn` 으로 읽는다.
 */
const required = (
  value: Record<string, unknown>,
  names: readonly string[],
  path: string,
  issues: SuiteValidationIssue[],
  expects: Readonly<Record<string, string>> = {},
) =>
  names.forEach((name) => {
    if (name in value) return;
    issue(issues, "MISSING_REQUIRED_FIELD", path ? `${path}.${name}` : name, {
      ...(Object.hasOwn(expects, name) ? { expects: expects[name] } : {}),
    });
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
    // 같은 코드로 묶이는 세 가지 원인이다. 고치는 방법이 서로 달라 문장도 갈라 놓는다.
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        issueWith(
          issues,
          "INVALID_JSON_VALUE",
          frame.path,
          `'${frame.path}' 자리에 JSON 이 담지 못하는 수가 있습니다. 받은 값: ${String(current)}.`,
          "NaN·Infinity 대신 유한한 수를 넣으세요.",
        );
        valid = false;
      }
      continue;
    }
    if (!Array.isArray(current) && !plain(current)) {
      issueWith(
        issues,
        "INVALID_JSON_VALUE",
        frame.path,
        `'${frame.path}' 자리에 JSON 으로 옮길 수 없는 값이 있습니다. 받은 값: ${typeName(current)}.`,
        "문자열·수·불리언·null·배열·평범한 객체만 넣을 수 있습니다.",
      );
      valid = false;
      continue;
    }
    if (active.has(current)) {
      issueWith(
        issues,
        "INVALID_JSON_VALUE",
        frame.path,
        `'${frame.path}' 자리에서 값이 자기 자신을 참조해 순환합니다.`,
        "순환 참조를 없애세요. 명세는 JSON 으로 직렬화할 수 있어야 합니다.",
      );
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
      issue(issues, "INVALID_TYPE", path, { expects: "스키마 객체", actual: value });
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
      issue(issues, "INVALID_VALUE", `${path}.type`, {
        expects: RESPONSE_SCHEMA_TYPES.join(", "),
        actual: declared,
      });

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
        issue(issues, "INVALID_TYPE", `${path}.enum`, {
          expects: "비어 있지 않은 배열",
          actual: value.enum,
        });
      else
        value.enum.forEach((candidate, index) => {
          json(candidate, `${path}.enum[${index}]`, issues, new Set());
        });
    }
    if ("required" in value) {
      if (!Array.isArray(value.required))
        issue(issues, "INVALID_TYPE", `${path}.required`, {
          expects: "문자열 배열",
          actual: value.required,
        });
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
              { expects: "비어 있지 않은 필드 이름", actual: key },
            );
        });
    }
    for (const key of ["minItems", "minLength", "maxLength"] as const)
      if (key in value && !nonNegativeInt(value[key]))
        issue(issues, "INVALID_VALUE", `${path}.${key}`, {
          expects: "0 이상의 정수",
          actual: value[key],
        });
    for (const key of ["minimum", "maximum"] as const)
      if (key in value && !finiteNumber(value[key]))
        issue(issues, "INVALID_VALUE", `${path}.${key}`, {
          expects: "유한한 수",
          actual: value[key],
        });
    if ("stringContains" in value && !nonEmpty(value.stringContains))
      issue(
        issues,
        typeof value.stringContains === "string" ? "INVALID_VALUE" : "INVALID_TYPE",
        `${path}.stringContains`,
        { expects: "비어 있지 않은 문자열", actual: value.stringContains },
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
      if (!plain(value.properties))
        issue(issues, "INVALID_TYPE", `${path}.properties`, {
          expects: "필드 이름을 키로 갖는 객체",
          actual: value.properties,
        });
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
/**
 * `approval.cases` 를 검증한다. 설계 문서 §7.
 *
 * 값이 어긋난 자리는 전부 `INVALID_VALUE` 로 낸다. 모르는 키만 `unknowns()` 가 `UNKNOWN_FIELD`
 * 로 따로 낸다. 이 블록은 사람이 손으로 쓰는 자리가 아니라 `generate` 의 시험 실행이 적는
 * 자리라서, 형식이 어긋났다는 사실 하나면 고칠 곳이 정해진다.
 *
 * **`approval.cases[].id` 가 `cases[].id` 에 실재하는지는 검사하지 않는다.** 케이스를 지우는
 * 정상 편집이 파일을 깨진 것으로 만들면 안 된다. 설계 문서 §7.3.
 */
function validateApprovalCases(value: unknown, issues: SuiteValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issue(issues, "INVALID_VALUE", "approval.cases", {
      expects: "판정 배열",
      actual: value,
    });
    return;
  }
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const path = `approval.cases[${index}]`;
    if (!plain(entry)) {
      issue(issues, "INVALID_VALUE", path, { expects: "id 와 status 를 갖는 객체", actual: entry });
      return;
    }
    const id = entry.id;
    if (typeof id !== "string" || !nonEmpty(id))
      issue(issues, "INVALID_VALUE", `${path}.id`, {
        expects: "비어 있지 않은 케이스 id",
        actual: id,
      });
    else if (seen.has(id))
      issueWith(
        issues,
        "INVALID_VALUE",
        `${path}.id`,
        `승인 판정에 같은 케이스 id '${id}' 가 두 번 있습니다.`,
        "케이스마다 한 줄만 남기세요. 뒤에 온 판정이 앞을 덮지 않습니다.",
      );
    else seen.add(id);
    if (entry.status !== "passed" && entry.status !== "serverDefect")
      issueWith(
        issues,
        "INVALID_VALUE",
        `${path}.status`,
        "승인 판정은 'passed' 또는 'serverDefect' 여야 합니다.",
        "이 블록은 generate 의 시험 실행이 적습니다. 손으로 고쳤다면 두 값 중 하나로 되돌리세요.",
      );
    unknowns(entry, ["id", "status"], path, issues);
  });
}
export function validateMcpSuite(input: unknown): SuiteValidationResult {
  const issues: SuiteValidationIssue[] = [];
  if (!plain(input)) {
    issue(issues, "INVALID_TYPE", "$", { expects: "명세 객체", actual: input });
    return { valid: false, issues };
  }
  // schemaVersion 은 받는 값이 1 하나뿐이라 "무엇을 넣어야 하는지" 를 그대로 말할 수 있다.
  if (!("schemaVersion" in input))
    issue(issues, "MISSING_REQUIRED_FIELD", "schemaVersion", { expects: "1" });
  else if (input.schemaVersion !== 1)
    issue(issues, "UNSUPPORTED_SCHEMA_VERSION", "schemaVersion", {
      actual: input.schemaVersion,
    });
  for (const key of ["id", "name"] as const)
    if (!(key in input))
      issue(issues, "MISSING_REQUIRED_FIELD", key, { expects: "비어 있지 않은 문자열" });
    else if (!nonEmpty(input[key]))
      issue(issues, typeof input[key] === "string" ? "INVALID_VALUE" : "INVALID_TYPE", key, {
        expects: "비어 있지 않은 문자열",
        actual: input[key],
      });
  if ("defaultTimeoutMs" in input && !timeout(input.defaultTimeoutMs))
    issue(issues, "INVALID_TIMEOUT", "defaultTimeoutMs", { actual: input.defaultTimeoutMs });
  if ("approval" in input) {
    const approval = input.approval;
    if (!plain(approval))
      issue(issues, "INVALID_TYPE", "approval", { expects: "객체", actual: approval });
    else {
      // 지문 값은 64자라 화면에 실으면 줄을 통째로 잡아먹는다. 형식만 말한다.
      if (!("fingerprint" in approval))
        issue(issues, "MISSING_REQUIRED_FIELD", "approval.fingerprint", {
          expects: "sha256 hex 64자 (소문자)",
        });
      else if (typeof approval.fingerprint !== "string")
        issue(issues, "INVALID_TYPE", "approval.fingerprint", {
          expects: "string",
          actual: approval.fingerprint,
        });
      else if (!HEX64.test(approval.fingerprint))
        issue(issues, "INVALID_VALUE", "approval.fingerprint", {
          expects: "sha256 hex 64자 (소문자)",
        });
      if ("cases" in approval) validateApprovalCases(approval.cases, issues);
      unknowns(approval, ["fingerprint", "cases"], "approval", issues);
    }
  }
  unknowns(
    input,
    ["schemaVersion", "id", "name", "approval", "defaultTimeoutMs", "cases"],
    "",
    issues,
  );
  if (!("cases" in input)) {
    issue(issues, "MISSING_REQUIRED_FIELD", "cases", { expects: "케이스 배열" });
    return { valid: false, issues };
  }
  if (!Array.isArray(input.cases)) {
    issue(issues, "INVALID_TYPE", "cases", { expects: "배열", actual: input.cases });
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
    issue(issues, "INVALID_TYPE", path, { expects: "케이스 객체", actual: value });
    return;
  }
  for (const key of ["id", "name"] as const)
    if (!(key in value))
      issue(issues, "MISSING_REQUIRED_FIELD", `${path}.${key}`, {
        expects: "비어 있지 않은 문자열",
      });
    else if (!nonEmpty(value[key]))
      issue(
        issues,
        typeof value[key] === "string" ? "INVALID_VALUE" : "INVALID_TYPE",
        `${path}.${key}`,
        { expects: "비어 있지 않은 문자열", actual: value[key] },
      );
  if (typeof value.id === "string" && nonEmpty(value.id)) {
    if (seen.has(value.id)) issue(issues, "DUPLICATE_CASE_ID", `${path}.id`, { actual: value.id });
    else seen.add(value.id);
  }
  if ("timeoutMs" in value && !timeout(value.timeoutMs))
    issue(issues, "INVALID_TIMEOUT", `${path}.timeoutMs`, { actual: value.timeoutMs });
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
  const kinds = [...ALLOWED_ASSERTIONS.keys()].join(", ");
  if (value === undefined) {
    issue(issues, "MISSING_REQUIRED_FIELD", path, { expects: `${kinds} 중 하나의 operation` });
    return;
  }
  if (!plain(value)) {
    issue(issues, "INVALID_TYPE", path, { expects: "operation 객체", actual: value });
    return;
  }
  required(value, ["type"], path, issues, { type: kinds });
  if (kind !== "listTools" && kind !== "callTool") {
    if ("type" in value) {
      issue(issues, "INVALID_VALUE", `${path}.type`, { expects: kinds, actual: value.type });
      unknowns(value, ["type"], path, issues);
    }
    return;
  }
  const keys = kind === "listTools" ? ["type"] : ["type", "tool", "input"];
  required(value, keys, path, issues, {
    type: kinds,
    tool: "비어 있지 않은 툴 이름",
    input: "JSON 객체 (인자가 없으면 {})",
  });
  if (kind === "callTool") {
    if ("tool" in value && !nonEmpty(value.tool))
      issue(
        issues,
        typeof value.tool === "string" ? "INVALID_VALUE" : "INVALID_TYPE",
        `${path}.tool`,
        { expects: "비어 있지 않은 툴 이름", actual: value.tool },
      );
    if ("input" in value) {
      if (plain(value.input)) json(value.input, `${path}.input`, issues, new Set());
      else
        issue(issues, "INVALID_JSON_VALUE", `${path}.input`, {
          expects: "JSON 객체",
          actual: value.input,
        });
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
  // 이 자리에서 operation 종류를 알면 허용 목록까지 말할 수 있다. 대조의 양쪽이 다 손에 있다.
  const allowedForKind = kind === undefined ? undefined : ALLOWED_ASSERTIONS.get(kind);
  const allowedList = allowedForKind?.join(", ");
  if (value === undefined) {
    issue(issues, "MISSING_REQUIRED_FIELD", path, {
      expects: allowedList === undefined ? "단언 배열" : `${allowedList} 단언의 배열`,
    });
    return;
  }
  if (!Array.isArray(value)) {
    if (value !== undefined)
      issue(issues, "INVALID_TYPE", path, { expects: "배열", actual: value });
    return;
  }
  if (value.length === 0) {
    issue(issues, "EMPTY_ASSERTIONS", path, { operation: kind, expects: allowedList });
    return;
  }
  value.forEach((assertion, index) => {
    const itemPath = `${path}[${index}]`;
    if (!plain(assertion)) {
      issue(issues, "INVALID_TYPE", itemPath, { expects: "단언 객체", actual: assertion });
      return;
    }
    const type = assertion.type;
    if (kind !== undefined) {
      if (
        allowedForKind === undefined ||
        typeof type !== "string" ||
        !allowedForKind.includes(type)
      ) {
        issue(issues, "INCOMPATIBLE_ASSERTION", itemPath, {
          operation: kind,
          expects: allowedList,
          actual: type,
        });
        return;
      }
    } else if (
      typeof type !== "string" ||
      !(KNOWN_ASSERTIONS as readonly string[]).includes(type)
    ) {
      required(assertion, ["type"], itemPath, issues, { type: KNOWN_ASSERTIONS.join(", ") });
      if ("type" in assertion)
        issue(
          issues,
          typeof type === "string" ? "INVALID_VALUE" : "INVALID_TYPE",
          `${itemPath}.type`,
          { expects: KNOWN_ASSERTIONS.join(", "), actual: type },
        );
      unknowns(assertion, ["type"], itemPath, issues);
      return;
    }
    if (type === "toolExists") {
      required(assertion, ["type", "tool"], itemPath, issues, {
        tool: "tools/list 에 있어야 할 툴 이름",
      });
      if ("tool" in assertion && !nonEmpty(assertion.tool))
        issue(
          issues,
          typeof assertion.tool === "string" ? "INVALID_VALUE" : "INVALID_TYPE",
          `${itemPath}.tool`,
          { expects: "비어 있지 않은 툴 이름", actual: assertion.tool },
        );
      unknowns(assertion, ["type", "tool"], itemPath, issues);
    } else if (type === "isError") {
      required(assertion, ["type", "expected"], itemPath, issues, {
        expected: "true 또는 false",
      });
      if ("expected" in assertion && typeof assertion.expected !== "boolean")
        issue(issues, "INVALID_TYPE", `${itemPath}.expected`, {
          expects: "boolean",
          actual: assertion.expected,
        });
      unknowns(assertion, ["type", "expected"], itemPath, issues);
    } else {
      required(assertion, ["type", "schema"], itemPath, issues, {
        schema: "응답 스키마 객체",
      });
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
