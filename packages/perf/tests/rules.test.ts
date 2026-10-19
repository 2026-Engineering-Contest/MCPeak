import { describe, expect, it } from "vitest";
import { runRules } from "../src/rules.js";
import type {
  ObservedRequest,
  PerfFinding,
  PerfMeasurement,
  PerfPlan,
  TraceVia,
} from "../src/types.js";

// 설계 §6.2·§6.3 진단 규칙. 측정과 배정은 손으로 만든다(assignRequests 를 부르지 않는다).

const T = 1_700_000_000_000;
const REPEAT = 5;

/** 호출 시작 기준 오프셋으로 적은 요청 하나. */
interface RequestSpec {
  readonly url: string;
  readonly t0: number;
  readonly tEnd: number;
  readonly method?: string;
  readonly via?: TraceVia;
  /** 없으면 200. null 이면 status 를 싣지 않는다. */
  readonly status?: number | null;
  /** 없으면 via 가 fetch 일 때 `{}`, 아니면 본문 없음. */
  readonly body?: string;
  readonly requestBodyUnknown?: true;
}

interface CaseSpec {
  readonly id: string;
  readonly tool?: string;
  readonly input?: Readonly<Record<string, unknown>>;
  /** 호출 길이(t1 − t0). */
  readonly length: number;
  readonly requests: (iteration: number) => readonly RequestSpec[];
}

function build(cases: readonly CaseSpec[]): {
  readonly plan: PerfPlan;
  readonly measurements: readonly PerfMeasurement[];
  readonly assigned: ReadonlyMap<PerfMeasurement, readonly ObservedRequest[]>;
} {
  const measurements: PerfMeasurement[] = [];
  const assigned = new Map<PerfMeasurement, ObservedRequest[]>();
  let seq = 0;
  cases.forEach((spec, k) => {
    for (let i = 0; i < REPEAT; i += 1) {
      const base = T + (k * REPEAT + i) * 10_000;
      const measurement: PerfMeasurement = {
        caseId: spec.id,
        tool: spec.tool ?? "t",
        iteration: i,
        t0: base,
        t1: base + spec.length,
        outcome: "ok",
      };
      measurements.push(measurement);
      const list = spec
        .requests(i)
        .map((r): ObservedRequest => {
          seq += 1;
          const via = r.via ?? "fetch";
          const body = r.body ?? (via === "fetch" ? "{}" : undefined);
          const status = r.status === undefined ? 200 : r.status;
          return {
            pid: 1,
            seq,
            via,
            method: r.method ?? "GET",
            url: r.url,
            ...(r.requestBodyUnknown === undefined ? {} : { requestBodyUnknown: true as const }),
            t0: base + r.t0,
            ...(status === null ? {} : { status }),
            ...(body === undefined ? {} : { responseBody: body }),
            tHeaders: base + r.tEnd,
            tEnd: base + r.tEnd,
            bodyEnd: true,
          };
        })
        .sort((a, b) => a.t0 - b.t0 || a.seq - b.seq);
      assigned.set(measurement, list);
    }
  });
  const plan: PerfPlan = {
    calls: cases.map((spec) => ({
      caseId: spec.id,
      tool: spec.tool ?? "t",
      input: spec.input ?? {},
      timeoutMs: 10_000,
    })),
    repeat: REPEAT,
    intervalMs: 0,
  };
  return { plan, measurements, assigned };
}

function only(findings: readonly PerfFinding[], ruleId: PerfFinding["ruleId"]): PerfFinding[] {
  return findings.filter((finding) => finding.ruleId === ruleId);
}

