import type { ToolDef } from "@mcpeak/core";
import { describe, expect, it } from "vitest";
import { createBaselineSuite } from "../src/baseline.js";
import { canonicalJson } from "../src/canonical.js";
import { type FixtureFile, readFixtureFile } from "../src/fixtures.js";
import { preparePreFillRequest } from "../src/pre-fill.js";
import { buildGeneratedCases } from "../src/render.js";
import { GenerateTestsError, type JsonObject } from "../src/schema.js";

const tool = (name: string, inputSchema: unknown): ToolDef => ({ name, inputSchema });

const weather = tool("get_weather", {
  type: "object",
  required: ["city"],
  properties: { city: { type: "string" } },
});

const fixtureOf = (tools: Record<string, Record<string, unknown>>): FixtureFile =>
  ({ schemaVersion: 1, tools }) as FixtureFile;

const built = (declared: ToolDef, fixtures?: FixtureFile) =>
  buildGeneratedCases(declared, 0, "t", fixtures);

const happyInput = (declared: ToolDef, fixtures?: FixtureFile) =>
  built(declared, fixtures).cases.find((item) => item.id === "t-success")?.operation
    .input as JsonObject;

describe("픽스처 파일 해석", () => {
  it("정상 파일을 읽는다", () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      tools: { get_weather: { city: "서울" } },
      notes: { get_weather: { city: "실재하는 도시여야 한다" } },
    });
    const read = readFixtureFile(text);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") throw new Error("정상 파일이 아니다");
    expect(read.file.tools?.get_weather?.city).toBe("서울");
  });

  it("여섯 사유가 각각 정해진 문장으로 나온다", () => {
    // 조용히 무시하지 않는다. 무시하면 사용자는 자기가 적은 값이 왜 안 들어가는지 모른다.
    const reasonOf = (text: string) => {
      const read = readFixtureFile(text);
      return read.status === "invalid" ? read.reason : "";
    };
    expect(reasonOf("{")).toContain("픽스처 파일이 JSON 이 아닙니다.");
    expect(reasonOf("[]")).toBe("픽스처 최상위가 JSON 객체가 아닙니다.");
    expect(reasonOf('{"schemaVersion":2}')).toBe("픽스처 schemaVersion 이 1 이 아닙니다: 2");
    expect(reasonOf('{"schemaVersion":1,"tools":[]}')).toBe("픽스처의 'tools' 가 객체가 아닙니다.");
    expect(reasonOf('{"schemaVersion":1,"tools":{"t":1}}')).toBe(
      "픽스처의 'tools.t' 가 객체가 아닙니다.",
    );
    expect(reasonOf('{"schemaVersion":1,"notes":{"t":{"f":1}}}')).toBe(
      "픽스처의 'notes.t.f' 가 문자열이 아닙니다.",
    );
  });

  it("tools 가 없어도 정상이다", () => {
    expect(readFixtureFile('{"schemaVersion":1,"notes":{}}').status).toBe("ok");
  });

  it("빈 파일도 정상이다", () => {
    expect(readFixtureFile('{"schemaVersion":1}').status).toBe("ok");
  });
});

