import type { ToolDef } from "@mcpeak/core";
import type { ResponseSchema, TestCaseSpec } from "@mcpeak/runner";
import { matchCoveredAxes, validateMcpSuite } from "@mcpeak/runner";
import { describe, expect, it } from "vitest";
import { createBaselineSuite } from "../src/baseline.js";
import { canonicalJson } from "../src/canonical.js";
import { preparePreFillRequest, validatePreFillResult } from "../src/pre-fill.js";
import { buildGeneratedCases, renderTool } from "../src/render.js";
import type { JsonObject } from "../src/schema.js";
import { buildValidBranchCases } from "../src/valid-branches.js";
import { buildViolationCases } from "../src/violation-cases.js";

const tool = (name: string, inputSchema: unknown): ToolDef => ({ name, inputSchema });

/** 한 도구의 정상 분기 결과. baseName 은 늘 "t" 다. */
const build = (
  name: string,
  inputSchema: unknown,
  happyInput: JsonObject,
  responseSchema: ResponseSchema | null = null,
) =>
  buildValidBranchCases({
    tool: tool(name, inputSchema),
    happyInput,
    baseName: "t",
    responseSchema,
  });

/** 단일 필드 스키마 하나로 만든 도구 선언. required 를 인자로 받는다. */
const oneField = (field: string, schema: unknown, required: readonly string[]) => ({
  type: "object",
  required: [...required],
  properties: { [field]: schema },
});

const inputValue = (testCase: { operation: { input: JsonObject } } | undefined, field: string) =>
  testCase?.operation.input[field];

describe("enum 분기", () => {
  const units = (values: readonly unknown[]) =>
    oneField("unit", { type: "string", enum: [...values] }, ["unit"]);

  it("enum 이 2개면 두 번째 값 케이스 하나를 만든다", () => {
    const result = build("convert_units", units(["celsius", "fahrenheit"]), { unit: "celsius" });
    expect(result.cases.map((item) => item.id)).toEqual(["t-branch-enum-unit-2"]);
    expect(inputValue(result.cases[0], "unit")).toBe("fahrenheit");
    expect(result.skips).toEqual([]);
  });

  it("enum 이 3개면 두 번째와 마지막을 만들고 skip 은 없다", () => {
    const result = build("convert_units", units(["a", "b", "c"]), { unit: "a" });
    expect(result.cases.map((item) => item.id)).toEqual([
      "t-branch-enum-unit-2",
      "t-branch-enum-unit-last",
    ]);
    expect(result.cases.map((item) => inputValue(item, "unit"))).toEqual(["b", "c"]);
    // 첫·두 번째·마지막이 곧 전부다. 다 밟았는데 "3개만 실행했습니다" 를 찍으면 거짓말이다.
    expect(result.skips).toEqual([]);
  });

  it("enum 이 4개 이상이면 skip 에 개수를 적는다", () => {
    const result = build("convert_units", units(["a", "b", "c", "d"]), { unit: "a" });
    expect(result.cases.map((item) => inputValue(item, "unit"))).toEqual(["b", "d"]);
    expect(result.skips).toEqual([
      {
        tool: "convert_units",
        field: "unit",
        reason: "enum 값 4개 중 3개만 실행했습니다. 첫 값·두 번째 값·마지막 값만 밟습니다.",
      },
    ]);
  });

  it("enum 이 1개면 아무것도 안 만든다", () => {
    const result = build("convert_units", units(["only"]), { unit: "only" });
    expect(result.cases).toEqual([]);
    expect(result.skips).toEqual([]);
  });

  it("두 번째 값이 기준과 같으면 케이스 대신 skip 을 넣는다", () => {
    const result = build("convert_units", units(["a", "a", "b"]), { unit: "a" });
    expect(result.cases.map((item) => item.id)).toEqual(["t-branch-enum-unit-last"]);
    expect(inputValue(result.cases[0], "unit")).toBe("b");
    expect(result.skips).toEqual([
      {
        tool: "convert_units",
        field: "unit",
        reason: "변형 값이 기준 정상 입력과 같아 케이스를 만들지 않았습니다.",
      },
    ]);
  });

  it("배열 enum 값을 canonicalJson 으로 비교한다", () => {
    // === 로 비교하면 서로 다른 배열 객체라 "같다" 를 못 잡고 기준과 똑같은 케이스가 생긴다.
    const result = build("convert_units", units([[1, 2], [1, 2], [3]]), { unit: [1, 2] });
    expect(result.cases.map((item) => item.id)).toEqual(["t-branch-enum-unit-last"]);
    expect(inputValue(result.cases[0], "unit")).toEqual([3]);
    expect(result.skips[0]?.reason).toBe(
      "변형 값이 기준 정상 입력과 같아 케이스를 만들지 않았습니다.",
    );
  });

  it("케이스 이름이 무엇을 밟는지 말한다", () => {
    const result = build("convert_units", units(["a", "b", "c"]), { unit: "a" });
    expect(result.cases.map((item) => item.name)).toEqual([
      "convert_units가 'unit' 의 다른 선언값에 정상 응답한다",
      "convert_units가 'unit' 의 마지막 선언값에 정상 응답한다",
    ]);
  });
});

