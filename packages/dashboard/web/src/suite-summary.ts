/**
 * 홈 「명세 확인」의 본문. 스위트 파일 내용을 케이스당 한 줄로 요약한다.
 *
 * CLI `mcpeak generate` 검토 메뉴의 `show` 와 같은 모양이다. 두 자리가 다르게 보이면 사용자는
 * 같은 파일을 두 번 배워야 한다. 전문 JSON 을 그대로 펴지 않는 이유도 같다. 케이스 8건이면
 * 100줄이 넘어 목록을 덮는다.
 *
 * 입력은 서버가 준 파일 문자열이다. 목록에 오른 파일은 서버가 스위트 형식을 통과시킨 것이지만,
 * 여기서도 모양을 다시 본다. 사용자가 그 사이 파일을 고쳤을 수 있고, 깨진 JSON 에 화면 전체가
 * 죽으면 안 된다.
 */

/** 입력 JSON 한 줄 상한. CLI `show` 와 같은 값이다. 넘으면 자른다. */
const MAX_INPUT_CHARS = 80;

export interface SuiteSummary {
  readonly id: string;
  readonly name: string;
  readonly caseCount: number;
  /** 케이스당 한 줄. 번호 · id · 조작 · 단언. */
  readonly lines: readonly string[];
}

export type SuiteSummaryResult =
  | { readonly ok: true; readonly summary: SuiteSummary }
  | { readonly ok: false; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function describeOperation(operation: unknown): string {
  if (!isRecord(operation)) return "(조작 없음)";
  if (operation.type === "listTools") return "listTools";
  if (operation.type === "callTool") {
    const tool = typeof operation.tool === "string" ? operation.tool : "?";
    const input = operation.input === undefined ? "{}" : JSON.stringify(operation.input);
    return `callTool ${tool} ${truncate(input, MAX_INPUT_CHARS)}`;
  }
  return String(operation.type ?? "?");
}

function describeAssertion(assertion: unknown): string {
  if (!isRecord(assertion)) return "?";
  if (assertion.type === "toolExists") return `toolExists ${String(assertion.tool ?? "?")}`;
  if (assertion.type === "isError") return `isError=${String(assertion.expected)}`;
  return String(assertion.type ?? "?");
}

export function summarizeSuite(content: string): SuiteSummaryResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, reason: "올바른 JSON 이 아닙니다." };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.cases)) {
    return { ok: false, reason: "스위트 형식이 아닙니다. cases 배열이 없습니다." };
  }
  const cases = parsed.cases;
  const width = String(cases.length).length;
  const lines = cases.map((testCase, index) => {
    const number = String(index + 1).padStart(width, " ");
    if (!isRecord(testCase)) return `  ${number}. (케이스 형식 아님)`;
    const id = typeof testCase.id === "string" ? testCase.id : "(id 없음)";
    const assertions = Array.isArray(testCase.assertions)
      ? testCase.assertions.map(describeAssertion).join(", ")
      : "(단언 없음)";
    return `  ${number}. ${id}  ${describeOperation(testCase.operation)}  → ${assertions}`;
  });
  return {
    ok: true,
    summary: {
      id: typeof parsed.id === "string" ? parsed.id : "(id 없음)",
      name: typeof parsed.name === "string" ? parsed.name : "(이름 없음)",
      caseCount: cases.length,
      lines,
    },
  };
}
