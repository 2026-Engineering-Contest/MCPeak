import type { RelayCase, RelayEvent } from "../../../src/api-types.js";

/**
 * 케이스 칸 하나의 상태.
 *
 * `noCall` 이 `waiting` 과 **다른 상태인 것이 요점이다.** 실측에서 AI 가 권한에 막혀 툴을
 * 한 번도 안 불렀고(설계 §3), 그때 빈 칸만 보이면 사용자는 자기 서버가 고장난 줄 안다.
 */
export type CaseCardStatus = "waiting" | "ok" | "toolError" | "protocolError" | "noCall";

export interface CaseCall {
  readonly tool?: string;
  readonly args?: unknown;
}

export interface CaseResult {
  readonly ok: boolean;
  readonly bytes?: number;
  readonly ms?: number;
  readonly body?: unknown;
  readonly code?: number;
  readonly message?: string;
}

export interface CaseCard {
  readonly id: string;
  readonly tool: string;
  readonly input: unknown;
  readonly status: CaseCardStatus;
  readonly calls: readonly CaseCall[];
  readonly results: readonly CaseResult[];
}

/** 칸의 상태를 바꾸는 것은 **툴 호출뿐이다.** initialize·tools/list 는 왕복이지 호출이 아니다. */
const TOOL_CALL = "tools/call";

export function toCaseCards(
  cases: readonly RelayCase[],
  events: readonly RelayEvent[],
): readonly CaseCard[] {
  const calls = new Map<string, CaseCall[]>();
  const results = new Map<string, CaseResult[]>();
  const finished = new Set<string>();
  // 응답 줄에는 method 가 없다(`relay-log.ts`). 툴 호출의 응답인지는 **같은 꼬리표의
  // 마지막 요청이 tools/call 이었는지**로 본다 — 중계기는 요청·응답을 짝지어 순서대로 낸다.
  const lastWasToolCall = new Map<string, boolean>();

  for (const event of events) {
    if (event.kind === "aiDone") {
      finished.add(event.case);
      continue;
    }
    // 꼬리표가 없는 줄은 어느 칸에도 넣지 않는다. 어느 케이스의 것인지 말할 근거가 없다.
    if (event.kind === "call") {
      if (event.case === undefined) continue;
      lastWasToolCall.set(event.case, event.method === TOOL_CALL);
      if (event.method !== TOOL_CALL) continue;
      const list = calls.get(event.case) ?? [];
      list.push({
        ...(event.tool === undefined ? {} : { tool: event.tool }),
        ...(event.args === undefined ? {} : { args: event.args }),
      });
      calls.set(event.case, list);
      continue;
    }
    if (event.kind === "result") {
      if (event.case === undefined || lastWasToolCall.get(event.case) !== true) continue;
      const list = results.get(event.case) ?? [];
      const { kind: _kind, id: _id, case: _case, tool: _tool, ...rest } = event;
      list.push(rest);
      results.set(event.case, list);
    }
  }

  return cases.map((relayCase) => {
    const ownCalls = calls.get(relayCase.tag) ?? [];
    const ownResults = results.get(relayCase.tag) ?? [];
    const last = ownResults.at(-1);
    const status: CaseCardStatus =
      last === undefined
        ? // AI 가 끝났는데 툴 호출이 한 건도 없으면 「호출 없음」이다. 끝나기 전이면 아직 기다린다.
          finished.has(relayCase.id) && ownCalls.length === 0
          ? "noCall"
          : "waiting"
        : last.ok
          ? "ok"
          : last.code === undefined
            ? "toolError"
            : "protocolError";
    return {
      id: relayCase.id,
      tool: relayCase.tool,
      input: relayCase.input,
      status,
      calls: ownCalls,
      results: ownResults,
    };
  });
}
