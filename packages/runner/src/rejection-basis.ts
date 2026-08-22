/**
 * 거절 근거 확인 (이슈 #89 · 설계 문서 §4).
 *
 * 위반 케이스의 단언은 `isError: true` 하나라 **서버가 입력을 정상 거절한 것**과 **서버가 다른
 * 이유로 실패한 것**을 구분하지 못한다. 관찰 80건은 응답 본문 형식으로 그 둘을 가를 수 없음을
 * 보였다(`docs/reports/observation-89-error-body.md`). 크래시를 지목하는 대신 방향을 뒤집어
 * **SDK 검증이 낸 거절임을 양성으로 확인**한다.
 *
 * 이 모듈은 판정을 바꾸지 않는다. 서버를 호출하지 않고 응답 본문 문자열만 보는 순수 함수라
 * 같은 입력에 항상 같은 결과가 나온다.
 */

/** 거절을 기대한 케이스에서, 그 거절의 근거를 확인했는지. */
export type RejectionBasis =
  /** 알려진 입력 검증이 낸 거절임을 지문으로 확인했다. */
  | "verified"
  /** 거절인지 다른 실패인지 확인하지 못했다. 크래시일 수도 있다. */
  | "unverified"
  /** 거절을 기대하지 않는 케이스다. 판정 대상이 아니다. */
  | "notApplicable";

/**
 * MCPeak 목의 스키마 위반 거절 계약 (ADR-0060).
 *
 * 첫 줄은 툴·필드·위반 종류마다 달라지므로 고정된 마지막 두 줄만 지문으로 쓴다. 매칭 미스와
 * 사용자가 주입한 거절에는 이 접미어가 없다. `packages/mock/tests/index-e2e.test.ts` 가 목 쪽
 * 문장을 완전 일치로 고정하고 있다.
 */
const MCPEAK_MOCK_SCHEMA_REJECTION_SUFFIX = [
  "→ 이 툴이 tools/list 로 선언한 inputSchema 가 그렇게 요구합니다.",
  "→ 거절이 의도한 것이면 responses 에 이 인자를 넣어 응답을 지정하세요.",
].join("\n");

/**
 * 거절 근거를 확인한다. 서버를 호출하지 않는다.
 *
 * 화이트리스트다. 모르는 서버·SDK 는 전부 "unverified" 로 떨어진다. 그 방향이 안전한 쪽이다.
 * 반대 방향(크래시를 "verified" 로 찍는 것)은 크래시가 숨는다는 뜻이라 허용하지 않는다.
 */
export function classifyRejectionBasis(options: {
  readonly expectsRejection: boolean;
  readonly toolName: string | null;
  readonly bodyText: string | null;
}): RejectionBasis {
  const { expectsRejection, toolName, bodyText } = options;
  if (!expectsRejection) return "notApplicable";
  if (bodyText === null) return "unverified";
  const text = bodyText.trim();

  // TS SDK. 프로토콜 검증이 낸 잘못된 인자 오류다. 핸들러 코드는 이 접두어를 만들지 않는다.
  if (text.startsWith("MCP error -32602:")) return "verified";

  // Python 하위 SDK. jsonschema 검증 자리에서만 나온다.
  if (text.startsWith("Input validation error:")) return "verified";

  // FastMCP + pydantic. 여기가 위험한 자리다. FastMCP 는 **핸들러가 던진 예외도** 같은
  // 접두어로 감싼다. 실제로 서버가 자기 응답을 pydantic 으로 검증하다 터지면
  //   "Error executing tool get_weather: 2 validation errors for WeatherResponse"
  // 가 나온다. 입력 검증이 낸 것은 모델 이름이 반드시 `<툴이름>Arguments` 다.
  //   "Error executing tool get_weather: 1 validation error for get_weatherArguments"
  // 그래서 툴 이름을 두 번 요구한다. 이 조건을 빼면 서버 결함이 초록으로 숨는다.
  if (toolName !== null) {
    const pattern = new RegExp(
      `^Error executing tool ${escapeRegExp(toolName)}: \\d+ validation errors? for ${escapeRegExp(toolName)}Arguments\\b`,
    );
    if (pattern.test(text)) return "verified";
  }

  // MCPeak 목의 자체 inputSchema 검증. 첫 위반 줄이 반드시 앞에 있고, 고정된 안내 두 줄이
  // 본문의 정확한 끝이어야 한다. 안내만 흉내 내거나 뒤에 다른 오류가 붙은 본문은 인정하지 않는다.
  if (text.endsWith(`\n${MCPEAK_MOCK_SCHEMA_REJECTION_SUFFIX}`)) return "verified";

  return "unverified";
}

/** 툴 이름은 서버가 준 임의 문자열이다. 정규식 메타문자가 들어와도 리터럴로 다뤄야 한다. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
