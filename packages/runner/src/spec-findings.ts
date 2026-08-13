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
  // 단언 실질성
  | "UNCONSTRAINED_SCHEMA" // 제약이 하나도 없는 스키마
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
 * 값을 문장에 넣을 표기로 만든다. 설계 문서 §7의 규칙이다.
 * 문자열은 작은따옴표로 감싸고, 그 외 JSON 값은 JSON.stringify 결과를 그대로 쓴다.
 * 로캘에 의존하지 않으며 같은 값은 항상 같은 문자열이 된다.
 */
const literal = (value: JsonValue | undefined): string =>
  typeof value === "string" ? `'${value}'` : JSON.stringify(value);

/** suggestion은 언제나 문자열이므로 작은따옴표만 붙인다. */
const suggest = (finding: SpecFinding, tail: string): string =>
  finding.suggestion === undefined ? "" : `. ${tail}: '${finding.suggestion}'`;

/**
 * finding 한 건을 사용자가 읽는 한 문장으로 만든다.
 * 문안은 설계 문서 §7에 전량으로 있다. 소비자는 이 함수만 쓰고 문장을 새로 짓지 않는다.
 * 반환에 줄바꿈이 없다. 들여쓰기와 화살표는 소비자가 붙인다.
 */
export function describeSpecFinding(finding: SpecFinding): string {
  const { path, expected, actual } = finding;
  switch (finding.code) {
    case "TOOL_NOT_DECLARED":
      return `서버가 선언하지 않은 툴입니다: ${literal(actual)}${suggest(finding, "비슷한 툴")}`;
    case "REQUIRED_MISSING":
      return `필수 필드 ${literal(expected)} 가 입력에 없습니다${suggest(finding, "비슷한 필드")}`;
    case "UNDECLARED_FIELD":
      return `${literal(actual)} 는 서버가 선언하지 않은 필드입니다${suggest(finding, "비슷한 필드")}`;
    case "TYPE_MISMATCH":
      return `${path} 의 타입이 다릅니다. 선언: ${literal(expected)}, 명세: ${literal(actual)}`;
    case "ENUM_MISMATCH":
      return `${path} 값 ${literal(actual)} 는 선언된 값이 아닙니다. 허용: ${literal(expected)}${suggest(finding, "비슷한 값")}`;
    case "SCHEMA_NOT_ANALYZABLE":
      return `${literal(actual)} 의 입력 스키마를 해석하지 못해 이 툴의 입력 검사를 건너뜁니다`;
    case "UNCONSTRAINED_SCHEMA":
      return `${path} 스키마에 제약이 없어 어떤 응답이든 통과합니다`;
    case "VACUOUS_MIN_LENGTH":
      return `${path} 는 0이라 모든 문자열이 통과합니다`;
    case "VACUOUS_MIN_ITEMS":
      return `${path} 는 0이라 모든 배열이 통과합니다`;
  }
}