describe("해석 순서", () => {
  it("픽스처가 default 를 이긴다", () => {
    // default 가 자리값인 서버가 많다. 사용자가 실재 값을 줬는데 서버 선언이 이기면 픽스처
    // 파일이 무의미해진다.
    const declared = tool("t", {
      type: "object",
      required: ["city"],
      properties: { city: { type: "string", default: "Seoul-default" } },
    });
    expect(happyInput(declared).city).toBe("Seoul-default");
    expect(happyInput(declared, fixtureOf({ t: { city: "서울" } })).city).toBe("서울");
  });

  it("픽스처가 examples 와 enum 도 이긴다", () => {
    const withExamples = tool("t", {
      type: "object",
      required: ["city"],
      properties: { city: { type: "string", examples: ["Busan"] } },
    });
    expect(happyInput(withExamples, fixtureOf({ t: { city: "서울" } })).city).toBe("서울");
    const withEnum = tool("t", {
      type: "object",
      required: ["city"],
      properties: { city: { type: "string", enum: ["서울", "부산"] } },
    });
    expect(happyInput(withEnum, fixtureOf({ t: { city: "부산" } })).city).toBe("부산");
  });

  it("const 를 위한 별도 규칙이 없다", () => {
    // const 와 같은 값이면 결과가 같고, 다른 값이면 아래 검증이 거절한다. 두 사실이 있으면
    // const 전용 분기를 둘 이유가 없다. 계획서가 "이기게 할지" 를 물었는데 검증이 답한다.
    const declared = tool("t", {
      type: "object",
      required: ["mode"],
      properties: { mode: { type: "string", const: "fixed" } },
    });
    expect(happyInput(declared, fixtureOf({ t: { mode: "fixed" } })).mode).toBe("fixed");
    expect(() => built(declared, fixtureOf({ t: { mode: "다른값" } }))).toThrow(GenerateTestsError);
  });

  it("픽스처가 없으면 종전대로 동작한다", () => {
    expect(happyInput(weather).city).toBe("example");
  });

  it("픽스처가 없는 필드는 영향받지 않는다", () => {
    const declared = tool("t", {
      type: "object",
      required: ["city", "unit"],
      properties: { city: { type: "string" }, unit: { type: "string" } },
    });
    const input = happyInput(declared, fixtureOf({ t: { city: "서울" } }));
    expect(input).toEqual({ city: "서울", unit: "example" });
  });

  it("다른 도구의 픽스처는 안 섞인다", () => {
    expect(happyInput(weather, fixtureOf({ other_tool: { city: "서울" } })).city).toBe("example");
  });
});

describe("출처", () => {
  it("픽스처 값은 userFixture 다", () => {
    const { fieldOrigins } = built(weather, fixtureOf({ get_weather: { city: "서울" } }));
    expect(fieldOrigins).toEqual([{ tool: "get_weather", field: "city", origin: "userFixture" }]);
  });

  it("const·default·examples·enum 값은 schemaDeclared 다", () => {
    for (const schema of [
      { type: "string", const: "x" },
      { type: "string", default: "x" },
      { type: "string", examples: ["x"] },
      { type: "string", enum: ["x"] },
    ]) {
      const declared = tool("t", { type: "object", required: ["v"], properties: { v: schema } });
      expect(built(declared).fieldOrigins[0]?.origin).toBe("schemaDeclared");
    }
  });

  it("지어낸 값은 schemaHint 다", () => {
    expect(built(weather).fieldOrigins[0]?.origin).toBe("schemaHint");
  });

  it("format 표에서 온 값도 schemaHint 다", () => {
    // 문서용으로 예약된 값이라 형식은 맞지만 실재하지 않는다. 이 구분이 "서버 결함" 과
    // "데이터 준비 필요" 를 가른다.
    const declared = tool("t", {
      type: "object",
      required: ["home"],
      properties: { home: { type: "string", format: "uri" } },
    });
    expect(happyInput(declared).home).toBe("https://example.com");
    expect(built(declared).fieldOrigins[0]?.origin).toBe("schemaHint");
  });

  it("정상 케이스의 최상위 필드마다 한 건이고 코드 단위 오름차순이다", () => {
    const declared = tool("t", {
      type: "object",
      required: ["zeta", "alpha"],
      properties: { zeta: { type: "string" }, alpha: { type: "string" } },
    });
    expect(built(declared).fieldOrigins.map((item) => item.field)).toEqual(["alpha", "zeta"]);
  });

  it("위반 케이스는 안 센다", () => {
    // 위반 값은 일부러 어긴 것이라 출처를 물을 대상이 아니다. 필드가 하나인 툴에서 위반
    // 케이스는 여럿인데 출처는 한 건이다.
    const result = built(weather);
    expect(result.cases.length).toBeGreaterThan(1);
    expect(result.fieldOrigins).toHaveLength(1);
  });
});