describe("boolean 분기", () => {
  const verbose = oneField("verbose", { type: "boolean" }, ["verbose"]);

  it("required boolean 은 false 케이스를 만든다", () => {
    const result = build("search", verbose, { verbose: true });
    expect(result.cases.map((item) => item.id)).toEqual(["t-branch-false-verbose"]);
    expect(inputValue(result.cases[0], "verbose")).toBe(false);
    expect(result.cases[0]?.name).toBe("search가 'verbose' 가 false 인 입력에 정상 응답한다");
  });

  it("기준이 이미 false 면 만들지 않는다", () => {
    // default: false 가 선언된 필드가 여기 해당한다. 밟을 다른 갈래가 없다.
    const result = build("search", verbose, { verbose: false });
    expect(result.cases).toEqual([]);
  });
});

describe("선택 필드 분기", () => {
  it("선택 필드마다 있음 케이스를 만든다", () => {
    const result = build(
      "search",
      {
        type: "object",
        required: ["a"],
        properties: { a: { type: "string" }, b: { type: "number" } },
      },
      { a: "example" },
    );
    expect(result.cases.map((item) => item.id)).toEqual(["t-branch-with-b"]);
    const input = result.cases[0]?.operation.input;
    expect(Object.keys(input ?? {}).sort()).toEqual(["a", "b"]);
    // 한 축만 다르다. 기준 입력의 a 를 그대로 들고 b 만 더한다.
    expect(input?.a).toBe("example");
    expect(result.cases[0]?.name).toBe("search가 선택 필드 'b' 를 받아 정상 응답한다");
  });

  it("선택 필드가 enum 이면 있음 케이스만 만들고 skip 을 남긴다", () => {
    // type 을 함께 적는다. enum 만 있고 type 이 없으면 synthesizeValue 의 후보 검증이
    // UNSUPPORTED_SCHEMA 로 떨어져, 이 테스트가 보려는 것과 다른 경로를 탄다.
    const result = build(
      "search",
      oneField("mode", { type: "string", enum: ["x", "y", "z"] }, []),
      {},
    );
    expect(result.cases.map((item) => item.id)).toEqual(["t-branch-with-mode"]);
    expect(result.cases.some((item) => item.id.includes("-branch-enum-"))).toBe(false);
    expect(result.skips).toEqual([
      {
        tool: "search",
        field: "mode",
        reason: "선택 필드라 '있음' 케이스만 만들고 값 분기는 만들지 않았습니다.",
      },
    ]);
  });

  it("선택 필드 값을 못 만들면 그 변형만 건너뛰고 skip 에 사유를 적는다", () => {
    const result = build(
      "search",
      {
        type: "object",
        required: ["keep"],
        properties: {
          keep: { type: "string" },
          // 순환 $ref 라 유한한 값이 없다. 필드 자신이 $ref 가 아니라 갈래 skip 에 안 걸린다.
          loop: { type: "object", required: ["next"], properties: { next: { $ref: "#/$defs/N" } } },
          ok: { type: "number" },
        },
        $defs: {
          N: { type: "object", required: ["next"], properties: { next: { $ref: "#/$defs/N" } } },
        },
      },
      { keep: "example" },
    );
    expect(result.cases.some((item) => item.id === "t-branch-with-loop")).toBe(false);
    expect(result.skips.map((item) => item.field)).toEqual(["loop"]);
    expect(result.skips[0]?.reason.startsWith("선택 필드 값을 만들지 못했습니다: ")).toBe(true);
    // 툴 전체를 건너뛰지 않는다. 다른 선택 필드의 케이스는 그대로 나온다.
    expect(result.cases.map((item) => item.id)).toEqual(["t-branch-with-ok"]);
  });
});

