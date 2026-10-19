import { describe, expect, it } from "vitest";
import { compareBaseline, parseBaseline, toBaseline } from "../src/baseline.js";
import { PerfError } from "../src/errors.js";
import type {
  CallOutcome,
  CaseResult,
  Percentiles,
  PerfBaseline,
  PerfReport,
} from "../src/types.js";

// 설계 §7 의 회귀 판정·문장·줄 순서와 기준 파일 왕복을 손으로 만든 PerfReport 로 단언한다.

const ZERO_OUTCOMES: Readonly<Record<CallOutcome, number>> = {
  ok: 0,
  isError: 0,
  empty: 0,
  threw: 0,
  skipped: 0,
  missingTool: 0,
};

function pct(p50: number): Percentiles {
  return { p50, p95: p50, min: p50, max: p50 };
}

function okCase(
  id: string,
  values: { readonly inside: number; readonly requests: number; readonly n?: number },
): CaseResult {
  const n = values.n ?? 5;
  return {
    id,
    tool: `t_${id}`,
    n,
    outcomes: { ...ZERO_OUTCOMES, ok: n },
    total: pct(100),
    external: pct(50),
    inside: pct(values.inside),
    requests: pct(values.requests),
    maxConcurrency: 1,
    externalLowerBound: false,
    afterResponse: 0,
    dependency: { dependent: 0, independent: 0, unknown: 0 },
    requestSummaries: [],
  };
}

function failedCase(id: string, outcomes: Partial<Record<CallOutcome, number>>): CaseResult {
  return {
    id,
    tool: `t_${id}`,
    n: 0,
    outcomes: { ...ZERO_OUTCOMES, ...outcomes },
    dependency: { dependent: 0, independent: 0, unknown: 0 },
    requestSummaries: [],
  };
}

function report(
  cases: readonly CaseResult[],
  settings: Partial<PerfReport["settings"]> = {},
): PerfReport {
  return {
    schemaVersion: 1,
    generator: { name: "@mcpeak/perf", version: "0.0.0-test" },
    server: { command: "node server.mjs", toolCount: 3 },
    settings: {
      repeat: 5,
      intervalMs: 0,
      caseCount: cases.length,
      observation: "preload",
      ...settings,
    },
    coldStart: { connectMs: 312, listToolsMs: 4 },
    cases,
    findings: [],
    undecidedCases: 0,
    aborted: null,
    exitCode: 0,
  };
}

function baseline(
  cases: readonly { id: string; insideP50: number; requestsP50: number }[],
  settings: PerfBaseline["settings"] = { repeat: 5, intervalMs: 0 },
): PerfBaseline {
  return {
    schemaVersion: 1,
    generator: { name: "@mcpeak/perf", version: "0.0.0-test" },
    settings,
    cases: cases.map((c) => ({
      id: c.id,
      tool: `t_${c.id}`,
      n: 5,
      insideP50: c.insideP50,
      externalP50: 50,
      totalP50: 100,
      requestsP50: c.requestsP50,
    })),
  };
}

const DEFAULTS = { path: "perf.baseline.json", thresholdPct: 50, thresholdMs: 20 } as const;
const NO_REGRESSION =
  "회귀 없음. 서버 안 p50 은 기준의 1.5배+20ms 안이고 외부 요청 수는 기준 이하입니다.";
const UPDATE_HINT = "이 변경이 의도된 것이라면 --update-baseline 으로 기준을 갱신하세요.";