describe("픽스처 검증", () => {
  const rejectedBy = (declared: ToolDef, fixtures: FixtureFile) => {
    try {
      built(declared, fixtures);
    } catch (error) {
      return error as GenerateTestsError;
    }
    throw new Error("거절될 것으로 기대했다");
  };

  it("타입이 다르면 INVALID_FIXTURE_VALUE 로 거절한다", () => {
    const error = rejectedBy(weather, fixtureOf({ get_weather: { city: 0 } }));
    expect(error.code).toBe("INVALID_FIXTURE_VALUE");
    // 도구·필드·값·선언이 메시지에 다 있다.
    expect(error.message).toContain("get_weather.city");
    expect(error.message).toContain("값: 0");
    expect(error.message).toContain('"type":"string"');
    expect(error.hint).toContain("픽스처 파일의 해당 값을 선언에 맞게 고치세요");
  });

  it("범위를 어기면 거절한다", () => {
    const declared = tool("t", {
      type: "object",
      required: ["n"],
      properties: { n: { type: "integer", minimum: 1, maximum: 10 } },
    });
    expect(rejectedBy(declared, fixtureOf({ t: { n: 99 } })).code).toBe("INVALID_FIXTURE_VALUE");
  });

  it("enum 밖이면 거절한다", () => {
    const declared = tool("t", {
      type: "object",
      required: ["unit"],
      properties: { unit: { type: "string", enum: ["c", "f"] } },
    });
    expect(rejectedBy(declared, fixtureOf({ t: { unit: "k" } })).code).toBe(
      "INVALID_FIXTURE_VALUE",
    );
  });

  it("UNSUPPORTED_SCHEMA 를 쓰지 않는다", () => {
    // 그 코드는 baseline.ts 의 툴 단위 건너뛰기 신호다(ADR-0036). 픽스처 오타 때문에 툴이
    // 조용히 건너뛰어지면 안 된다.
    expect(rejectedBy(weather, fixtureOf({ get_weather: { city: 0 } })).code).not.toBe(
      "UNSUPPORTED_SCHEMA",
    );
    expect(() =>
      createBaselineSuite([weather], {
        suiteId: "s",
        suiteName: "s",
        fixtures: fixtureOf({ get_weather: { city: 0 } }),
      }),
    ).toThrow(GenerateTestsError);
  });

  it("선언에 없는 필드를 픽스처에 적으면 거절한다", () => {
    // 오타를 조용히 무시하지 않는다.
    const error = rejectedBy(weather, fixtureOf({ get_weather: { citi: "서울" } }));
    expect(error.code).toBe("INVALID_FIXTURE_VALUE");
    expect(error.message).toContain("선언에 없는 필드");
    expect(error.message).toContain("get_weather.citi");
  });
});

describe("픽스처 값은 사전보완이 묻지 않는다", () => {
  /** `timezone` 만 근거가 없다. 실측의 `mcp-server-time` 이 이 모양이었다. */
  const needsHelp = tool("needs_help", {
    type: "object",
    required: ["timezone"],
    properties: { timezone: { type: "string" } },
  });
  const requestFor = (fixtures?: FixtureFile) => {
    const result = createBaselineSuite([needsHelp], {
      suiteId: "s",
      suiteName: "s",
      ...(fixtures === undefined ? {} : { fixtures }),
    });
    return preparePreFillRequest({
      tools: [needsHelp],
      provenance: result.provenance,
      baseline: result.suite,
      pinnedFieldsByCase: result.pinnedFieldsByCase,
    });
  };

  it("userFixture 출처 필드가 pinnedFields 에 들어간다", () => {
    const result = createBaselineSuite([needsHelp], {
      suiteId: "s",
      suiteName: "s",
      fixtures: fixtureOf({ needs_help: { timezone: "Asia/Seoul" } }),
    });
    expect(result.pinnedFieldsByCase["needs-help-success"]).toEqual(["timezone"]);
  });

  it("그 필드가 assistFields 에서 빠진다", () => {
    // 그대로 두면 픽스처 값이 실패했을 때 AI 값이 채택돼 사용자가 보증한 값이 덮인다.
    const request = requestFor(fixtureOf({ needs_help: { timezone: "Asia/Seoul" } }));
    // 채울 곳이 없는 케이스는 요청에 아예 안 실린다. 그것이 이 규칙이 작동한 증거다.
    expect(request).toBeNull();
  });

  it("픽스처가 없으면 종전대로 assistFields 에 남는다", () => {
    const request = requestFor();
    expect(request?.cases[0]?.assistFields).toEqual(["timezone"]);
  });

  it("위반 케이스의 pinnedFields 는 여전히 빈 배열이다", () => {
    // 사전보완이 위반 케이스를 애초에 안 고른다(isHappyPath). 고정할 대상이 아니다.
    const result = built(needsHelp, fixtureOf({ needs_help: { timezone: "Asia/Seoul" } }));
    for (const item of result.cases)
      if (item.assertions[0].expected === true) expect(item.pinnedFields).toEqual([]);
  });

  it("파생 정상 케이스는 #401 규칙과 픽스처 필드를 함께 갖는다", () => {
    const declared = tool("t", {
      type: "object",
      required: ["unit", "city"],
      properties: {
        unit: { type: "string", enum: ["c", "f", "k"] },
        city: { type: "string" },
      },
    });
    const result = built(declared, fixtureOf({ t: { city: "서울" } }));
    const branch = result.cases.find((item) => item.id === "t-branch-enum-unit-2");
    expect(branch?.pinnedFields).toEqual(["unit", "city"]);
  });
});