/**
 * `FORMAT_VALUES` 는 문서용으로 예약된 값이다. 그것으로 '있음' 케이스를 만들면 자원의 존재를
 * 확인하는 서버가 옳게 거절하고 우리 정상 케이스가 실패한다. 도그푸딩 E2E 의
 * `create-note-branch-with-parentid` 가 실제로 그렇게 깨졌다.
 */
describe("format 표 값은 '있음' 케이스를 만들지 않는다", () => {
  const PARENT_ID = "11111111-1111-4111-8111-111111111111";

  it("format 이 표에 있으면 skip 을 남긴다", () => {
    const result = build(
      "create_note",
      oneField("parentId", { type: "string", format: "uuid" }, []),
      {},
    );
    expect(result.cases.some((item) => item.id === "t-branch-with-parentid")).toBe(false);
    expect(result.skips).toEqual([
      {
        tool: "create_note",
        field: "parentId",
        reason:
          "선택 필드 값이 format 표의 문서용 예약 값이라 실재하는 자원을 가리키지 않습니다. '있음' 케이스를 만들지 않았습니다.",
      },
    ]);
  });

  it("후보 키워드가 있으면 만든다", () => {
    // 서버가 직접 적은 값이다. 우리 표에서 온 것이 아니므로 실재한다고 본다.
    const result = build(
      "create_note",
      oneField("parentId", { type: "string", format: "uuid", default: PARENT_ID }, []),
      {},
    );
    expect(result.cases.map((item) => item.id)).toEqual(["t-branch-with-parentid"]);
    expect(inputValue(result.cases[0], "parentId")).toBe(PARENT_ID);
    expect(result.skips).toEqual([]);
  });

  it("표 밖 format 은 종전대로 만든다", () => {
    // 표 밖 format 은 값이 표에서 오지 않는다. 문서용 예약 값이라는 근거가 없으므로 거르지 않는다.
    const result = build(
      "create_note",
      oneField("parentId", { type: "string", format: "custom-thing" }, []),
      {},
    );
    expect(result.cases.map((item) => item.id)).toEqual(["t-branch-with-parentid"]);
    expect(result.skips).toEqual([]);
  });

  it("format 이 없는 선택 필드는 종전대로 만든다", () => {
    const result = build("create_note", oneField("body", { type: "string" }, []), {});
    expect(result.cases.map((item) => item.id)).toEqual(["t-branch-with-body"]);
    expect(result.skips).toEqual([]);
  });
});

describe("분기를 만들지 않는 선언", () => {
  it("const 가 있으면 아무것도 안 만든다", () => {
    const result = build("t", oneField("v", { type: "string", const: "fixed" }, ["v"]), {
      v: "fixed",
    });
    expect(result.cases).toEqual([]);
    expect(result.skips).toEqual([]);
  });

  it("anyOf 가 있으면 skip 에 사유를 적는다", () => {
    const result = build(
      "t",
      oneField("v", { anyOf: [{ type: "string" }, { type: "number" }] }, ["v"]),
      { v: "example" },
    );
    expect(result.cases).toEqual([]);
    expect(result.skips[0]?.reason).toBe(
      "anyOf/oneOf/$ref 가 선언돼 있어 갈래별 정상 입력을 만들지 않았습니다.",
    );
  });

  it("oneOf 와 $ref 도 같은 문장이다", () => {
    const composition = "anyOf/oneOf/$ref 가 선언돼 있어 갈래별 정상 입력을 만들지 않았습니다.";
    const viaOneOf = build("t", oneField("v", { oneOf: [{ type: "string" }] }, ["v"]), {
      v: "example",
    });
    const viaRef = build(
      "t",
      {
        type: "object",
        required: ["v"],
        properties: { v: { $ref: "#/$defs/S" } },
        $defs: { S: { type: "string" } },
      },
      { v: "example" },
    );
    expect(viaOneOf.skips[0]?.reason).toBe(composition);
    expect(viaRef.skips[0]?.reason).toBe(composition);
  });

  it("중첩 객체는 skip 에 사유를 적는다", () => {
    const result = build(
      "t",
      oneField("user", { type: "object", properties: { name: { type: "string" } } }, ["user"]),
      { user: { name: "example" } },
    );
    expect(result.cases).toEqual([]);
    expect(result.skips[0]?.reason).toBe("중첩 객체 안의 분기는 아직 생성하지 않습니다.");
  });

  it("루트가 갈래를 가지면 아무것도 만들지 않는다", () => {
    // 어느 갈래의 정상 입력인지 모르는데 루트 required 로만 판정하면 갈래에서 필수인 필드를
    // 선택 필드로 잘못 읽는다. runner 도 이런 툴을 해석 불가로 본다.
    const result = build(
      "t",
      {
        type: "object",
        properties: { a: { type: "string" }, b: { type: "string" } },
        anyOf: [{ required: ["a"] }, { required: ["b"] }],
      },
      { a: "example" },
    );
    expect(result.cases).toEqual([]);
    expect(result.skips).toEqual([]);
  });
});