describe("runRules: perf/sequential-independent", () => {
  it("독립 순차 요청 1건이면 발동하고 상한은 외부 대기 − 임계 경로", () => {
    const result = runRules(
      build([
        {
          id: "c",
          length: 260,
          requests: () => [
            { url: "https://h.example/a", t0: 0, tEnd: 100, body: '{"v":"alpha-000"}' },
            { url: "https://h.example/b", t0: 100, tEnd: 250 },
          ],
        },
      ]),
    );
    expect(result.findings).toEqual([
      {
        ruleId: "perf/sequential-independent",
        caseIds: ["c"],
        tools: ["t"],
        lines: [
          "'t' 호출 안에서 독립 요청 1건이 순차로 나갑니다 (5회 중 5회): GET h.example/b",
          "병렬로 보내면 최대 약 100ms 줄일 수 있습니다 (p50 기준 상한).",
          "Promise.all 로 한 번에 보내고, 상대 API 의 동시 요청 한도와 429 백오프를 함께 두세요.",
        ],
        evidence: {
          observed: 5,
          of: 5,
          requests: ["GET h.example/b"],
          savingUpperBoundMs: 100,
        },
      },
    ]);
    expect(result.undecidedCases).toBe(0);
    expect(result.dependency.get("c")).toEqual({ dependent: 0, independent: 5, unknown: 0 });
  });

  it("임계 경로는 의존 체인을 따라간다", () => {
    // G_i 의 응답 토큰이 F_i 의 URL 에 들어가고, 나머지 쌍은 서로 무관하다.
    const chain = (j: number, start: number): RequestSpec[] => [
      {
        url: `https://h.example/g?n=${j}`,
        t0: start,
        tEnd: start + 40,
        body: `{"id":"g-token-${j}"}`,
      },
      {
        url: `https://h.example/f/g-token-${j}`,
        t0: start + 40,
        tEnd: start + 440,
        body: `{"temp":"f-value-${j}"}`,
      },
    ];
    const result = runRules(
      build([
        {
          id: "c",
          length: 1330,
          requests: () => [...chain(1, 0), ...chain(2, 440), ...chain(3, 880)],
        },
      ]),
    );
    const [finding] = only(result.findings, "perf/sequential-independent");
    expect(finding?.evidence).toEqual({
      observed: 5,
      of: 5,
      requests: ["GET h.example/g?n=… ×2"],
      savingUpperBoundMs: 880,
    });
    expect(finding?.lines[0]).toBe(
      "'t' 호출 안에서 독립 요청 2건이 순차로 나갑니다 (5회 중 5회): GET h.example/g?n=… ×2",
    );
    expect(result.dependency.get("c")).toEqual({ dependent: 15, independent: 10, unknown: 0 });
  });

  it("하나라도 dependent 면 그 요청은 순차 독립이 아니다", () => {
    // C 는 A 에 의존하고 B 와는 무관하다. B 만 독립 순차 요청이다.
    const result = runRules(
      build([
        {
          id: "c",
          length: 400,
          requests: () => [
            { url: "https://h.example/a", t0: 0, tEnd: 100, body: '{"id":"from-a-1234"}' },
            { url: "https://h.example/b", t0: 100, tEnd: 200, body: '{"id":"from-b-5678"}' },
            { url: "https://h.example/c/from-a-1234", t0: 200, tEnd: 300 },
          ],
        },
      ]),
    );
    expect(result.dependency.get("c")).toEqual({ dependent: 5, independent: 5, unknown: 0 });
    const [finding] = only(result.findings, "perf/sequential-independent");
    expect(finding?.evidence.requests).toEqual(["GET h.example/b"]);
    // 임계 경로 A→C 200, 외부 대기 300.
    expect(finding?.evidence.savingUpperBoundMs).toBe(100);
  });

  it("unknown 이 섞이면 발동하지 않고 undecidedCases 가 1", () => {
    const result = runRules(
      build([
        {
          id: "c",
          length: 260,
          requests: () => [
            { url: "https://h.example/a", t0: 0, tEnd: 100, via: "node:http" },
            { url: "https://h.example/b", t0: 100, tEnd: 250 },
          ],
        },
      ]),
    );
    expect(result.findings).toEqual([]);
    expect(result.undecidedCases).toBe(1);
    expect(result.dependency.get("c")).toEqual({ dependent: 0, independent: 0, unknown: 5 });
  });

  it("이미 겹친 요청은 순차가 아니다", () => {
    // hackernews 모양: 목록 하나 뒤에 항목 30개를 한꺼번에 보낸다.
    const ids = Array.from({ length: 30 }, (_, j) => 39_000_001 + j);
    const result = runRules(
      build([
        {
          id: "c",
          length: 300,
          requests: () => [
            { url: "https://hn.example/top.json", t0: 0, tEnd: 100, body: JSON.stringify(ids) },
            ...ids.map((id, j) => ({
              url: `https://hn.example/item/${id}.json`,
              t0: 100,
              tEnd: 200 + j,
            })),
          ],
        },
      ]),
    );
    expect(only(result.findings, "perf/sequential-independent")).toEqual([]);
    expect(result.undecidedCases).toBe(0);
    // 첫 항목만 목록이 끝난 뒤 시작한 순차 요청이고, 목록의 id 를 쓰므로 dependent 다.
    expect(result.dependency.get("c")).toEqual({ dependent: 5, independent: 0, unknown: 0 });
  });

  it("과반 미만 관측은 발동하지 않는다", () => {
    const result = runRules(
      build([
        {
          id: "c",
          length: 260,
          requests: (i) => [
            { url: "https://h.example/a", t0: 0, tEnd: 100 },
            // 2회만 순차, 나머지 3회는 겹친다.
            { url: "https://h.example/b", t0: i < 2 ? 100 : 50, tEnd: 250 },
          ],
        },
      ]),
    );
    expect(result.findings).toEqual([]);
    expect(result.undecidedCases).toBe(0);
    expect(result.dependency.get("c")).toEqual({ dependent: 0, independent: 2, unknown: 0 });
  });

  it("종류가 셋을 넘으면 셋까지만 적고 외 r종을 붙인다", () => {
    const paths = ["a", "b", "c", "d", "e", "f"];
    const result = runRules(
      build([
        {
          id: "c",
          length: 700,
          requests: () =>
            paths.map((p, j) => ({
              url: `https://h.example/${p}`,
              t0: j * 100,
              tEnd: j * 100 + 100,
            })),
        },
      ]),
    );
    const [finding] = only(result.findings, "perf/sequential-independent");
    expect(finding?.lines[0]).toBe(
      "'t' 호출 안에서 독립 요청 5건이 순차로 나갑니다 (5회 중 5회): GET h.example/b, GET h.example/c, GET h.example/d 외 2종",
    );
    expect(finding?.evidence.savingUpperBoundMs).toBe(500);
  });

  it("ok 가 아닌 반복은 세지 않는다", () => {
    const spec = build([
      {
        id: "c",
        length: 260,
        requests: () => [
          { url: "https://h.example/a", t0: 0, tEnd: 100 },
          { url: "https://h.example/b", t0: 100, tEnd: 250 },
        ],
      },
    ]);
    // 5회 중 3회를 실패로 바꾸면 ok 2회 중 2회가 된다.
    const measurements = spec.measurements.map((m, i) =>
      i < 3 ? { ...m, outcome: "threw" as const, detail: "x" } : m,
    );
    const assigned = new Map(
      [...spec.assigned].map(([m, list], i) => [measurements[i] as PerfMeasurement, list] as const),
    );
    const result = runRules({ plan: spec.plan, measurements, assigned });
    expect(result.findings[0]?.lines[0]).toBe(
      "'t' 호출 안에서 독립 요청 1건이 순차로 나갑니다 (2회 중 2회): GET h.example/b",
    );
    expect(result.dependency.get("c")).toEqual({ dependent: 0, independent: 2, unknown: 0 });
  });
});

