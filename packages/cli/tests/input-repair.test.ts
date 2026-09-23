import type { ToolDef } from "@mcpeak/core";
import type { JsonValue, TestSuiteSpec } from "@mcpeak/runner";
import { describe, expect, it } from "vitest";
import type { ReviewIO } from "../src/generate-command.js";
import { repairInputs } from "../src/input-repair.js";
import type { ProposalOutcome } from "../src/repair-proposal.js";
import type { RepairTarget } from "../src/repair-target.js";

type Input = Readonly<Record<string, JsonValue>>;

interface ScriptedIO extends ReviewIO {
  /** `input` 으로 던진 질문 전량. 순서는 물어본 순서다. */
  readonly prompts: string[];
  /** 화면에 나간 글 전량. `write` 와 질문을 섞어 순서대로 잇는다. */
  transcript(): string;
}

/** 답을 미리 적어 두는 화면. 답이 떨어지면 빈 문자열(엔터)로 답한다. */
const scriptedIO = (answers: readonly string[] = []): ScriptedIO => {
  const remaining = [...answers];
  const prompts: string[] = [];
  const lines: string[] = [];
  return {
    prompts,
    transcript: () => lines.join(""),
    async input(message) {
      prompts.push(message);
      lines.push(`${message}\n`);
      return remaining.shift() ?? "";
    },
    async choose(_message, choices) {
      return choices[0] ?? "";
    },
    async confirm() {
      return true;
    },
    write(text) {
      lines.push(text);
    },
    interactive: true,
  };
};

const weatherTools: ToolDef[] = [
  {
    name: "get_weather",
    description: "날씨를 조회한다",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string" }, days: { type: "number" } },
    },
  },
];

/** 스위트는 이 모듈이 읽지 않지만 계약에 있어 함께 넘긴다. */
const emptySuite: TestSuiteSpec = {
  schemaVersion: 1,
  id: "repair-screen-suite",
  name: "교정 화면 스위트",
  cases: [],
};

/** 대상 판별을 통과한 케이스의 기본 실패 줄. `selectRepairTargets` 가 싣는 값과 같다. */
const DEFAULT_FAILURE_LINE = "isError  정상 응답을 기대했지만 오류 응답을 받았습니다.";

const target = (
  caseId: string,
  input: Input,
  caseName = "get_weather가 오류 없이 응답한다",
  extra: { readonly serverMessage?: string; readonly failureLine?: string } = {},
): RepairTarget => ({
  caseId,
  caseName,
  tool: "get_weather",
  input,
  serverMessage: extra.serverMessage ?? "",
  failureLine: extra.failureLine ?? DEFAULT_FAILURE_LINE,
});

/** 매번 같은 판정을 돌려주는 재실행. */
const rerunAlways = (passed: boolean) => {
  const calls: Array<{ caseId: string; input: Input }> = [];
  const rerun = async (caseId: string, input: Input) => {
    calls.push({ caseId, input });
    return {
      passed,
      detail: passed ? "" : "    isError  정상 응답을 기대했지만 오류 응답을 받았습니다.",
    };
  };
  return { calls, rerun };
};

/** 호출 순서대로 판정을 꺼내 쓰는 재실행. 다 떨어지면 실패로 본다. */
const rerunSequence = (verdicts: readonly boolean[]) => {
  const calls: Array<{ caseId: string; input: Input }> = [];
  const remaining = [...verdicts];
  const rerun = async (caseId: string, input: Input) => {
    calls.push({ caseId, input });
    return { passed: remaining.shift() ?? false, detail: "" };
  };
  return { calls, rerun };
};

