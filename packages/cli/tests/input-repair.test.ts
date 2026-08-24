import type { ToolDef } from "@mcpeak/core";
import type { JsonValue, TestSuiteSpec } from "@mcpeak/runner";
import { describe, expect, it } from "vitest";
import type { ReviewIO } from "../src/generate-command.js";
import { repairInputs } from "../src/input-repair.js";
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

const target = (
  caseId: string,
  input: Input,
  caseName = "get_weather가 오류 없이 응답한다",
): RepairTarget => ({
  caseId,
  caseName,
  tool: "get_weather",
  input,
  serverMessage: "",
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
      propose: async () => ({ city: "서울" }),
      tools: weatherTools,
    });

    expect(io.prompts).toEqual(["      city: [서울]"]);
  });

  it("AI 제안에 엔터만 누르면 그 값으로 재실행한다", async () => {
    const io = scriptedIO([""]);
    const { calls, rerun } = rerunAlways(true);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" })],
      rerun,
      propose: async () => ({ city: "서울" }),
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
      propose: async () => undefined,
      tools: weatherTools,
    });

    expect(io.prompts).toEqual(['      city (string, 현재 "example"): ']);
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
        attempts: [{ field: "city", value: "서울", passed: true }],
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
      propose: async () => ({ city: "부산" }),
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
      propose: async () => ({ city: "서울" }),
      tools: weatherTools,
    });

    expect(io.prompts).toEqual(["      city: [서울]", '      city (string, 현재 "서울"): ']);
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
      propose: async () => ({ city: "서울" }),
      tools: weatherTools,
    });

    expect(outcomes[0]?.attempts).toEqual([
      { field: "city", value: "서울", passed: false },
      { field: "city", value: "부산", passed: false },
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
      propose: async () => ({ city: "서울" }),
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

    expect(outcomes[1]?.attempts).toEqual([{ field: "city", value: "부산", passed: true }]);
  });

  it("화면 문안이 설계 문서 §8.6 과 같다", async () => {
    const io = scriptedIO([""]);
    const { rerun } = rerunAlways(true);

    await repairInputs({
      io,
      suite: emptySuite,
      targets: [target("c1", { city: "example" })],
      rerun,
      propose: async () => ({ city: "서울" }),
      proposedBy: "codex(gpt-5.6-luna)",
      tools: weatherTools,
    });

    expect(io.transcript()).toBe(
      [
        "  [1] get_weather가 오류 없이 응답한다",
        "      isError  정상 응답을 기대했지만 오류 응답을 받았습니다.",
        "",
        "      입력값이 거절된 것으로 보입니다. codex(gpt-5.6-luna) 가 서버 응답을 보고 제안한 값입니다.",
        "      city: [서울]",
        "      ▸ 다시 실행 중... 1건",
        "      ✓ 통과",
        "",
      ].join("\n"),
    );
  });

  it("화면 문안이 설계 문서 §8.6.1 과 같다", async () => {
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
        "  [1] get_weather가 오류 없이 응답한다",
        "      isError  정상 응답을 기대했지만 오류 응답을 받았습니다.",
        "",
        "      입력값이 거절된 것으로 보입니다. 서버 응답에 쓸 만한 값이 없어 직접 받습니다.",
        '      city (string, 현재 "example"): ',
        "      ▸ 다시 실행 중... 1건",
        "      ✗ 여전히 실패합니다. 입력값 문제가 아닐 수 있습니다.",
        "",
      ].join("\n"),
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
      propose: async () => ({ city: "서울" }),
      tools: weatherTools,
    });

    const text = io.transcript();
    expect(text).toContain("AI 가 서버 응답을 보고 제안한 값입니다");
    expect(text).not.toContain("서버 응답에서 값을 찾았습니다");
  });
});
