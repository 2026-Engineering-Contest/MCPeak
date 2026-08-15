import type {
  AuthoringDraft,
  AuthoringSessionView,
  McpToolContext,
  TestAuthoringProvider,
} from "@ohmymcp/generate";
import { dispatchAuthoringRequest, prepareAuthoringRequest } from "@ohmymcp/generate";
import type { JsonObject, TestCaseSpec, TestSuiteSpec } from "@ohmymcp/runner";
import { describe, expect, it } from "vitest";
import { acceptProposal, proposeRepair } from "../src/repair-proposal.js";
import type { RepairTarget } from "../src/repair-target.js";

/** 서버를 띄우지 않는다. 툴 선언과 provider 응답은 이 파일 안에서 만든 인메모리 값이다. */
const tools: readonly McpToolContext[] = [
  {
    name: "get_weather",
    description: "날씨를 조회한다",
    inputSchema: {
      type: "object",
      required: ["city"],
      properties: { city: { type: "string" }, unit: { type: "string" } },
    },
  },
];

const callCase = (id: string, tool: string, input: JsonObject): TestCaseSpec => ({
  id,
  name: `${tool} 케이스 ${id}`,
  operation: { type: "callTool", tool, input },
  assertions: [{ type: "isError", expected: false }],
});

const suiteOf = (cases: readonly TestCaseSpec[]): TestSuiteSpec => ({
  schemaVersion: 1,
  id: "repair-proposal-suite",
  name: "교정 제안 스위트",
  cases: cases.map((spec) => structuredClone(spec) as TestCaseSpec),
});

const baseSuite = (): TestSuiteSpec =>
  suiteOf([
    callCase("c1", "get_weather", { city: "example" }),
    callCase("c2", "get_weather", { city: "example2" }),
  ]);

const draftOf = (suite: TestSuiteSpec): AuthoringDraft => ({
  revision: 0,
  suite,
  suiteFingerprint: "fingerprint-suite",
  baselineFingerprint: "fingerprint-baseline",
  provenance: suite.cases.map((spec) => ({
    caseId: spec.id,
    origin: "schemaBaseline" as const,
    firstRevision: 0,
    lastRevision: 0,
  })),
});

/**
 * 세션 뷰는 이 모듈에서 baseline·approvedDraft 의 suite 를 읽는 용도로만 쓰인다. 실제 세션을
 * 만들면 baseline 생성기가 케이스를 정해 버려 대상 케이스를 고정할 수 없다.
 */
const sessionOf = (suite: TestSuiteSpec): AuthoringSessionView => {
  const draft = draftOf(suite);
  return { baseline: draft, approvedDraft: draft };
};

const targetOf = (
  suite: TestSuiteSpec,
  serverMessage = "city 는 서울/부산 중 하나여야 합니다.",
): RepairTarget => {
  const spec = suite.cases[0] as TestCaseSpec;
  return {
    caseId: spec.id,
    caseName: spec.name,
    tool: "get_weather",
    input: spec.operation.type === "callTool" ? spec.operation.input : {},
    serverMessage,
  };
};

/** 정해 둔 응답 하나를 돌려주는 가짜 provider. 프로세스를 띄우지 않는다. */
const fakeProvider = (respond: () => unknown): TestAuthoringProvider => ({
  id: "codex",
  model: "test-model",
  async author() {
    return respond();
  },
});

const candidateResponse = (suite: TestSuiteSpec): unknown => ({
  status: "candidate",
  suite,
  summary: "입력값을 고쳤습니다.",
  warnings: [],
  questions: [],
});

/** 대상 케이스의 입력값 하나만 고친 응답 suite. */
const repairedSuite = (city: string): TestSuiteSpec => {
  const suite = baseSuite();
  const spec = suite.cases[0] as TestCaseSpec;
  if (spec.operation.type === "callTool") spec.operation.input = { city };
  return suite;
};

describe("proposeRepair", () => {
  it("serverMessage 가 비어 있으면 provider 를 부르지 않고 undefined 다", async () => {
    const suite = baseSuite();
    let called = 0;
    const result = await proposeRepair({
      target: targetOf(suite, ""),
      session: sessionOf(suite),
      tools,
      provider: fakeProvider(() => {
        called += 1;
        return candidateResponse(repairedSuite("서울"));
      }),
      prepare: prepareAuthoringRequest,
      dispatch: dispatchAuthoringRequest,
    });

    expect(result).toBeUndefined();
    expect(called).toBe(0);
  });

  it("instruction 에 케이스 id·툴·입력·서버 응답이 들어간다", async () => {
    const suite = baseSuite();
    let instruction = "";
    await proposeRepair({
      target: targetOf(suite),
      session: sessionOf(suite),
      tools,
      provider: fakeProvider(() => candidateResponse(repairedSuite("서울"))),
      prepare: (options) => {
        instruction = options.instruction;
        return prepareAuthoringRequest(options);
      },
      dispatch: dispatchAuthoringRequest,
    });

    expect(instruction).toContain("(id: c1)");
    expect(instruction).toContain("툴: get_weather");
    expect(instruction).toContain('보낸 입력: {"city":"example"}');
    expect(instruction).toContain("서버 응답: city 는 서울/부산 중 하나여야 합니다.");
  });

  it("dispatch 가 candidate 를 주면 입력값이 돌아온다", async () => {
    const suite = baseSuite();
    const result = await proposeRepair({
      target: targetOf(suite),
      session: sessionOf(suite),
      tools,
      provider: fakeProvider(() => candidateResponse(repairedSuite("서울"))),
      prepare: prepareAuthoringRequest,
      dispatch: dispatchAuthoringRequest,
    });

    expect(result).toEqual({ city: "서울" });
  });

  it("dispatch 가 실패 상태를 주면 undefined 다", async () => {
    const suite = baseSuite();
    const result = await proposeRepair({
      target: targetOf(suite),
      session: sessionOf(suite),
      tools,
      provider: fakeProvider(() => ({ status: "questions", questions: ["어느 도시인가요?"] })),
      prepare: prepareAuthoringRequest,
      dispatch: dispatchAuthoringRequest,
    });

    expect(result).toBeUndefined();
  });

  it("provider 가 던지면 undefined 다 (교정 실패가 시험 실행을 죽이지 않는다)", async () => {
    const suite = baseSuite();
    const result = await proposeRepair({
      target: targetOf(suite),
      session: sessionOf(suite),
      tools,
      provider: fakeProvider(() => {
        throw new Error("provider 가 죽었습니다.");
      }),
      prepare: prepareAuthoringRequest,
      dispatch: dispatchAuthoringRequest,
    });

    expect(result).toBeUndefined();
  });
});