describe("단언", () => {
  const declaration = {
    type: "object",
    required: ["unit"],
    properties: { unit: { type: "string", enum: ["a", "b", "c"] }, extra: { type: "string" } },
  };
  const happyInput: JsonObject = { unit: "a" };

  it("전부 isError false 다", () => {
    const result = build("t", declaration, happyInput);
    expect(result.cases.length).toBeGreaterThan(0);
    for (const item of result.cases)
      expect(item.assertions[0]).toEqual({ type: "isError", expected: false });
  });

  it("출력 계약이 있으면 기준 정상 케이스와 같은 단언을 붙인다", () => {
    const schema: ResponseSchema = { type: "object", required: ["ok"] };
    const withSchema = build("t", declaration, happyInput, schema);
    expect(withSchema.cases[0]?.assertions).toEqual([
      { type: "isError", expected: false },
      { type: "structuredContentMatchesSchema", schema },
    ]);
    expect(build("t", declaration, happyInput).cases[0]?.assertions).toHaveLength(1);
  });

  it("이 케이스들은 HAPPY_PATH 축만 덮는다", () => {
    const declared = tool("t", declaration);
    const result = buildValidBranchCases({
      tool: declared,
      happyInput,
      baseName: "t",
      responseSchema: null,
    });
    for (const item of result.cases)
      expect(
        matchCoveredAxes({ testCase: item as unknown as TestCaseSpec, tool: declared }).map(
          (axis) => axis.kind,
        ),
      ).toEqual(["HAPPY_PATH"]);
  });
});

describe("고정 필드", () => {
  it("enum·boolean 파생 케이스의 pinnedFields 가 그 필드다", () => {
    const enums = build(
      "t",
      oneField("unit", { type: "string", enum: ["a", "b", "c"] }, ["unit"]),
      {
        unit: "a",
      },
    );
    expect(enums.cases.map((item) => item.pinnedFields)).toEqual([["unit"], ["unit"]]);
    const booleans = build("t", oneField("verbose", { type: "boolean" }, ["verbose"]), {
      verbose: true,
    });
    expect(booleans.cases.map((item) => item.pinnedFields)).toEqual([["verbose"]]);
  });

  it("선택 필드 있음 케이스는 pinnedFields 가 비어 있다", () => {
    // 이 케이스의 정체성은 값이 아니라 그 키가 있다는 사실이다. 값은 근거 없는 합성값이라
    // AI 가 그럴듯하게 채워 주는 편이 낫다. 필드가 사라지지만 않으면 케이스는 자기 일을 한다.
    const result = build("t", oneField("note", { type: "string" }, []), {});
    expect(result.cases.map((item) => item.id)).toEqual(["t-branch-with-note"]);
    expect(result.cases[0]?.pinnedFields).toEqual([]);
  });

  it("기준 정상 케이스와 위반 케이스의 pinnedFields 는 빈 배열이다", () => {
    const declared = tool("t", {
      type: "object",
      required: ["unit"],
      properties: { unit: { type: "string", enum: ["a", "b"] } },
    });
    const built = buildGeneratedCases(declared, 0, "t");
    expect(built.cases.find((item) => item.id === "t-success")?.pinnedFields).toEqual([]);
    for (const item of buildViolationCases({
      tool: declared,
      happyInput: { unit: "a" },
      baseName: "t",
    }))
      expect(item.pinnedFields).toEqual([]);
  });

  it("상한 경계 정상 케이스도 pinnedFields 를 갖는다", () => {
    const built = buildGeneratedCases(
      tool("t", {
        type: "object",
        required: ["n"],
        properties: { n: { type: "integer", minimum: 1, maximum: 10 } },
      }),
      0,
      "t",
    );
    expect(built.cases.find((item) => item.id === "t-bound-upper-n")?.pinnedFields).toEqual(["n"]);
  });
});

