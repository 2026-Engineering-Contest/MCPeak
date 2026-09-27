import type { JsonValue } from "./spec/types.js";

/** 검사 한 건의 결과. 두 검사가 같은 모양을 쓴다. */
export interface SpecFinding {
  /** 무엇이 어긋났는지. 소비자가 분기하는 유일한 키다. */
  readonly code: SpecFindingCode;
  /** 지위. blocking은 승인 차단 근거, advisory는 참고. 설계 문서 §6 참고. */
  readonly severity: "blocking" | "advisory";
  /** TestCaseSpec.id */
  readonly caseId: string;
  /**
   * 명세 안의 위치. 점 표기.
   *   "input.city"                       입력 필드
   *   "assertions[0].schema.minLength"   단언 안의 위치
   */
  readonly path: string;
  /** 선언에서 기대한 값. 없으면 생략한다. 가공하지 않은 원본이다. */
  readonly expected?: JsonValue;
  /** 명세에 적힌 값. 없으면 생략한다. 가공하지 않은 원본이다. */
  readonly actual?: JsonValue;
  /** 판정을 수행하지 못한 안정적인 사유. 현재는 SCHEMA_NOT_ANALYZABLE 에만 쓴다. */
  readonly reason?: string;
  /** 오타 후보 등 단일 제안. 설계 문서 §5.4의 규칙으로 정해지며 없으면 생략한다. */
  readonly suggestion?: string;
}

export type SpecFindingCode =
  // 입력 계약 대조
  | "TOOL_NOT_DECLARED" // 서버가 선언하지 않은 툴을 호출한다
  | "REQUIRED_MISSING" // 선언된 required 필드가 입력에 없다
  | "UNDECLARED_FIELD" // 선언에 없는 필드가 입력에 있다
  | "TYPE_MISMATCH" // 선언된 type과 입력 값의 타입이 다르다
  | "ENUM_MISMATCH" // 선언된 enum 밖의 값이다
  | "SCHEMA_NOT_ANALYZABLE" // 서버 스키마를 해석하지 못했다. 위반이 아니다
  | "REJECTION_WITHOUT_VIOLATION" // 거절을 기대하는데 입력이 선언을 어기지 않는다. 위반이 아니라 의도 불명 신호다
  | "RANGE_MISMATCH" // 명세의 입력값이 선언된 범위를 벗어난다
  // 단언 실질성
  | "VACUOUS_MIN_LENGTH" // minLength: 0
  | "VACUOUS_MIN_ITEMS"; // minItems: 0

/** 한 케이스에서 목록에 담는 finding의 최대 개수. schema-match.ts의 선례를 따른다. */
export const MAX_FINDINGS_PER_CASE = 10;

export interface SpecFindingsResult {
  /** 설계 문서 §9.2의 순서로 정렬돼 있다. */
  readonly findings: readonly SpecFinding[];
  /** MAX_FINDINGS_PER_CASE로 잘리기 전의 총 개수. */
  readonly totalFindings: number;
}

/**
 * 문장에 넣을 문자열에서 한 줄 계약을 깨는 문자를 이스케이프한다.
 *
 * 툴 이름, 필드 이름, enum 값, 스키마 프로퍼티 이름은 모두 **남의 서버나 남이 쓴 명세**에서
 * 온다. 개행이나 제어 문자가 들어 있으면 `describeSpecFinding`이 내세우는 "반환에 줄바꿈이
 * 없다" 계약이 깨지고, 소비자가 붙이는 들여쓰기와 화살표 정렬도 무너진다.
 *
 * `JSON.stringify`가 제어 문자와 역슬래시를 이미 이스케이프하므로 그 결과의 바깥 큰따옴표만
 * 벗긴다. 작은따옴표는 우리가 감싸는 문자라 따로 이스케이프한다.
 */
const escapeInline = (value: string): string =>
  JSON.stringify(value).slice(1, -1).replaceAll("'", "\\'");

/**
 * 값을 문장에 넣을 표기로 만든다. 설계 문서 §7의 규칙이다.
 * 문자열은 작은따옴표로 감싸고, 그 외 JSON 값은 JSON.stringify 결과를 그대로 쓴다.
 * 로캘에 의존하지 않으며 같은 값은 항상 같은 문자열이 된다.
 */
const literal = (value: JsonValue | undefined): string =>
  typeof value === "string" ? `'${escapeInline(value)}'` : JSON.stringify(value);

/** suggestion은 언제나 문자열이므로 작은따옴표만 붙인다. */
const suggest = (finding: SpecFinding, tail: string): string =>
  finding.suggestion === undefined ? "" : `. ${tail}: '${escapeInline(finding.suggestion)}'`;

