import { describe, expect, it } from "vitest";
import { renderReport } from "../src/report.js";
import type { CallOutcome, CaseResult, Percentiles, PerfReport } from "../src/types.js";

// 설계 §8.3 의 렌더러 규칙을 항목마다 하나씩 전체 문자열로 단언한다(계획 §6.3).
// 입력은 손으로 만든 PerfReport 다. analyze 를 부르지 않는다.

const ZERO_OUTCOMES: Readonly<Record<CallOutcome, number>> = {
  ok: 0,
  isError: 0,
  empty: 0,
  threw: 0,
  skipped: 0,
  missingTool: 0,
};

function pct(p50: number, p95 = p50): Percentiles {
  return { p50, p95, min: p50, max: p95 };
}

/** ok 반복이 있는 케이스. 관측이 있으면 여섯 분해 필드가 들어간다. */
function okCase(
  id: string,
  values: {
    readonly n?: number;
    readonly total: Percentiles;
    readonly external?: Percentiles;
    readonly inside?: Percentiles;
    readonly requests?: Percentiles;
    readonly externalLowerBound?: boolean;
    readonly outcomes?: Partial<Record<CallOutcome, number>>;
    readonly observed?: boolean;
  },
): CaseResult {
  const n = values.n ?? 5;
  const observed = values.observed ?? true;
  const base: CaseResult = {
    id,
    tool: id.replace(/-/g, "_"),
    n,
    outcomes: { ...ZERO_OUTCOMES, ok: n, ...values.outcomes },
    total: values.total,
    dependency: observed
      ? { dependent: 1, independent: 0, unknown: 0 }
      : { dependent: 0, independent: 0, unknown: 0 },
    requestSummaries: [],
  };
  if (!observed) return base;
  return {
    ...base,
    external: values.external ?? pct(0),
    inside: values.inside ?? pct(0),
    requests: values.requests ?? pct(0),
    maxConcurrency: 1,
    externalLowerBound: values.externalLowerBound ?? false,
    afterResponse: 0,
  };
}

/** ok 반복이 0 인 케이스. 통계 필드가 없다. */
function failedCase(
  id: string,
  outcomes: Partial<Record<CallOutcome, number>>,
  firstError?: string,
): CaseResult {
  return {
    id,
    tool: id.replace(/-/g, "_"),
    n: 0,
    outcomes: { ...ZERO_OUTCOMES, ...outcomes },
    ...(firstError === undefined ? {} : { firstError }),
    dependency: { dependent: 0, independent: 0, unknown: 0 },
    requestSummaries: [],
  };
}

function report(
  cases: readonly CaseResult[],
  overrides: Partial<Omit<PerfReport, "cases">> = {},
): PerfReport {
  return {
    schemaVersion: 1,
    generator: { name: "@mcpeak/perf", version: "0.0.0-test" },
    server: { command: "node server.mjs", toolCount: 3 },
    settings: { repeat: 5, intervalMs: 0, caseCount: cases.length, observation: "preload" },
    coldStart: { connectMs: 312, listToolsMs: 4 },
    cases,
    findings: [],
    undecidedCases: 0,
    aborted: null,
    exitCode: 0,
    ...overrides,
  };
}

const FAST = okCase("fast", {
  total: pct(287, 668),
  external: pct(285),
  inside: pct(2),
  requests: pct(2),
});