describe("명세에는 고정 필드가 실리지 않는다", () => {
  // runner 의 케이스 검증은 모르는 키를 거절한다. pinnedFields 가 그대로 실리면 baseline 이
  // GENERATED_SUITE_INVALID 로 죽고, 생성 파일도 사용자 쪽에서 거절된다.
  const declared = tool("t", {
    type: "object",
    required: ["unit"],
    properties: { unit: { type: "string", enum: ["a", "b", "c"] }, note: { type: "string" } },
  });

  it("baseline 스위트가 runner 계약을 만족한다", () => {
    const result = createBaselineSuite([declared], { suiteId: "s", suiteName: "s" });
    expect(validateMcpSuite(result.suite).valid).toBe(true);
    expect(JSON.stringify(result.suite)).not.toContain("pinnedFields");
  });

  it("생성 파일에도 들어가지 않는다", () => {
    expect(renderTool(declared, 0, "t")).not.toContain("pinnedFields");
  });

  it("고정 필드는 스위트 밖 맵으로 나온다", () => {
    const result = createBaselineSuite([declared], { suiteId: "s", suiteName: "s" });
    expect(result.pinnedFieldsByCase).toEqual({
      "t-branch-enum-unit-2": ["unit"],
      "t-branch-enum-unit-last": ["unit"],
    });
  });
});