describe("repairInputs", () => {
  it("대상이 없으면 아무것도 묻지 않고 빈 배열을 돌려준다", async () => {
    const io = scriptedIO();
    const { calls, rerun } = rerunAlways(true);

    const outcomes = await repairInputs({
      io,
      suite: emptySuite,
      targets: [],
      rerun,
      tools: weatherTools,
    });

    expect(outcomes).toEqual([]);
    expect(io.prompts).toEqual([]);
    expect(io.transcript()).toBe("");
    expect(calls).toEqual([]);
  });

  it("AI 제안이 있으면 그 값이 기본값으로 화면에 나온다", async () => {
    const io = scriptedIO();
    const { rerun } = rerunAlways(true);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" })],
      rerun,
      propose: async () => ({ kind: "proposed", input: { city: "서울" } }),
      tools: weatherTools,
    });

    expect(io.prompts).toEqual([
      '      get_weather.city (필드 1/1, string, 현재 "example", 엔터 = 제안 값 "서울"): ',
    ]);
  });

  it("AI 제안이 현재 값과 같으면 화면에 그렇다고 적는다", async () => {
    // AI 는 입력 쪽에 고칠 데를 못 찾으면 받은 값을 그대로 돌려준다. 그것을 "제안 값" 으로만
    // 찍으면 사용자가 같은 값을 왜 다시 넣으라는지 알 수 없다(live-weather 결함 A 실측).
    const io = scriptedIO();
    const { rerun } = rerunAlways(true);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" })],
      rerun,
      propose: async () => ({ kind: "proposed", input: { city: "example" } }),
      tools: weatherTools,
    });

    expect(io.prompts).toEqual([
      '      get_weather.city (필드 1/1, string, 현재 "example", 엔터 = 제안 값 "example" (현재 값과 같음)): ',
    ]);
  });

  it("AI 제안에 엔터만 누르면 그 값으로 재실행한다", async () => {
    const io = scriptedIO([""]);
    const { calls, rerun } = rerunAlways(true);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" })],
      rerun,
      propose: async () => ({ kind: "proposed", input: { city: "서울" } }),
      tools: weatherTools,
    });

    expect(calls).toEqual([{ caseId: "c1", input: { city: "서울" } }]);
  });

  it("AI 제안이 없으면 사람에게 직접 묻는다", async () => {
    const io = scriptedIO(["서울"]);
    const { calls, rerun } = rerunAlways(true);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" })],
      rerun,
      propose: async () => ({ kind: "unavailable" }),
      tools: weatherTools,
    });

    expect(io.prompts).toEqual([
      '      get_weather.city (필드 1/1, string, 현재 "example", 엔터 = 현재 값 유지): ',
    ]);
    expect(calls).toEqual([{ caseId: "c1", input: { city: "서울" } }]);
  });

  it("재실행이 통과하면 repaired 가 true 이고 input 이 교정값이다", async () => {
    const io = scriptedIO(["서울"]);
    const { rerun } = rerunAlways(true);

    const outcomes = await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" })],
      rerun,
      tools: weatherTools,
    });

    expect(outcomes).toEqual([
      {
        caseId: "c1",
        repaired: true,
        input: { city: "서울" },
        // propose 를 안 넘겼다. 사람이 직접 입력한 값이다.
        attempts: [{ field: "city", value: "서울", passed: true, origin: "humanRepaired" }],
      },
    ]);
  });

  it("재실행이 통과하면 그 케이스를 더 묻지 않는다", async () => {
    const io = scriptedIO(["서울"]);
    const { calls, rerun } = rerunAlways(true);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" })],
      rerun,
      propose: async () => ({ kind: "proposed", input: { city: "부산" } }),
      tools: weatherTools,
    });

    expect(io.prompts).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it("AI 제안이 실패하면 사람에게 한 번 더 묻는다", async () => {
    const io = scriptedIO(["", "부산"]);
    const { calls, rerun } = rerunSequence([false, true]);

    const outcomes = await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" })],
      rerun,
      propose: async () => ({ kind: "proposed", input: { city: "서울" } }),
      tools: weatherTools,
    });

    expect(io.prompts).toEqual([
      '      get_weather.city (필드 1/1, string, 현재 "example", 엔터 = 제안 값 "서울"): ',
      '      get_weather.city (필드 1/1, string, 현재 "서울", 엔터 = 현재 값 유지): ',
    ]);
    expect(calls.map((call) => call.input)).toEqual([{ city: "서울" }, { city: "부산" }]);
    expect(outcomes[0]?.repaired).toBe(true);
  });

  it("사람 입력이 실패하면 다시 묻지 않고 repaired 가 false 다", async () => {
    const io = scriptedIO(["서울"]);
    const { calls, rerun } = rerunAlways(false);

    const outcomes = await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" })],
      rerun,
      tools: weatherTools,
    });

    expect(io.prompts).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(outcomes[0]?.repaired).toBe(false);
  });

  it("두 번 실패하면 attempts 에 두 항목이 시도 순으로 담긴다", async () => {
    const io = scriptedIO(["", "부산"]);
    const { rerun } = rerunAlways(false);

    const outcomes = await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" })],
      rerun,
      propose: async () => ({ kind: "proposed", input: { city: "서울" } }),
      tools: weatherTools,
    });

    // 1회차는 AI 제안을 사람이 그대로 둔 값, 2회차는 사람이 직접 넣은 값이다.
    expect(outcomes[0]?.attempts).toEqual([
      { field: "city", value: "서울", passed: false, origin: "aiProposed" },
      { field: "city", value: "부산", passed: false, origin: "humanRepaired" },
    ]);
  });

  it("두 번 실패하면 input 이 undefined 다", async () => {
    const io = scriptedIO(["", "부산"]);
    const { rerun } = rerunAlways(false);

    const outcomes = await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" })],
      rerun,
      propose: async () => ({ kind: "proposed", input: { city: "서울" } }),
      tools: weatherTools,
    });

    expect(outcomes[0]?.input).toBeUndefined();
    expect(outcomes[0]?.repaired).toBe(false);
  });

  it("전부 엔터로 값을 그대로 두면 재실행하지 않는다", async () => {
    const io = scriptedIO([""]);
    const { calls, rerun } = rerunAlways(true);

    const outcomes = await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" })],
      rerun,
      tools: weatherTools,
    });

    expect(calls).toEqual([]);
    expect(outcomes[0]).toEqual({ caseId: "c1", repaired: false, attempts: [] });
  });

  it("숫자 문자열을 넣으면 숫자로 파싱된다", async () => {
    const io = scriptedIO(["42"]);
    const { calls, rerun } = rerunAlways(true);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { days: 1 })],
      rerun,
      tools: weatherTools,
    });

    expect(calls[0]?.input).toEqual({ days: 42 });
  });

  it("JSON 이 아닌 문자열은 문자열 그대로 쓰인다", async () => {
    const io = scriptedIO(["서울"]);
    const { calls, rerun } = rerunAlways(true);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" })],
      rerun,
      tools: weatherTools,
    });

    expect(calls[0]?.input).toEqual({ city: "서울" });
  });

  it("스키마 타입과 안 맞는 값을 주면 같은 필드를 다시 묻는다", async () => {
    const io = scriptedIO(["42", "서울"]);
    const { calls, rerun } = rerunAlways(true);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" })],
      rerun,
      tools: weatherTools,
    });

    expect(io.prompts).toHaveLength(2);
    expect(io.prompts[0]).toBe(io.prompts[1]);
    expect(calls[0]?.input).toEqual({ city: "서울" });
  });

  it("같은 툴·같은 필드의 두 번째 케이스는 묻지 않고 캐시값을 쓴다", async () => {
    const io = scriptedIO(["부산"]);
    const { calls, rerun } = rerunAlways(true);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" }), target("c2", { city: "example2" })],
      rerun,
      tools: weatherTools,
    });

    expect(io.prompts).toHaveLength(1);
    expect(calls).toEqual([
      { caseId: "c1", input: { city: "부산" } },
      { caseId: "c2", input: { city: "부산" } },
    ]);
  });

  it("재실행이 실패한 값은 캐시에 담기지 않는다", async () => {
    const io = scriptedIO(["부산", "대구"]);
    const { calls, rerun } = rerunSequence([false, true]);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" }), target("c2", { city: "example2" })],
      rerun,
      tools: weatherTools,
    });

    // 첫 케이스에서 받은 값이 실패했으므로 뒤 케이스는 제 차례에 다시 묻는다.
    expect(io.prompts).toHaveLength(2);
    expect(calls.map((call) => call.input)).toEqual([{ city: "부산" }, { city: "대구" }]);
    expect(io.transcript()).not.toContain("함께 적용합니다.");
  });

  it("캐시를 적용할 때 §8.6.3 줄이 나온다", async () => {
    const io = scriptedIO(["부산"]);
    const { rerun } = rerunAlways(true);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" }), target("c2", { city: "example2" })],
      rerun,
      tools: weatherTools,
    });

    expect(io.transcript()).toContain(
      "      같은 값을 get_weather.city 를 쓰는 케이스 1건에 함께 적용합니다.\n",
    );
  });

  it("캐시값으로 재실행한 케이스도 attempts 에 남는다", async () => {
    const io = scriptedIO(["부산"]);
    const { rerun } = rerunAlways(true);

    const outcomes = await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" }), target("c2", { city: "example2" })],
      rerun,
      tools: weatherTools,
    });

    // 캐시에서 물려받은 값이다. 앞 케이스에서 사람이 넣었으므로 여기서도 humanRepaired 다.
    expect(outcomes[1]?.attempts).toEqual([
      { field: "city", value: "부산", passed: true, origin: "humanRepaired" },
    ]);
  });

  it("화면 문안이 2026-09-13 설계 §4.3 과 같다", async () => {
    const io = scriptedIO([""]);
    const { rerun } = rerunAlways(true);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [
        target("c1", { city: "example" }, undefined, {
          serverMessage: "city 'example' 을 찾을 수 없습니다",
        }),
      ],
      rerun,
      propose: async () => ({ kind: "proposed", input: { city: "서울" } }),
      proposedBy: "codex(gpt-5.6-luna)",
      tools: weatherTools,
    });

    expect(io.transcript()).toBe(
      [
        "  [1/1] get_weather가 오류 없이 응답한다",
        "      isError  정상 응답을 기대했지만 오류 응답을 받았습니다.",
        "      → city 'example' 을 찾을 수 없습니다",
        "",
        "      입력값이 거절된 것으로 보입니다. codex(gpt-5.6-luna) 가 서버 응답을 보고 제안한 값입니다.",
        '      get_weather.city (필드 1/1, string, 현재 "example", 엔터 = 제안 값 "서울"): ',
        "      ▸ 다시 실행 중... 1건",
        "      ✓ 통과",
        "",
      ].join("\n"),
    );
  });

  it("화면 문안이 2026-09-13 설계 §4.4 와 같다", async () => {
    const io = scriptedIO(["서울"]);
    const { rerun } = rerunAlways(false);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" })],
      rerun,
      tools: weatherTools,
    });

    expect(io.transcript()).toBe(
      [
        "  [1/1] get_weather가 오류 없이 응답한다",
        "      isError  정상 응답을 기대했지만 오류 응답을 받았습니다.",
        "",
        "      입력값이 거절된 것으로 보입니다. 서버 응답에 쓸 만한 값이 없어 직접 받습니다.",
        '      get_weather.city (필드 1/1, string, 현재 "example", 엔터 = 현재 값 유지): ',
        "      ▸ 다시 실행 중... 1건",
        "      ✗ 여전히 실패합니다. 입력값 문제가 아닐 수 있습니다.",
        "",
      ].join("\n"),
    );
  });

  it("머리줄에 전체 대상 수를 붙인다", async () => {
    const io = scriptedIO(["서울", "부산"]);
    const { rerun } = rerunAlways(true);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" }), target("c2", { days: 3 }, "다른 케이스")],
      rerun,
      tools: weatherTools,
    });

    expect(io.transcript()).toContain("  [1/2] ");
    expect(io.transcript()).toContain("  [2/2] ");
  });

  it("서버 위반 줄을 머리말에 찍는다", async () => {
    const io = scriptedIO(["서울"]);
    const { rerun } = rerunAlways(true);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [
        target("c1", { city: "example" }, undefined, {
          serverMessage: "city 'example' 을 찾을 수 없습니다",
        }),
      ],
      rerun,
      tools: weatherTools,
    });

    expect(io.transcript()).toContain("      → city 'example' 을 찾을 수 없습니다");
  });

  it("서버 위반 줄이 없으면 화살표 줄이 없다", async () => {
    const io = scriptedIO(["서울"]);
    const { rerun } = rerunAlways(true);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" }, undefined, { serverMessage: "" })],
      rerun,
      tools: weatherTools,
    });

    // 관측하지 못한 것을 관측했다고 적지 않는다. 빈 화살표 줄을 만들지 않는다.
    expect(io.transcript()).not.toContain("→ ");
  });

  it("실패 줄은 target 의 failureLine 을 그대로 쓴다", async () => {
    const io = scriptedIO(["서울"]);
    const { rerun } = rerunAlways(true);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [
        target("c1", { city: "example" }, undefined, {
          failureLine: "toolExists  선언되지 않은 툴입니다.",
        }),
      ],
      rerun,
      tools: weatherTools,
    });

    expect(io.transcript()).toContain("      toolExists  선언되지 않은 툴입니다.");
    expect(io.transcript()).not.toContain("정상 응답을 기대했지만");
  });

  it("필드가 여럿이면 진행도를 센다", async () => {
    const io = scriptedIO(["서울", "3", "kst"]);
    const { rerun } = rerunAlways(true);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example", days: 1, zone: "utc" })],
      rerun,
      tools: weatherTools,
    });

    expect(io.prompts[0]).toContain("필드 1/3");
    expect(io.prompts[1]).toContain("필드 2/3");
    expect(io.prompts[2]).toContain("필드 3/3");
  });

  it("캐시로 건너뛴 필드는 진행도에서 빼고 센다", async () => {
    const io = scriptedIO(["서울", "3"]);
    const { rerun } = rerunAlways(true);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [
        target("c1", { city: "example" }),
        target("c2", { city: "example", days: 1 }, "둘째 케이스"),
      ],
      rerun,
      tools: weatherTools,
    });

    // 둘째 케이스의 city 는 첫 케이스가 통과시킨 값으로 채워져 묻지 않는다(§4.6).
    expect(io.prompts).toHaveLength(2);
    expect(io.prompts[0]).toContain("필드 1/1");
    expect(io.prompts[1]).toContain("필드 1/1");
    expect(io.prompts[1]).toContain("get_weather.days");
  });

  it("선언 타입을 모르면 타입 자리를 뺀다", async () => {
    const io = scriptedIO(["서울"]);
    const { rerun } = rerunAlways(true);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { zone: "example" })],
      rerun,
      tools: weatherTools,
    });

    expect(io.prompts[0]).toBe(
      '      get_weather.zone (필드 1/1, 현재 "example", 엔터 = 현재 값 유지): ',
    );
  });

  it("rerun 이 던지면 그대로 올라간다", async () => {
    const io = scriptedIO(["서울"]);
    const rerun = async () => {
      throw new Error("socket hang up");
    };

    await expect(
      repairInputs({
        io,
        suite: emptySuite,
        targets: [target("c1", { city: "example" })],
        rerun,
        tools: weatherTools,
      }),
    ).rejects.toThrow("socket hang up");
  });

  /**
   * #286. 이 갈래는 `propose` 가 배선됐을 때만 도달하므로 값은 **항상 provider 가 만든 것**
   * 이다. 표기를 못 받았다고 서버에 귀속하면 안 된다 — 사용자가 AI 관여를 알 수 없게 된다.
   */
  it("provider 표기가 없어도 값을 서버에 귀속하지 않는다", async () => {
    const io = scriptedIO([""]);
    const { rerun } = rerunAlways(true);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" })],
      rerun,
      propose: async () => ({ kind: "proposed", input: { city: "서울" } }),
      tools: weatherTools,
    });

    const text = io.transcript();
    expect(text).toContain("AI 가 서버 응답을 보고 제안한 값입니다");
    expect(text).not.toContain("서버 응답에서 값을 찾았습니다");
  });

  /**
   * #286 리뷰. 전송을 거절한 것과 보낼 근거가 없는 것은 **사람에게 할 말이 다르다.**
   * 거절한 사용자에게 "서버 응답에 쓸 만한 값이 없다" 고 하면 거짓 사유다 — 서버 응답은
   * 있었고 보내지 않기로 한 것뿐이다.
   */
  it("전송을 거절한 갈래는 근거 부재라고 말하지 않는다", async () => {
    const io = scriptedIO(["서울"]);
    const { rerun } = rerunAlways(true);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" })],
      rerun,
      propose: async () => ({ kind: "declined" }),
      proposedBy: "codex(gpt-5.6-luna)",
      tools: weatherTools,
    });

    const text = io.transcript();
    expect(text).toContain("AI 전송을 거절했으므로 값을 직접 받습니다");
    expect(text).not.toContain("서버 응답에 쓸 만한 값이 없어");
    expect(text).not.toContain("제안한 값입니다");
  });

  /** 근거 부재 갈래는 기존 문안 그대로다. 두 갈래가 섞이면 안 된다. */
  it("근거 부재 갈래는 거절 문안을 쓰지 않는다", async () => {
    const io = scriptedIO(["서울"]);
    const { rerun } = rerunAlways(true);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" })],
      rerun,
      propose: async () => ({ kind: "unavailable" }),
      tools: weatherTools,
    });

    const text = io.transcript();
    expect(text).toContain("서버 응답에 쓸 만한 값이 없어 직접 받습니다");
    expect(text).not.toContain("AI 전송을 거절했으므로");
  });
});

