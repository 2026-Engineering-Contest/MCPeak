import type { SpecFindingCode } from "@ohmymcp/runner";

/**
 * finding 이 어느 블록에 들어가는지. `skipped` 는 위반이 아니다. 서버 스키마를 우리가 못 읽은
 * 것이지 명세가 틀린 게 아니다.
 */
export type FindingGroup = "inputContract" | "assertionSubstance" | "rejectionIntent" | "skipped";

/**
 * finding 코드를 검사 종류로 가른다. `Record<SpecFindingCode, …>` 라서 `runner` 가 코드를
 * 늘리면 여기서 타입 오류가 난다. 문자열 배열로 두면 새 코드가 어느 블록에도 못 들어간 채
 * 조용히 사라지고, 이 화면에서 누락은 "위반이 없다" 로 읽히므로 가장 나쁜 실패다.
 *
 * **이 표는 한 벌이다.** `generate` 와 `test` 가 같은 표를 각자 갖고 있던 때는, 새 코드가 왔을 때
 * 두 곳을 채우면서 서로 다른 종류를 고를 수 있었다. 둘 다 `FindingGroup` 의 유효한 값이라
 * 컴파일러도 테스트도 잡지 못하고, 같은 finding 이 화면마다 다른 머리글 아래 뜬다. 그러면 읽는
 * 사람이 멀쩡한 입력을 고치러 간다(이슈 #154).
 */
export const FINDING_GROUP: Readonly<Record<SpecFindingCode, FindingGroup>> = {
  TOOL_NOT_DECLARED: "inputContract",
  REQUIRED_MISSING: "inputContract",
  UNDECLARED_FIELD: "inputContract",
  TYPE_MISMATCH: "inputContract",
  ENUM_MISMATCH: "inputContract",
  RANGE_MISMATCH: "inputContract",
  SCHEMA_NOT_ANALYZABLE: "skipped",
  REJECTION_WITHOUT_VIOLATION: "rejectionIntent",
  VACUOUS_MIN_LENGTH: "assertionSubstance",
  VACUOUS_MIN_ITEMS: "assertionSubstance",
};