describe("runRules: perf/repeated-request", () => {
  it("호출 안 같은 키 2번이고 첫 status 200 이면 (a)", () => {
    const result = runRules(
      build([
        {
          id: "c",
          length: 100,
          requests: () => [
            { url: "https://h.example/robots.txt", t0: 0, tEnd: 50, body: "User-agent: *" },
            { url: "https://h.example/robots.txt", t0: 10, tEnd: 60, body: "User-agent: *" },
          ],
        },
      ]),
    );
    expect(only(result.findings, "perf/repeated-request")).toEqual([
      {
        ruleId: "perf/repeated-request",
        caseIds: ["c"],
        tools: ["t"],
        lines: [
          "'t' 호출 한 번에 같은 요청을 2번 보냅니다 (5회 중 5회): GET h.example/robots.txt",
          "첫 응답을 호출 안에서 재사용하세요.",
        ],
        evidence: { observed: 5, of: 5, requests: ["GET h.example/robots.txt"] },
      },
    ]);
  });

  it("첫 status 가 429 인 재시도는 (a) 가 아니다", () => {
    const result = runRules(
      build([
        {
          id: "c",
          length: 100,
          requests: () => [
            { url: "https://h.example/x", t0: 0, tEnd: 50, status: 429 },
            { url: "https://h.example/x", t0: 10, tEnd: 60 },
          ],
        },
      ]),
    );
    expect(only(result.findings, "perf/repeated-request")).toEqual([]);
  });

  it("status 가 없는 경로는 (a) 가 아니다", () => {
    const result = runRules(
      build([
        {
          id: "c",
          length: 100,
          requests: () => [
            { url: "https://h.example/x", t0: 0, tEnd: 50, via: "undici", status: null },
            { url: "https://h.example/x", t0: 10, tEnd: 60, via: "undici", status: null },
          ],
        },
      ]),
    );
    expect(only(result.findings, "perf/repeated-request")).toEqual([]);
  });

  it("본문을 못 본 POST 2건은 (a) 가 아니다", () => {
    const result = runRules(
      build([
        {
          id: "c",
          length: 100,
          requests: () => [
            {
              url: "https://h.example/graphql",
              t0: 0,
              tEnd: 50,
              via: "node:http",
              method: "POST",
              requestBodyUnknown: true,
            },
            {
              url: "https://h.example/graphql",
              t0: 10,
              tEnd: 60,
              via: "node:http",
              method: "POST",
              requestBodyUnknown: true,
            },
          ],
        },
      ]),
    );
    expect(only(result.findings, "perf/repeated-request")).toEqual([]);
  });

  it("서로 다른 케이스에서 같은 키·같은 지문이면 (b)", () => {
    const config = (body: (k: number) => string) =>
      build(
        ["c1", "c2"].map((id, k) => ({
          id,
          length: 30,
          requests: () => [{ url: "https://h.example/config", t0: 0, tEnd: 20, body: body(k) }],
        })),
      );

    const same = runRules(config(() => '{"flag":"on"}'));
    expect(only(same.findings, "perf/repeated-request")).toEqual([
      {
        ruleId: "perf/repeated-request",
        caseIds: ["c1", "c2"],
        tools: ["t"],
        lines: [
          "'t' 가 입력이 달라도 매 호출 같은 요청에 같은 응답을 받습니다 (케이스 2개, 호출 10회, p50 20ms): GET h.example/config",
          "프로세스 안에서 캐시하거나 시작할 때 한 번만 받으세요.",
        ],
        evidence: { observed: 10, of: 10, requests: ["GET h.example/config"] },
      },
    ]);

    const different = runRules(config((k) => `{"flag":"on-${k}"}`));
    expect(only(different.findings, "perf/repeated-request")).toEqual([]);

    const single = runRules(
      build([
        {
          id: "c1",
          length: 30,
          requests: () => [{ url: "https://h.example/config", t0: 0, tEnd: 20, body: "{}" }],
        },
      ]),
    );
    expect(only(single.findings, "perf/repeated-request")).toEqual([]);
  });

  it("(b) 는 여러 도구를 사전순으로 잇는다", () => {
    const result = runRules(
      build(
        [
          ["c1", "zeta"],
          ["c2", "alpha"],
        ].map(([id, tool]) => ({
          id: id as string,
          tool: tool as string,
          length: 30,
          requests: () => [{ url: "https://h.example/config", t0: 0, tEnd: 20, body: "{}" }],
        })),
      ),
    );
    const [finding] = only(result.findings, "perf/repeated-request");
    expect(finding?.tools).toEqual(["alpha", "zeta"]);
    expect(finding?.lines[0]).toBe(
      "'alpha', 'zeta' 가 입력이 달라도 매 호출 같은 요청에 같은 응답을 받습니다 (케이스 2개, 호출 10회, p50 20ms): GET h.example/config",
    );
  });

  it("지문이 없는 관측이 하나라도 있으면 (b) 가 아니다", () => {
    const result = runRules(
      build(
        ["c1", "c2"].map((id, k) => ({
          id,
          length: 30,
          requests: () => [
            {
              url: "https://h.example/config",
              t0: 0,
              tEnd: 20,
              ...(k === 1 ? { via: "node:http" as const } : { body: "{}" }),
            },
          ],
        })),
      ),
    );
    expect(only(result.findings, "perf/repeated-request")).toEqual([]);
  });
});