describe("compareBaseline", () => {
  it("서버 안 p50 이 기준×1.5+20 을 넘으면 회귀, 같으면 아니다", () => {
    const base = baseline([{ id: "a", insideP50: 10, requestsP50: 2 }]);

    const regressed = compareBaseline(
      report([okCase("a", { inside: 35.1, requests: 2 })]),
      base,
      DEFAULTS,
    );
    expect(regressed.exitCode).toBe(2);
    expect(regressed.baseline).toStrictEqual({
      path: "perf.baseline.json",
      settingsMismatch: false,
      lines: ["'a' 서버 안 p50 35ms, 기준 10ms (허용 35ms 초과)", UPDATE_HINT],
      regressedCaseIds: ["a"],
    });

    const fine = compareBaseline(
      report([okCase("a", { inside: 35, requests: 2 })]),
      base,
      DEFAULTS,
    );
    expect(fine.exitCode).toBe(0);
    expect(fine.baseline).toStrictEqual({
      path: "perf.baseline.json",
      settingsMismatch: false,
      lines: [NO_REGRESSION],
      regressedCaseIds: [],
    });
  });

  it("요청 수는 하나만 늘어도 회귀", () => {
    const base = baseline([{ id: "a", insideP50: 10, requestsP50: 2 }]);
    const result = compareBaseline(
      report([okCase("a", { inside: 10, requests: 3 })]),
      base,
      DEFAULTS,
    );
    expect(result.exitCode).toBe(2);
    expect(result.baseline?.lines).toStrictEqual([
      "'a' 호출당 외부 요청 3건, 기준 2건",
      UPDATE_HINT,
    ]);
    expect(result.baseline?.regressedCaseIds).toStrictEqual(["a"]);
  });

  it("기준에 있고 지금 성공 0 이면 회귀, 사유 문장 포함", () => {
    const base = baseline([{ id: "a", insideP50: 10, requestsP50: 2 }]);
    const result = compareBaseline(
      report([failedCase("a", { isError: 2, threw: 3 })]),
      base,
      DEFAULTS,
    );
    expect(result.exitCode).toBe(2);
    expect(result.baseline?.lines).toStrictEqual([
      "'a' 는 기준에 있지만 이번에는 성공한 호출이 없습니다 (isError 2회, threw 3회)",
      UPDATE_HINT,
    ]);
    expect(result.baseline?.regressedCaseIds).toStrictEqual(["a"]);
  });

  it("기준에 있고 명세에 없으면 안내만, exitCode 0", () => {
    const base = baseline([
      { id: "a", insideP50: 10, requestsP50: 2 },
      { id: "zz", insideP50: 10, requestsP50: 2 },
    ]);
    const result = compareBaseline(
      report([okCase("a", { inside: 10, requests: 2 })]),
      base,
      DEFAULTS,
    );
    expect(result.exitCode).toBe(0);
    expect(result.baseline?.lines).toStrictEqual([
      NO_REGRESSION,
      "'zz' 는 기준에 있지만 이번 명세에 없습니다.",
    ]);
    expect(result.baseline?.regressedCaseIds).toStrictEqual([]);
  });

  it("지금 있고 기준에 없으면 안내만, exitCode 0 (n 이 0 이어도 같다)", () => {
    const base = baseline([{ id: "a", insideP50: 10, requestsP50: 2 }]);
    const result = compareBaseline(
      report([
        okCase("a", { inside: 10, requests: 2 }),
        okCase("b", { inside: 999, requests: 9 }),
        failedCase("c", { threw: 5 }),
      ]),
      base,
      DEFAULTS,
    );
    expect(result.exitCode).toBe(0);
    expect(result.baseline?.lines).toStrictEqual([
      NO_REGRESSION,
      "'b' 는 기준에 없습니다. --update-baseline 으로 기준을 갱신하세요.",
      "'c' 는 기준에 없습니다. --update-baseline 으로 기준을 갱신하세요.",
    ]);
  });

  it("설정이 다르면 안내 줄을 내고 비교는 계속한다", () => {
    const base = baseline([{ id: "a", insideP50: 10, requestsP50: 2 }], {
      repeat: 10,
      intervalMs: 100,
    });
    const result = compareBaseline(
      report([okCase("a", { inside: 100, requests: 2 })]),
      base,
      DEFAULTS,
    );
    expect(result.exitCode).toBe(2);
    expect(result.baseline).toStrictEqual({
      path: "perf.baseline.json",
      settingsMismatch: true,
      lines: [
        "'a' 서버 안 p50 100ms, 기준 10ms (허용 35ms 초과)",
        UPDATE_HINT,
        "기준은 반복 10회·간격 100ms 로 쟀고 이번은 반복 5회·간격 0ms 입니다. 조건이 달라 비교가 느슨합니다.",
      ],
      regressedCaseIds: ["a"],
    });
  });

  it("factor 표기: pct 50 → 1.5배, 0 → 1배, 125 → 2.25배", () => {
    const base = baseline([{ id: "a", insideP50: 10, requestsP50: 2 }]);
    const current = report([okCase("a", { inside: 10, requests: 2 })]);
    const line = (thresholdPct: number, thresholdMs: number) =>
      compareBaseline(current, base, { ...DEFAULTS, thresholdPct, thresholdMs }).baseline?.lines[0];
    expect(line(50, 20)).toBe(NO_REGRESSION);
    expect(line(0, 20)).toBe(
      "회귀 없음. 서버 안 p50 은 기준의 1배+20ms 안이고 외부 요청 수는 기준 이하입니다.",
    );
    expect(line(125, 5)).toBe(
      "회귀 없음. 서버 안 p50 은 기준의 2.25배+5ms 안이고 외부 요청 수는 기준 이하입니다.",
    );
  });

  it("줄 순서는 §7.3 의 순서다", () => {
    const base = baseline(
      [
        { id: "d", insideP50: 10, requestsP50: 2 },
        { id: "zz", insideP50: 10, requestsP50: 2 },
        { id: "a", insideP50: 10, requestsP50: 2 },
        { id: "c", insideP50: 10, requestsP50: 2 },
      ],
      { repeat: 3, intervalMs: 0 },
    );
    const current = report([
      okCase("d", { inside: 10, requests: 2 }),
      failedCase("c", { threw: 5 }),
      okCase("b", { inside: 10, requests: 2 }),
      okCase("a", { inside: 100, requests: 3 }),
    ]);
    const result = compareBaseline(current, base, DEFAULTS);
    expect(result.exitCode).toBe(2);
    expect(result.baseline).toStrictEqual({
      path: "perf.baseline.json",
      settingsMismatch: true,
      lines: [
        "'a' 서버 안 p50 100ms, 기준 10ms (허용 35ms 초과)",
        "'a' 호출당 외부 요청 3건, 기준 2건",
        "'c' 는 기준에 있지만 이번에는 성공한 호출이 없습니다 (threw 5회)",
        UPDATE_HINT,
        "기준은 반복 3회·간격 0ms 로 쟀고 이번은 반복 5회·간격 0ms 입니다. 조건이 달라 비교가 느슨합니다.",
        "'b' 는 기준에 없습니다. --update-baseline 으로 기준을 갱신하세요.",
        "'zz' 는 기준에 있지만 이번 명세에 없습니다.",
      ],
      regressedCaseIds: ["a", "c"],
    });
  });

  it("입력 리포트를 바꾸지 않고 새 객체를 돌려준다", () => {
    const base = baseline([{ id: "a", insideP50: 10, requestsP50: 2 }]);
    const current = report([okCase("a", { inside: 100, requests: 2 })]);
    const snapshot = JSON.stringify(current);
    const result = compareBaseline(current, base, DEFAULTS);
    expect(result).not.toBe(current);
    expect(JSON.stringify(current)).toBe(snapshot);
    expect(current.baseline).toBeUndefined();
    expect(current.exitCode).toBe(0);
    expect(result.cases).toBe(current.cases);
  });

  it("observation 이 none 인 리포트는 비교할 수 없다", () => {
    const base = baseline([{ id: "a", insideP50: 10, requestsP50: 2 }]);
    const unobserved = report([okCase("a", { inside: 10, requests: 2 })], { observation: "none" });
    expect(() => compareBaseline(unobserved, base, DEFAULTS)).toThrow(
      "observation 이 none 인 리포트는 기준선과 비교할 수 없습니다",
    );
  });
});