/** `before` 를 복사해 한 군데만 고친 `after` 를 만든다. 검사 하나씩을 따로 겨눈다. */
const mutated = (change: (suite: TestSuiteSpec) => void): TestSuiteSpec => {
  const suite = baseSuite();
  change(suite);
  return suite;
};

const accept = (after: TestSuiteSpec) => {
  const before = baseSuite();
  return acceptProposal({ target: targetOf(before), before, after });
};

describe("acceptProposal", () => {
  it("입력값만 바뀐 응답을 수용한다", () => {
    expect(accept(repairedSuite("서울"))).toEqual({ city: "서울" });
  });

  it("단언이 바뀌면 undefined 다", () => {
    const after = mutated((suite) => {
      const spec = suite.cases[0] as TestCaseSpec;
      spec.assertions = [{ type: "isError", expected: true }];
      if (spec.operation.type === "callTool") spec.operation.input = { city: "서울" };
    });

    expect(accept(after)).toBeUndefined();
  });

  it("툴 이름이 바뀌면 undefined 다", () => {
    const after = mutated((suite) => {
      const spec = suite.cases[0] as TestCaseSpec;
      if (spec.operation.type === "callTool") {
        spec.operation.tool = "get_forecast";
        spec.operation.input = { city: "서울" };
      }
    });

    expect(accept(after)).toBeUndefined();
  });

  it("케이스가 추가되면 undefined 다", () => {
    const after = mutated((suite) => {
      const spec = suite.cases[0] as TestCaseSpec;
      if (spec.operation.type === "callTool") spec.operation.input = { city: "서울" };
      suite.cases.push(callCase("c3", "get_weather", { city: "대구" }));
    });

    expect(accept(after)).toBeUndefined();
  });

  it("케이스가 삭제되면 undefined 다", () => {
    const after = mutated((suite) => {
      const spec = suite.cases[0] as TestCaseSpec;
      if (spec.operation.type === "callTool") spec.operation.input = { city: "서울" };
      suite.cases.pop();
    });

    expect(accept(after)).toBeUndefined();
  });

  it("대상이 아닌 케이스가 바뀌면 undefined 다", () => {
    const after = mutated((suite) => {
      const target = suite.cases[0] as TestCaseSpec;
      if (target.operation.type === "callTool") target.operation.input = { city: "서울" };
      const other = suite.cases[1] as TestCaseSpec;
      if (other.operation.type === "callTool") other.operation.input = { city: "부산" };
    });

    expect(accept(after)).toBeUndefined();
  });

  it("입력 키가 추가되면 undefined 다", () => {
    const after = mutated((suite) => {
      const spec = suite.cases[0] as TestCaseSpec;
      if (spec.operation.type === "callTool") spec.operation.input = { city: "서울", unit: "c" };
    });

    expect(accept(after)).toBeUndefined();
  });

  it("입력 키가 삭제되면 undefined 다", () => {
    const before = suiteOf([
      callCase("c1", "get_weather", { city: "example", unit: "c" }),
      callCase("c2", "get_weather", { city: "example2" }),
    ]);
    const after = suiteOf([
      callCase("c1", "get_weather", { city: "서울" }),
      callCase("c2", "get_weather", { city: "example2" }),
    ]);

    expect(acceptProposal({ target: targetOf(before), before, after })).toBeUndefined();
  });

  it("케이스 이름이 바뀌면 undefined 다", () => {
    const after = mutated((suite) => {
      const spec = suite.cases[0] as TestCaseSpec;
      spec.name = "다른 이름";
      if (spec.operation.type === "callTool") spec.operation.input = { city: "서울" };
    });

    expect(accept(after)).toBeUndefined();
  });

  it("아무것도 안 바뀌었으면 undefined 다", () => {
    expect(accept(baseSuite())).toBeUndefined();
  });

  it("대상 케이스의 입력값 하나만 바뀌면 그 입력 전체를 돌려준다", () => {
    const before = suiteOf([
      callCase("c1", "get_weather", { city: "example", unit: "c" }),
      callCase("c2", "get_weather", { city: "example2" }),
    ]);
    const after = suiteOf([
      callCase("c1", "get_weather", { city: "서울", unit: "c" }),
      callCase("c2", "get_weather", { city: "example2" }),
    ]);

    expect(acceptProposal({ target: targetOf(before), before, after })).toEqual({
      city: "서울",
      unit: "c",
    });
  });
});