describe("runRules: 순서", () => {
  it("findings 순서는 규칙·케이스·표기 사전순", () => {
    const sequential =
      (prefix: string): CaseSpec["requests"] =>
      () => [
        { url: `https://h.example/${prefix}-1`, t0: 0, tEnd: 100 },
        { url: `https://h.example/${prefix}-2`, t0: 100, tEnd: 200 },
      ];
    const result = runRules(
      build([
        { id: "beta", length: 210, requests: sequential("b") },
        {
          id: "zeta",
          length: 100,
          requests: () => [
            { url: "https://h.example/z", t0: 0, tEnd: 50 },
            { url: "https://h.example/z", t0: 1, tEnd: 51 },
            { url: "https://h.example/a", t0: 2, tEnd: 52 },
            { url: "https://h.example/a", t0: 3, tEnd: 53 },
          ],
        },
        { id: "alpha", length: 210, requests: sequential("a") },
      ]),
    );
    expect(result.findings.map((f) => [f.ruleId, f.caseIds[0], f.evidence.requests[0]])).toEqual([
      ["perf/repeated-request", "zeta", "GET h.example/a"],
      ["perf/repeated-request", "zeta", "GET h.example/z"],
      ["perf/sequential-independent", "alpha", "GET h.example/a-2"],
      ["perf/sequential-independent", "beta", "GET h.example/b-2"],
    ]);
  });

  it("dependency 는 모든 케이스를 키로 갖는다", () => {
    const result = runRules(build([{ id: "c", length: 10, requests: () => [] }]));
    expect(result.dependency.get("c")).toEqual({ dependent: 0, independent: 0, unknown: 0 });
    expect(result.findings).toEqual([]);
  });
});