describe("교정값의 출처 (#390)", () => {
  it("AI 제안을 그대로 둔 필드는 aiProposed 다", async () => {
    // 1회차는 제안값을 채워 놓고 사람에게 묻는다. 엔터로 그대로 두면 사람이 확인한 값이다.
    const io = scriptedIO([""]);
    const { rerun } = rerunAlways(true);
    const outcomes = await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" })],
      rerun,
      propose: async () => ({ kind: "proposed", input: { city: "서울" } }),
      tools: weatherTools,
    });
    expect(outcomes[0]?.attempts).toEqual([
      { field: "city", value: "서울", passed: true, origin: "aiProposed" },
    ]);
  });

  it("AI 제안을 사람이 고친 필드는 humanRepaired 다", async () => {
    const io = scriptedIO(["부산"]);
    const { rerun } = rerunAlways(true);
    const outcomes = await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" })],
      rerun,
      propose: async () => ({ kind: "proposed", input: { city: "서울" } }),
      tools: weatherTools,
    });
    expect(outcomes[0]?.attempts).toEqual([
      { field: "city", value: "부산", passed: true, origin: "humanRepaired" },
    ]);
  });

  it("AI 제안이 일부 필드만 덮어도 죽지 않는다", async () => {
    // `canonicalJson` 은 undefined 를 받으면 던진다. 1회차는 입력 전체를 도는데 제안은
    // 일부만 덮을 수 있다. 그 필드에서 던지면 대화형 검토가 통째로 죽는다.
    //
    // 제안한 적이 없는 필드는 의미상으로도 humanRepaired 다.
    const io = scriptedIO(["", "3"]);
    const { rerun } = rerunAlways(true);
    const outcomes = await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example", days: 1 })],
      rerun,
      // city 만 제안한다. days 는 제안에 없다.
      propose: async () => ({ kind: "proposed", input: { city: "서울" } }),
      tools: weatherTools,
    });
    expect(outcomes[0]?.attempts).toEqual([
      { field: "city", value: "서울", passed: true, origin: "aiProposed" },
      { field: "days", value: 3, passed: true, origin: "humanRepaired" },
    ]);
  });

  it("캐시에서 재사용한 필드는 준 케이스의 출처를 물려받는다", async () => {
    // c1: 사람이 제안 "서울" 을 "부산" 으로 고친다. humanRepaired 로 캐시에 든다.
    // c2: 캐시로 "부산" 을 재사용한다. **그런데 c2 의 제안도 "부산" 이다.**
    //
    // 물려받지 않으면 제안값과 같으니 aiProposed 로 찍힌다. 그것이 거짓말이다. 이 값을 정한
    // 것은 c1 에서 사람이다. 두 제안을 같게 두면 캐시 조회 줄을 지웠을 때 이 테스트가 깨진다.
    //
    // c2 에 물어볼 필드(`days`)를 하나 둔다. 물어볼 것이 하나도 없으면 `propose` 가 아예 안
    // 불려 `proposed` 가 undefined 가 되고, 그러면 캐시가 없어도 humanRepaired 로 떨어져
    // 두 경로가 같은 답을 낸다.
    const io = scriptedIO(["부산", "2"]);
    const { rerun } = rerunAlways(true);
    const outcomes = await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" }), target("c2", { city: "example2", days: 1 })],
      rerun,
      propose: async (proposeTarget): Promise<ProposalOutcome> => ({
        kind: "proposed",
        input:
          proposeTarget.caseId === "c1"
            ? { city: "서울" }
            : // c2 의 제안이 캐시에 든 값과 같다. 물려받지 않으면 여기서 aiProposed 로 찍힌다.
              { city: "부산", days: 2 },
      }),
      tools: weatherTools,
    });
    expect(outcomes[1]?.attempts).toEqual([
      { field: "city", value: "부산", passed: true, origin: "humanRepaired" },
      { field: "days", value: 2, passed: true, origin: "aiProposed" },
    ]);
  });
});