/**
 * 입력 스키마를 해석하지 못한 안정적인 사유를 사용자가 바로 고칠 수 있는 문장으로 만든다.
 * reason 은 분석기가 고른 제한된 값이지만 공개 타입의 입력일 수도 있으므로 기본 분기에서도
 * 한 줄 출력 계약에 맞게 이스케이프한다.
 */
const describeUnanalyzableSchema = (finding: SpecFinding): string => {
  const tool = literal(finding.actual);
  switch (finding.reason) {
    case "properties":
      return `${tool} 의 inputSchema 에 properties 가 없거나 객체가 아니어서 입력 검사를 건너뜁니다. properties 와 required 를 채우세요`;
    case "type":
      return `${tool} 의 inputSchema type 이 object 가 아니어서 입력 검사를 건너뜁니다. type 을 object 로 지정하고 properties 와 required 를 채우세요`;
    case "schema":
      return `${tool} 의 inputSchema 가 객체가 아니어서 입력 검사를 건너뜁니다. 객체 스키마에 type, properties, required 를 채우세요`;
    case "duplicateTool":
      return `${tool} 이 tools/list 에 중복 선언되어 어느 inputSchema 를 쓸지 정할 수 없어 입력 검사를 건너뜁니다. 같은 이름의 툴 선언을 하나만 남기세요`;
    case undefined:
      return `${tool} 의 입력 스키마를 해석하지 못해 이 툴의 입력 검사를 건너뜁니다. inputSchema 의 type, properties, required 를 확인하세요`;
    default:
      return `${tool} 의 inputSchema 에 지원하지 않는 JSON Schema 키워드 '${escapeInline(finding.reason)}' 가 있어 입력 검사를 건너뜁니다. type, properties, required 중심으로 스키마를 단순화하세요`;
  }
};

/**
 * 선언된 범위를 사람이 읽는 구절로 만든다. **선언된 항목만 적는다.** 없는 항목을 추측해
 * 적으면 사용자가 서버 선언에 없는 경계를 있다고 읽는다.
 *
 * 재료는 `checkInputContract` 가 `expected` 에 실어 준 범위 객체다. 문장은 여기서만 만든다
 * (ADR-0018). 세 범주(숫자·원소 개수·문자 길이)는 단위 표기가 달라 따로 조립한다.
 */
function describeRange(expected: JsonValue | undefined): string {
  if (typeof expected !== "object" || expected === null || Array.isArray(expected)) return "";
  const bound = (key: string, suffix: string): string | null => {
    const value = expected[key];
    return typeof value === "number" ? `${value}${suffix}` : null;
  };
  const group = (parts: (string | null)[], prefix = ""): string | null => {
    const kept = parts.filter((part): part is string => part !== null);
    return kept.length === 0 ? null : `${prefix}${kept.join(" ")}`;
  };
  return [
    group([
      bound("minimum", " 이상"),
      bound("exclusiveMinimum", " 초과"),
      bound("maximum", " 이하"),
      bound("exclusiveMaximum", " 미만"),
    ]),
    group([bound("minItems", "개 이상"), bound("maxItems", "개 이하")], "원소 "),
    group([bound("minLength", "자 이상"), bound("maxLength", "자 이하")]),
  ]
    .filter((part): part is string => part !== null)
    .join(" ");
}

/**
 * 문장을 고를 때 쓰는 호출 지점의 문맥(ADR-0078). 문안은 이 파일의 표가 갖고, 호출 지점은
 * 자기가 아는 사실만 얹는다. 넘기지 않으면 문맥 없는 문장이다.
 */
export interface SpecFindingContext {
  /** 거절을 기대한 케이스에 서버가 정상 응답했는가. rejectionAccepted 의 결과. */
  readonly rejectionAccepted?: boolean;
}

/**
 * finding 한 건을 사용자가 읽는 한 문장으로 만든다.
 * 문안은 설계 문서 §7에 전량으로 있다. 소비자는 이 함수만 쓰고 문장을 새로 짓지 않는다.
 * 반환에 줄바꿈이 없다. 들여쓰기와 화살표는 소비자가 붙인다.
 */