describe("toBaseline", () => {
  it("성공 0 케이스를 빼고 id 사전순, 소수 첫째 자리", () => {
    const b: CaseResult = {
      ...okCase("b", { inside: 2.26, requests: 2 }),
      total: pct(1310.449),
      external: pct(285.04),
    };
    const a: CaseResult = {
      ...okCase("a", { inside: 0.95, requests: 1, n: 3 }),
      total: pct(287.5),
    };
    const result = toBaseline(report([b, failedCase("z", { threw: 5 }), a]));
    expect(result).toStrictEqual({
      schemaVersion: 1,
      generator: { name: "@mcpeak/perf", version: "0.0.0-test" },
      settings: { repeat: 5, intervalMs: 0 },
      cases: [
        {
          id: "a",
          tool: "t_a",
          n: 3,
          insideP50: 1,
          externalP50: 50,
          totalP50: 287.5,
          requestsP50: 1,
        },
        {
          id: "b",
          tool: "t_b",
          n: 5,
          insideP50: 2.3,
          externalP50: 285,
          totalP50: 1310.4,
          requestsP50: 2,
        },
      ],
    });
  });

  it("observation 이 none 인 리포트로는 기준 파일을 만들 수 없다", () => {
    const unobserved = report([okCase("a", { inside: 10, requests: 2 })], { observation: "none" });
    expect(() => toBaseline(unobserved)).toThrow(
      "observation 이 none 인 리포트로는 기준 파일을 만들 수 없습니다",
    );
  });
});

