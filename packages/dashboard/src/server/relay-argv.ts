/**
 * 중계기에 붙는 `claude` 의 argv. **순수 함수** — 환경도 시간도 읽지 않는다.
 *
 * 집 방식(`packages/generate/src/providers.ts` 의 `claudeSpec`)과 **모양이 같고 세 칸만
 * 다르다**: `--allowedTools` 가 붙고, `--mcp-config` 가 중계기를 가리키며, `--json-schema`
 * 가 없다. 두 벌이 된 것이 아니라 **역할이 다르다** — 저자(generate·repair)는 MCP 를 닫고
 * 스키마로 묶지만, 여기 AI 는 운전기사라 아무것도 지어내지 않고 사용자의 서버를 대신 두드릴
 * 뿐이다(설계 §5, ADR-0079·ADR-0104).
 */

/** MCP 설정의 서버 이름. `--allowedTools` 의 `mcp__target` 과 짝이다. 바꾸면 둘 다 바꾼다. */
const SERVER_NAME = "target";

export interface RelayAiArgsInput {
  /**
   * `MODEL_OPTIONS.claude` 의 값 하나. **지금 UI 는 고를 자리를 주지 않고** 홈 화면의
   * `RELAY_MODEL` 상수가 그중 하나로 고정한다(`web/src/screens/Home.tsx`, 이유는 거기
   * 주석에). 통로는 열려 있으니 그 상수를 목록에서 읽게 바꾸면 그대로 돈다.
   */
  readonly model: string;
  /** 중계기 기동 줄이 준 URL. `http://127.0.0.1:<port>/mcp` */
  readonly url: string;
  /** 대시보드가 매긴 짧은 케이스 꼬리표(`c1` …). 중계기가 기록 줄에 그대로 옮긴다. */
  readonly tag: string;
}

export function buildRelayAiArgs(input: RelayAiArgsInput): readonly string[] {
  // `URL` 로 조립하지 않는다 — 그러면 기본 포트·후행 슬래시가 정규화돼 중계기가 준 문자열과
  // 달라질 수 있고, 화면에 보이는 URL 과 실제로 간 URL 이 갈리면 진단할 방법이 없다.
  const separator = input.url.includes("?") ? "&" : "?";
  const url = `${input.url}${separator}case=${encodeURIComponent(input.tag)}`;
  return [
    "-p",
    "--model",
    input.model,
    // 내장 도구는 끈 채로 둔다. MCP 툴은 아래 `--allowedTools` 가 따로 연다 —
    // 둘이 별개 축이라는 것을 계획 단계에서 실측으로 확인했다.
    "--tools",
    "",
    "--no-session-persistence",
    "--strict-mcp-config",
    // **이것이 없으면 툴을 한 번도 못 부른다.** `system permission_denied` 가 나는데
    // 종료 코드는 0 이다(설계 §3). 빠뜨려도 조용히 지나가는 종류의 실수라 테스트로 건다.
    "--allowedTools",
    `mcp__${SERVER_NAME}`,
    "--mcp-config",
    JSON.stringify({ mcpServers: { [SERVER_NAME]: { type: "http", url } } }),
    "--output-format",
    "json",
  ];
}