export function describeSpecFinding(finding: SpecFinding, context?: SpecFindingContext): string {
  const { expected, actual } = finding;
  // path에도 스키마 프로퍼티 이름이 그대로 들어간다. 같은 규칙으로 이스케이프한다.
  const path = escapeInline(finding.path);
  switch (finding.code) {
    case "TOOL_NOT_DECLARED":
      return `서버가 선언하지 않은 툴입니다: ${literal(actual)}${suggest(finding, "비슷한 툴")}`;
    case "REQUIRED_MISSING":
      return `필수 필드 ${literal(expected)} 가 입력에 없습니다${suggest(finding, "비슷한 필드")}`;
    case "UNDECLARED_FIELD":
      return `${literal(actual)} 는 서버가 선언하지 않은 필드입니다${suggest(finding, "비슷한 필드")}`;
    case "TYPE_MISMATCH":
      return `${path} 의 타입이 다릅니다. 서버 선언: ${literal(expected)}, 명세: ${literal(actual)}`;
    case "ENUM_MISMATCH":
      return `${path} 값 ${literal(actual)} 는 선언된 값이 아닙니다. 허용: ${literal(expected)}${suggest(finding, "비슷한 값")}`;
    case "RANGE_MISMATCH":
      return `${path} 값 ${literal(actual)} 이 선언된 범위를 벗어납니다. 서버 선언: ${describeRange(expected)}. 값을 범위 안으로 고치거나, 거절을 기대하는 케이스라면 expectError 를 지정하세요`;
    case "SCHEMA_NOT_ANALYZABLE":
      return describeUnanalyzableSchema(finding);
    case "REJECTION_WITHOUT_VIOLATION":
      // 서버가 받아들였다면 입력은 원래 계약을 어기도록 만든 것이고 계약이 바뀐 것이다.
      // 사용자에게 입력을 고치라고 하면 방향이 틀린다(설계 §3.3).
      if (context?.rejectionAccepted === true)
        return "거절을 기대하지만 입력이 현재 서버 선언을 어기지 않고, 서버도 이 입력을 받아들였습니다. 명세를 만든 뒤 서버의 입력 제약이 사라졌을 수 있습니다. 의도한 변경이면 이 케이스를 지우고, 아니라면 서버의 입력 스키마와 검증을 확인하세요";
      return "거절을 기대하지만 입력이 서버 선언을 어기지 않습니다. 서버가 선언 밖 제약으로 거절한다면 그대로 두고, 아니라면 입력을 확인하세요";
    case "VACUOUS_MIN_LENGTH":
      return `${path} 는 0이라 모든 문자열이 통과합니다`;
    case "VACUOUS_MIN_ITEMS":
      return `${path} 는 0이라 모든 배열이 통과합니다`;
  }
}

/**
 * 서버가 받아들인 위반 한 건의 문장. 거절 기대 케이스에서 억제되는 다섯 코드만 문장이 있고,
 * 나머지는 undefined 다.
 */
function acceptedSentence(finding: SpecFinding): string | undefined {
  const { expected, actual } = finding;
  const path = escapeInline(finding.path);
  switch (finding.code) {
    case "REQUIRED_MISSING":
      return `서버가 필수 필드 ${literal(expected)} 가 빠진 입력을 받아들였습니다. 서버의 입력 검증을 확인하세요`;
    case "TYPE_MISMATCH":
      return `서버가 ${path} 에 선언과 다른 타입의 값을 받아들였습니다. 서버 선언: ${literal(expected)}, 명세: ${literal(actual)}. 서버의 입력 검증을 확인하세요`;
    case "ENUM_MISMATCH":
      return `서버가 ${path} 에 선언되지 않은 값 ${literal(actual)} 을 받아들였습니다. 허용: ${literal(expected)}. 서버의 입력 검증을 확인하세요`;
    case "RANGE_MISMATCH":
      return `서버가 ${path} 에 선언된 범위 밖의 값 ${literal(actual)} 을 받아들였습니다. 서버 선언: ${describeRange(expected)}. 서버의 입력 검증을 확인하세요`;
    case "UNDECLARED_FIELD":
      // additionalProperties: false 를 선언했을 때만 이 코드가 생긴다(schema.rejectsUndeclared).
      // 그래서 "선언해 두고 받아들였다" 는 사실을 말한다.
      return `서버가 선언하지 않은 필드 ${literal(actual)} 가 든 입력을 받아들였습니다. 서버 스키마는 선언 밖 필드를 거절한다고 선언합니다(additionalProperties: false). 서버의 입력 검증을 확인하세요`;
    default:
      return undefined;
  }
}

/**
 * 거절을 기대한 케이스에서 서버가 받아들인 선언 위반을 한 문장으로 만든다(설계 §3.2).
 * 재료는 `acceptedViolations` 가 돌려준 목록이다. 첫 위반으로 문장을 고르고, 나머지는 수만
 * 말한다. 문장이 없는 코드는 첫 위반에도 나머지 수에도 넣지 않는다. 남는 것이 없으면
 * undefined. 반환에 줄바꿈이 없고 끝에 마침표를 두지 않는다(`describeSpecFinding` 과 같은 규칙).
 */
export function describeAcceptedRejection(findings: readonly SpecFinding[]): string | undefined {
  const sentences = findings
    .map(acceptedSentence)
    .filter((sentence): sentence is string => sentence !== undefined);
  const [first, ...rest] = sentences;
  if (first === undefined) return undefined;
  return rest.length === 0
    ? first
    : `${first}. 이 입력의 다른 위반 ${rest.length}건도 함께 받아들여졌습니다`;
}