describe("renderReport", () => {
  it("관측이 있으면 머리 넷째 항목이 프리로드이고 각주가 세 문장이다", () => {
    expect(renderReport(report([FAST]))).toBe(`mcpeak perf 결과
서버 node server.mjs · 도구 3개 · 관측 Node 프리로드(fetch, node:http, http2, undici)
설정 반복 5회 · 호출 간격 0ms · 케이스 1개 (callTool 중 거절 기대 제외)
콜드 스타트 기동+핸드셰이크 312ms · tools/list 4ms

케이스   n  응답 p50  p95  외부 대기 p50  서버 안 p50  외부 요청/호출
fast  5     287  668        285         2         2

진단 없음

외부 대기는 서버 프로세스 안에서 관측한 HTTP 요청(fetch·node:http·http2·undici)의 시작부터 응답 본문 끝까지의 합집합입니다.
서버 안 시간은 응답 시간에서 그것을 뺀 나머지이고, 처리뿐 아니라 레이트리미터·타이머 대기, 첫 연결의 TLS, stdio 전송이 들어 있습니다.
수치는 이 컴퓨터와 이 네트워크에서 잰 값입니다. 전후 비교는 같은 조건에서 --baseline 으로 하세요.
`);
  });

  it("관측이 없으면 머리가 관측 안 함이고 뒤 세 열이 빠지며 진단·각주가 관측 없음 모양이다", () => {
    const unobserved = report([okCase("fast", { total: pct(287, 668), observed: false })], {
      settings: { repeat: 5, intervalMs: 0, caseCount: 1, observation: "none" },
    });
    expect(renderReport(unobserved)).toBe(`mcpeak perf 결과
서버 node server.mjs · 도구 3개 · 관측 안 함(Node 프리로드가 실리지 않음)
설정 반복 5회 · 호출 간격 0ms · 케이스 1개 (callTool 중 거절 기대 제외)
콜드 스타트 기동+핸드셰이크 312ms · tools/list 4ms

케이스   n  응답 p50  p95
fast  5     287  668

진단 없음: 외부 호출을 관측하지 못해 분해와 진단을 하지 않았습니다. Node 서버가 아니거나 NODE_OPTIONS 가 전달되지 않았습니다.

분해와 진단은 Node 서버에 프리로드가 실릴 때만 합니다.
수치는 이 컴퓨터와 이 네트워크에서 잰 값입니다. 전후 비교는 같은 조건에서 --baseline 으로 하세요.
`);
  });

  it("열 너비는 머리글과 값 중 긴 쪽(코드 포인트 수)이고 케이스만 왼쪽 정렬이다", () => {
    const slow = okCase("slow-one", {
      total: pct(1310, 1702),
      external: pct(1301),
      inside: pct(9),
      requests: pct(6),
    });
    const table = renderReport(report([FAST, slow]))
      .split("\n")
      .slice(5, 8)
      .join("\n");
    expect(table).toBe(`케이스       n  응답 p50   p95  외부 대기 p50  서버 안 p50  외부 요청/호출
fast      5     287   668        285         2         2
slow-one  5    1310  1702       1301         9         6`);
  });

  it("숫자는 반올림하고 externalLowerBound 면 외부 대기 앞에 ≥ 를 붙인다", () => {
    const lower = okCase("fast", {
      total: pct(287.4, 667.5),
      external: pct(284.6),
      inside: pct(2.4),
      requests: pct(2),
      externalLowerBound: true,
    });
    expect(renderReport(report([lower]))).toBe(`mcpeak perf 결과
서버 node server.mjs · 도구 3개 · 관측 Node 프리로드(fetch, node:http, http2, undici)
설정 반복 5회 · 호출 간격 0ms · 케이스 1개 (callTool 중 거절 기대 제외)
콜드 스타트 기동+핸드셰이크 312ms · tools/list 4ms

케이스   n  응답 p50  p95  외부 대기 p50  서버 안 p50  외부 요청/호출
fast  5     287  668       ≥285         2         2

진단 없음

외부 대기는 서버 프로세스 안에서 관측한 HTTP 요청(fetch·node:http·http2·undici)의 시작부터 응답 본문 끝까지의 합집합입니다.
서버 안 시간은 응답 시간에서 그것을 뺀 나머지이고, 처리뿐 아니라 레이트리미터·타이머 대기, 첫 연결의 TLS, stdio 전송이 들어 있습니다.
수치는 이 컴퓨터와 이 네트워크에서 잰 값입니다. 전후 비교는 같은 조건에서 --baseline 으로 하세요.
`);
  });

  it("n 이 0 이면 숫자 칸을 비우고 측정 안 됨 비고를 붙인다. 첫 오류는 있을 때만", () => {
    const broken = failedCase("broken", { threw: 5 }, "MCP error -32602: boom");
    const gone = failedCase("gone", { missingTool: 5 });
    expect(renderReport(report([broken, gone]))).toBe(`mcpeak perf 결과
서버 node server.mjs · 도구 3개 · 관측 Node 프리로드(fetch, node:http, http2, undici)
설정 반복 5회 · 호출 간격 0ms · 케이스 2개 (callTool 중 거절 기대 제외)
콜드 스타트 기동+핸드셰이크 312ms · tools/list 4ms

케이스     n  응답 p50  p95  외부 대기 p50  서버 안 p50  외부 요청/호출
broken  0                                              측정 안 됨: threw 5회. 첫 오류: MCP error -32602: boom
gone    0                                              측정 안 됨: missingTool 5회

진단 없음

외부 대기는 서버 프로세스 안에서 관측한 HTTP 요청(fetch·node:http·http2·undici)의 시작부터 응답 본문 끝까지의 합집합입니다.
서버 안 시간은 응답 시간에서 그것을 뺀 나머지이고, 처리뿐 아니라 레이트리미터·타이머 대기, 첫 연결의 TLS, stdio 전송이 들어 있습니다.
수치는 이 컴퓨터와 이 네트워크에서 잰 값입니다. 전후 비교는 같은 조건에서 --baseline 으로 하세요.
`);
  });

  it("n 이 0 이 아니고 실패가 있으면 실패 비고를 §5.4 순서의 사유와 함께 붙인다", () => {
    const partly = okCase("fast", {
      n: 3,
      total: pct(287, 668),
      external: pct(285),
      inside: pct(2),
      requests: pct(2),
      outcomes: { threw: 1, isError: 1 },
    });
    expect(renderReport(report([partly]))).toBe(`mcpeak perf 결과
서버 node server.mjs · 도구 3개 · 관측 Node 프리로드(fetch, node:http, http2, undici)
설정 반복 5회 · 호출 간격 0ms · 케이스 1개 (callTool 중 거절 기대 제외)
콜드 스타트 기동+핸드셰이크 312ms · tools/list 4ms

케이스   n  응답 p50  p95  외부 대기 p50  서버 안 p50  외부 요청/호출
fast  3     287  668        285         2         2  실패 2회(isError 1회, threw 1회)

진단 없음

외부 대기는 서버 프로세스 안에서 관측한 HTTP 요청(fetch·node:http·http2·undici)의 시작부터 응답 본문 끝까지의 합집합입니다.
서버 안 시간은 응답 시간에서 그것을 뺀 나머지이고, 처리뿐 아니라 레이트리미터·타이머 대기, 첫 연결의 TLS, stdio 전송이 들어 있습니다.
수치는 이 컴퓨터와 이 네트워크에서 잰 값입니다. 전후 비교는 같은 조건에서 --baseline 으로 하세요.
`);
  });

  it("aborted 가 있으면 표 뒤 빈 줄 다음에 측정 중단 줄과 빈 줄을 낸다", () => {
    const aborted = report([FAST], { aborted: { caseId: "fast", timeoutMs: 10000 } });
    expect(renderReport(aborted)).toBe(`mcpeak perf 결과
서버 node server.mjs · 도구 3개 · 관측 Node 프리로드(fetch, node:http, http2, undici)
설정 반복 5회 · 호출 간격 0ms · 케이스 1개 (callTool 중 거절 기대 제외)
콜드 스타트 기동+핸드셰이크 312ms · tools/list 4ms

케이스   n  응답 p50  p95  외부 대기 p50  서버 안 p50  외부 요청/호출
fast  5     287  668        285         2         2

측정 중단: 'fast' 호출이 10000ms 안에 끝나지 않아 남은 호출을 하지 않았습니다. 케이스의 timeoutMs 를 올리거나 --tool 로 케이스를 나누세요.

진단 없음

외부 대기는 서버 프로세스 안에서 관측한 HTTP 요청(fetch·node:http·http2·undici)의 시작부터 응답 본문 끝까지의 합집합입니다.
서버 안 시간은 응답 시간에서 그것을 뺀 나머지이고, 처리뿐 아니라 레이트리미터·타이머 대기, 첫 연결의 TLS, stdio 전송이 들어 있습니다.
수치는 이 컴퓨터와 이 네트워크에서 잰 값입니다. 전후 비교는 같은 조건에서 --baseline 으로 하세요.
`);
  });

  it("진단이 있으면 건수 줄과 → 를 붙인 findings 줄을 순서대로 낸다", () => {
    const diagnosed = report([FAST], {
      findings: [
        {
          ruleId: "perf/sequential-independent",
          caseIds: ["fast"],
          tools: ["fast"],
          lines: [
            "'fast' 호출 안에서 독립 요청 2건이 순차로 나갑니다 (5회 중 5회): GET h.example/a ×2",
            "병렬로 보내면 최대 약 100ms 줄일 수 있습니다 (p50 기준 상한).",
            "Promise.all 로 한 번에 보내고, 상대 API 의 동시 요청 한도와 429 백오프를 함께 두세요.",
          ],
          evidence: { observed: 5, of: 5, requests: ["GET h.example/a"], savingUpperBoundMs: 100 },
        },
        {
          ruleId: "perf/repeated-request",
          caseIds: ["fast"],
          tools: ["fast"],
          lines: [
            "'fast' 호출 한 번에 같은 요청을 2번 보냅니다 (5회 중 5회): GET h.example/a",
            "첫 응답을 호출 안에서 재사용하세요.",
          ],
          evidence: { observed: 5, of: 5, requests: ["GET h.example/a"] },
        },
      ],
    });
    expect(renderReport(diagnosed)).toBe(`mcpeak perf 결과
서버 node server.mjs · 도구 3개 · 관측 Node 프리로드(fetch, node:http, http2, undici)
설정 반복 5회 · 호출 간격 0ms · 케이스 1개 (callTool 중 거절 기대 제외)
콜드 스타트 기동+핸드셰이크 312ms · tools/list 4ms

케이스   n  응답 p50  p95  외부 대기 p50  서버 안 p50  외부 요청/호출
fast  5     287  668        285         2         2

진단 2건 (종료 코드에 영향 없음)
→ 'fast' 호출 안에서 독립 요청 2건이 순차로 나갑니다 (5회 중 5회): GET h.example/a ×2
→ 병렬로 보내면 최대 약 100ms 줄일 수 있습니다 (p50 기준 상한).
→ Promise.all 로 한 번에 보내고, 상대 API 의 동시 요청 한도와 429 백오프를 함께 두세요.
→ 'fast' 호출 한 번에 같은 요청을 2번 보냅니다 (5회 중 5회): GET h.example/a
→ 첫 응답을 호출 안에서 재사용하세요.

외부 대기는 서버 프로세스 안에서 관측한 HTTP 요청(fetch·node:http·http2·undici)의 시작부터 응답 본문 끝까지의 합집합입니다.
서버 안 시간은 응답 시간에서 그것을 뺀 나머지이고, 처리뿐 아니라 레이트리미터·타이머 대기, 첫 연결의 TLS, stdio 전송이 들어 있습니다.
수치는 이 컴퓨터와 이 네트워크에서 잰 값입니다. 전후 비교는 같은 조건에서 --baseline 으로 하세요.
`);
  });

  it("undecidedCases 가 0 이 아니면 진단 절 끝에 판정 불가 줄을 → 없이 낸다", () => {
    const undecided = report([FAST], { undecidedCases: 2 });
    expect(renderReport(undecided)).toBe(`mcpeak perf 결과
서버 node server.mjs · 도구 3개 · 관측 Node 프리로드(fetch, node:http, http2, undici)
설정 반복 5회 · 호출 간격 0ms · 케이스 1개 (callTool 중 거절 기대 제외)
콜드 스타트 기동+핸드셰이크 312ms · tools/list 4ms

케이스   n  응답 p50  p95  외부 대기 p50  서버 안 p50  외부 요청/호출
fast  5     287  668        285         2         2

진단 없음
판정 불가: 2개 케이스는 응답이나 요청 본문을 못 보는 경로(node:http·http2·undici, 스트림 본문)라 독립 여부를 가리지 못했습니다.

외부 대기는 서버 프로세스 안에서 관측한 HTTP 요청(fetch·node:http·http2·undici)의 시작부터 응답 본문 끝까지의 합집합입니다.
서버 안 시간은 응답 시간에서 그것을 뺀 나머지이고, 처리뿐 아니라 레이트리미터·타이머 대기, 첫 연결의 TLS, stdio 전송이 들어 있습니다.
수치는 이 컴퓨터와 이 네트워크에서 잰 값입니다. 전후 비교는 같은 조건에서 --baseline 으로 하세요.
`);
  });

  it("baseline 이 있으면 기준선 절을 진단 절과 각주 사이에 낸다", () => {
    const compared = report([FAST], {
      baseline: {
        path: "perf.baseline.json",
        settingsMismatch: false,
        lines: [
          "'fast' 호출당 외부 요청 2건, 기준 1건",
          "이 변경이 의도된 것이라면 --update-baseline 으로 기준을 갱신하세요.",
        ],
        regressedCaseIds: ["fast"],
      },
      exitCode: 2,
    });
    expect(renderReport(compared)).toBe(`mcpeak perf 결과
서버 node server.mjs · 도구 3개 · 관측 Node 프리로드(fetch, node:http, http2, undici)
설정 반복 5회 · 호출 간격 0ms · 케이스 1개 (callTool 중 거절 기대 제외)
콜드 스타트 기동+핸드셰이크 312ms · tools/list 4ms

케이스   n  응답 p50  p95  외부 대기 p50  서버 안 p50  외부 요청/호출
fast  5     287  668        285         2         2

진단 없음

기준선 비교 (perf.baseline.json)
→ 'fast' 호출당 외부 요청 2건, 기준 1건
→ 이 변경이 의도된 것이라면 --update-baseline 으로 기준을 갱신하세요.

외부 대기는 서버 프로세스 안에서 관측한 HTTP 요청(fetch·node:http·http2·undici)의 시작부터 응답 본문 끝까지의 합집합입니다.
서버 안 시간은 응답 시간에서 그것을 뺀 나머지이고, 처리뿐 아니라 레이트리미터·타이머 대기, 첫 연결의 TLS, stdio 전송이 들어 있습니다.
수치는 이 컴퓨터와 이 네트워크에서 잰 값입니다. 전후 비교는 같은 조건에서 --baseline 으로 하세요.
`);
  });

  it("출력은 개행 하나로 끝나고 같은 리포트에 같은 문자열을 낸다", () => {
    const first = renderReport(report([FAST]));
    expect(first.endsWith("\n")).toBe(true);
    expect(first.endsWith("\n\n")).toBe(false);
    expect(renderReport(report([FAST]))).toBe(first);
  });
});