describe("parseBaseline", () => {
  const valid = toBaseline(
    report([okCase("a", { inside: 10, requests: 2 }), okCase("b", { inside: 20, requests: 1 })]),
  );

  function failure(text: string): PerfError {
    try {
      parseBaseline(text);
    } catch (error) {
      if (error instanceof PerfError) return error;
      throw error;
    }
    throw new Error("parseBaseline 이 던지지 않았습니다");
  }

  it("기준 파일 바이트를 왕복한다", () => {
    expect(parseBaseline(`${JSON.stringify(valid, null, 2)}\n`)).toStrictEqual(valid);
  });

  it("JSON 이 아니면 BASELINE_INVALID", () => {
    const error = failure("{ not json");
    expect(error.name).toBe("PerfError");
    expect(error.code).toBe("BASELINE_INVALID");
    expect(error.message).toBe("JSON 이 아닙니다");
  });

  it("schemaVersion 이 다르면 BASELINE_INVALID", () => {
    expect(failure(JSON.stringify({ ...valid, schemaVersion: 2 })).message).toBe(
      "schemaVersion 이 1 이 아닙니다",
    );
    expect(failure("null").message).toBe("schemaVersion 이 1 이 아닙니다");
  });

  it("필드가 빠지거나 형식이 틀리면 처음 틀린 경로 하나를 말한다", () => {
    const { settings: _settings, ...noSettings } = valid;
    expect(failure(JSON.stringify(noSettings)).message).toBe(
      "settings 가 없거나 형식이 틀렸습니다",
    );
    expect(
      failure(JSON.stringify({ ...valid, settings: { repeat: "5", intervalMs: 0 } })).message,
    ).toBe("settings.repeat 가 없거나 형식이 틀렸습니다");
    expect(
      failure(JSON.stringify({ ...valid, settings: { repeat: 5, intervalMs: Number.NaN } }))
        .message,
    ).toBe("settings.intervalMs 가 없거나 형식이 틀렸습니다");
    expect(
      failure(
        JSON.stringify({
          ...valid,
          cases: [valid.cases[0], { ...valid.cases[1], insideP50: "20" }],
        }),
      ).message,
    ).toBe("cases[1].insideP50 가 없거나 형식이 틀렸습니다");
    expect(failure(JSON.stringify({ ...valid, cases: {} })).message).toBe(
      "cases 가 없거나 형식이 틀렸습니다",
    );
    expect(
      failure(JSON.stringify({ ...valid, generator: { name: "other", version: "1" } })).message,
    ).toBe("generator.name 가 없거나 형식이 틀렸습니다");
  });
});
