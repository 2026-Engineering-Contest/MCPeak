export const BASE_PROMPT =
  "이 디렉터리의 everything-server.ts 는 MCP 서버다. 이 서버가 MCP 사양을 위반하는 결함이 있다는\n" +
  "보고를 받았다. 결함을 찾아 고쳐라. 결함과 관계없는 코드는 바꾸지 마라.";

const DIAGNOSIS_HEADER = "아래는 테스트 도구 mcpeak 이 이 서버를 검사하고 낸 진단이다.";
const NO_FAILURE_LINE = "mcpeak 은 이 서버에서 실패를 찾지 못했다.";

export function buildPrompt(condition: "plain" | "diagnosed", diagnosis: string | null): string {
  if (condition === "plain") return BASE_PROMPT;
  const body = diagnosis === null ? NO_FAILURE_LINE : diagnosis;
  return `${BASE_PROMPT}\n\n${DIAGNOSIS_HEADER}\n${body}`;
}
