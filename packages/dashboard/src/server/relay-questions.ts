import type { RelayCase } from "../api-types.js";

/**
 * 고른 스위트를 읽어 케이스마다 질문 하나를 짓는다. **순수 함수** — 파일도 시간도 읽지 않는다.
 *
 * 근거를 스위트로 잡은 이유는 설계 §2-2 다. 툴 목록을 따로 읽지 않는다 — 스위트에 `tool` ·
 * `input` 이 이미 있고, 같은 스위트면 항상 같은 질문이 같은 순서로 나온다. 결정론성이
 * 이 저장소의 핵심 가치이고(`CLAUDE.md`), 질문이 흔들리면 같은 화면을 두 번 볼 수 없다.
 */

export interface RelayPlan {
  readonly cases: readonly RelayCase[];
  /** `tag` → AI 에게 stdin 으로 갈 질문. */
  readonly prompts: Readonly<Record<string, string>>;
  /** 질문을 못 지은 케이스의 id. **조용히 버리지 않는다.** */
  readonly skipped: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 질문 문안. 한 줄짜리 지시가 아니라 **재료를 그대로 보인다** — AI 는 여기서 저자가 아니라
 * 운전기사이고(설계 §5), 지어낼 여지를 줄일수록 사용자가 보는 것이 자기 케이스에 가깝다.
 */
function question(tool: string, input: unknown): string {
  return [
    "연결된 MCP 서버(target)의 툴을 한 번 호출하세요.",
    `툴 이름: ${tool}`,
    `입력(JSON): ${JSON.stringify(input ?? {})}`,
    "입력을 고치지 말고 그대로 보내세요. 호출이 실패해도 다시 시도하지 마세요.",
    "결과를 요약하지 말고 받은 그대로 한 번만 알려주세요.",
  ].join("\n");
}

export function planRelayCases(content: string): RelayPlan | { readonly error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      error:
        "→ 스위트 파일이 올바른 JSON 이 아닙니다.\n→ 2 단계에서 고른 파일을 열어 JSON 형식을 확인하세요.",
    };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.cases)) {
    return {
      error:
        "→ 스위트에 cases 배열이 없습니다.\n→ mcpeak generate 가 만든 스위트 파일인지 확인하세요.",
    };
  }
  const cases: RelayCase[] = [];
  const prompts: Record<string, string> = {};
  const skipped: string[] = [];
  // 파일 순서를 그대로 쓴다. 정렬하지 않는다 — 같은 스위트가 항상 같은 순서로 나와야 한다.
  for (const [index, testCase] of parsed.cases.entries()) {
    const id =
      isRecord(testCase) && typeof testCase.id === "string"
        ? testCase.id
        : `(id 없음 #${index + 1})`;
    const operation = isRecord(testCase) ? testCase.operation : undefined;
    if (
      !isRecord(operation) ||
      operation.type !== "callTool" ||
      typeof operation.tool !== "string"
    ) {
      skipped.push(id);
      continue;
    }
    // 꼬리표는 **남은 케이스 수** 로 매긴다. 건너뛴 것이 번호를 먹으면 `c2` 가 비는데,
    // 그 빈 번호는 아무 데도 나타나지 않아 사람이 읽을 때 설명할 길이 없다.
    const tag = `c${cases.length + 1}`;
    cases.push({ id, tag, tool: operation.tool, input: operation.input });
    prompts[tag] = question(operation.tool, operation.input);
  }
  if (cases.length === 0) {
    return {
      error: [
        "→ 이 스위트에는 툴을 부르는 케이스가 없습니다. 실제 응답을 볼 대상이 없습니다.",
        `→ 건너뛴 케이스 ${skipped.length} 건: ${skipped.join(", ")}`,
        "→ operation.type 이 callTool 인 케이스가 있는 스위트를 고르세요.",
      ].join("\n"),
    };
  }
  return { cases, prompts, skipped };
}