describe("픽스처 결정론성", () => {
  const declared = tool("t", {
    type: "object",
    required: ["city", "unit"],
    properties: { city: { type: "string" }, unit: { type: "string" } },
  });

  it("같은 픽스처로 두 번 생성한 결과가 canonicalJson 기준으로 같다", () => {
    const fixtures = fixtureOf({ t: { city: "서울", unit: "c" } });
    expect(canonicalJson(built(declared, fixtures))).toBe(canonicalJson(built(declared, fixtures)));
  });

  it("픽스처의 키 순서를 바꿔도 결과가 같다", () => {
    const forward = fixtureOf({ t: { city: "서울", unit: "c" } });
    const reversed = fixtureOf({ t: { unit: "c", city: "서울" } });
    expect(canonicalJson(built(declared, reversed))).toBe(canonicalJson(built(declared, forward)));
  });
});

describe("픽스처가 준 선택 필드는 '있음' 케이스를 안 만든다", () => {
  const optional = tool("t", {
    type: "object",
    required: ["city"],
    properties: { city: { type: "string" }, note: { type: "string" } },
  });

  it("픽스처를 주면 -branch-with-* 가 안 생기고 skip 에도 안 들어간다", () => {
    // 기준 정상 입력에 이미 있으므로 같은 것을 두 번 보는 케이스가 된다. 게다가 그 케이스는
    // synthesizeValue 가 지어낸 값을 써서, 사용자가 보증한 값을 실재하지 않는 값이 덮는다.
    // #401 에서 parentId 가 전 UUID 0 으로 나가 정상 서버를 빨갛게 만든 그 자리와 같다.
    const result = built(optional, fixtureOf({ t: { note: "실재하는 메모" } }));
    expect(result.cases.some((item) => item.id === "t-branch-with-note")).toBe(false);
    // skip 도 아니다. 안 밟은 분기가 아니라 기준 케이스가 이미 밟은 분기다. 화면에
    // "안 밟았다" 로 찍히면 거짓이 된다.
    expect(result.validBranchSkips.some((item) => item.field === "note")).toBe(false);
    // 기준 케이스에는 픽스처 값이 그대로 있다.
    expect(happyInput(optional, fixtureOf({ t: { note: "실재하는 메모" } })).note).toBe(
      "실재하는 메모",
    );
  });

  it("픽스처가 없으면 그 케이스가 종전대로 생긴다", () => {
    // 회귀 방어. 위 한 줄이 선택 필드 갈래를 통째로 막으면 이 단언이 잡는다.
    const result = built(optional);
    expect(result.cases.some((item) => item.id === "t-branch-with-note")).toBe(true);
  });

  it("픽스처를 준 필드만 빠진다", () => {
    const two = tool("t", {
      type: "object",
      required: ["city"],
      properties: {
        city: { type: "string" },
        note: { type: "string" },
        tag: { type: "string" },
      },
    });
    const result = built(two, fixtureOf({ t: { note: "메모" } }));
    expect(result.cases.some((item) => item.id === "t-branch-with-note")).toBe(false);
    expect(result.cases.some((item) => item.id === "t-branch-with-tag")).toBe(true);
  });
});