describe("사전보완이 고정 필드 제안을 버린다", () => {
  /**
   * `tags` 가 요점이다. 배열은 `provenance` 가 원소로 내려가 판정하므로 배열 자신은 근거 없는
   * 값으로 남아 `assistFields` 에 들어간다. 고정 필드 규칙이 없으면 AI 가 원소 2개짜리 배열을
   * 제안해 maxItems 경계 케이스를 지운다(설계서 §5.5).
   */
  const notes = tool("note", {
    type: "object",
    required: ["tags", "title"],
    properties: {
      tags: { type: "array", items: { type: "string" }, maxItems: 5 },
      // 고정 필드 말고도 채울 곳이 있어야 그 케이스가 요청에 실린다. 이것이 없으면 케이스가
      // 통째로 빠져 버리기 규칙을 탈 기회조차 없다(아래 테스트가 그 경계를 따로 본다).
      title: { type: "string" },
    },
  });
  const requestFor = (withMap: boolean) => {
    const result = createBaselineSuite([notes], { suiteId: "s", suiteName: "s" });
    const request = preparePreFillRequest({
      tools: [notes],
      provenance: result.provenance,
      baseline: result.suite,
      ...(withMap ? { pinnedFieldsByCase: result.pinnedFieldsByCase } : {}),
    });
    if (request === null) throw new Error("요청이 만들어져야 한다");
    return request;
  };
  const wire = (caseId: string, field: string, value: unknown) => ({
    caseId,
    field,
    valueJson: JSON.stringify(value),
  });
  const boundaryCaseId = "note-bound-upper-tags";

  it("고정 필드는 assistFields 에서 빠진다", () => {
    const request = requestFor(true);
    const boundary = request.cases.find((item) => item.caseId === boundaryCaseId);
    expect(boundary?.pinnedFields).toEqual(["tags"]);
    expect(boundary?.assistFields).toEqual(["title"]);
    // 기준 케이스는 그 필드가 고정이 아니므로 종전대로 묻는다.
    expect(request.cases.find((item) => item.caseId === "note-success")?.assistFields).toEqual([
      "tags",
      "title",
    ]);
  });

  it("고정하고 나면 채울 곳이 없는 케이스는 요청에서 아예 빠진다", () => {
    // 기존 규칙("채울 곳이 없는 케이스는 싣지 않는다")이 그대로 작동한 것이다. 버리는 것보다
    // 애초에 안 묻는 쪽이 싸고, provider 가 고칠 자리를 정확히 본다.
    const onlyPinned = tool("solo", {
      type: "object",
      required: ["tags"],
      properties: { tags: { type: "array", items: { type: "string" }, maxItems: 5 } },
    });
    const result = createBaselineSuite([onlyPinned], { suiteId: "s", suiteName: "s" });
    const request = preparePreFillRequest({
      tools: [onlyPinned],
      provenance: result.provenance,
      baseline: result.suite,
      pinnedFieldsByCase: result.pinnedFieldsByCase,
    });
    expect(request?.cases.map((item) => item.caseId)).toEqual(["solo-success"]);
  });

  it("고정 필드 제안은 버리고 사유를 남긴다", () => {
    const request = requestFor(true);
    const result = validatePreFillResult(
      { proposals: [wire(boundaryCaseId, "tags", ["one", "two"])] },
      request,
    );
    expect(result.accepted).toEqual([]);
    expect(result.discarded[0]?.field).toBe("tags");
    expect(result.discarded[0]?.reason).toContain("값을 바꾸면 검증이 사라집니다");
    expect(result.discarded[0]?.reason).toContain("고정해 분기를 검증합니다");
  });

  it("pinnedFields 가 빈 케이스는 모든 제안을 받는다", () => {
    const request = requestFor(true);
    const result = validatePreFillResult(
      { proposals: [wire("note-success", "tags", ["alpha"])] },
      request,
    );
    expect(result.accepted.map((item) => item.caseId)).toEqual(["note-success"]);
    expect(result.discarded).toEqual([]);
  });

  it("고정 필드 맵이 없으면 종전대로 전부 받는다", () => {
    // 손으로 쓴 명세 경로다. 그 정보가 없다고 제안을 전부 버리면 사전보완이 죽는다.
    const request = requestFor(false);
    expect(request.cases.find((item) => item.caseId === boundaryCaseId)?.assistFields).toEqual([
      "tags",
      "title",
    ]);
    const result = validatePreFillResult(
      { proposals: [wire(boundaryCaseId, "tags", ["one", "two"])] },
      request,
    );
    expect(result.discarded).toEqual([]);
    expect(result.accepted.map((item) => item.field)).toEqual(["tags"]);
  });
});

describe("결정론성", () => {
  const declaration = {
    type: "object",
    required: ["unit", "verbose"],
    properties: {
      unit: { type: "string", enum: ["a", "b", "c", "d"] },
      verbose: { type: "boolean" },
      note: { type: "string" },
    },
  };
  const happyInput: JsonObject = { unit: "a", verbose: true };

  it("같은 도구로 두 번 만들면 canonicalJson 이 같다", () => {
    expect(canonicalJson(build("t", declaration, happyInput))).toBe(
      canonicalJson(build("t", declaration, happyInput)),
    );
  });

  it("properties 선언 순서를 뒤집어도 케이스 배열이 같다", () => {
    const reversed = {
      ...declaration,
      properties: Object.fromEntries(Object.entries(declaration.properties).reverse()),
    };
    expect(canonicalJson(build("t", reversed, happyInput))).toBe(
      canonicalJson(build("t", declaration, happyInput)),
    );
  });

  it("한 필드 안의 분기 순서가 enum → boolean → 선택 있음 이다", () => {
    // 한 필드가 셋을 동시에 갖지는 못한다. 선택 필드 규칙이 enum·boolean 규칙보다 먼저라
    // 값 분기와 '있음' 케이스가 한 필드에서 함께 나오지 않는다. 그래서 이 순서는 필드 사이에서
    // 드러나고, 필드 순회가 코드 단위 오름차순이라 결과가 결정론적이다.
    expect(build("t", declaration, happyInput).cases.map((item) => item.id)).toEqual([
      "t-branch-with-note",
      "t-branch-enum-unit-2",
      "t-branch-enum-unit-last",
      "t-branch-false-verbose",
    ]);
  });
});
