import type { ToolDef } from "@ohmymcp/core";
import { computeCoverage, createBaselineSuite } from "@ohmymcp/generate";
import type { TestSuiteSpec } from "@ohmymcp/runner";
import { describe, expect, it } from "vitest";
import {
  renderCoverage,
  renderPreFillSummary,
  renderUnknownFormatSkips,
} from "../src/generate-command.js";

describe("표 밖 format 건너뜀 고지", () => {
  it("건너뜀 고지에 해결 수단이 있다", () => {
    const text = renderUnknownFormatSkips([
      { tool: "lookup_host", field: "pointer", format: "json-pointer" },
    ]);
    expect(text).toContain("lookup_host");
    expect(text).toContain("json-pointer");
    // "지원하지 않는다" 로 끝내면 사용자가 할 수 있는 일이 없다.
    expect(text).toContain("--baseline-only 없이");
  });

  it("건너뛸 툴이 없으면 아무것도 찍지 않는다", () => {
    expect(renderUnknownFormatSkips([])).toBe("");
  });

  it("format 이름을 못 읽으면 필드만 적고 이름을 지어내지 않는다", () => {
    const text = renderUnknownFormatSkips([{ tool: "t", field: "v", format: "" }]);
    expect(text).toContain("'v' 의 format");
    expect(text).not.toContain("format ''");
  });
});

describe("사전보완 결과 요약", () => {
  const base = { toolCount: 8, proposedToolCount: 5, adopted: 3, notAdopted: 2 };

  it("채택·미채택 수를 적는다", () => {
    const text = renderPreFillSummary({ ...base, discarded: [] });
    expect(text).toContain("툴 8개 중 5개");
    expect(text).toContain("채택 3");
    expect(text).toContain("미채택 2");
  });

  it("버림이 0건이면 버림 줄을 찍지 않는다", () => {
    expect(renderPreFillSummary({ ...base, discarded: [] })).not.toContain("버림");
  });

  it("버림 사유와 대상을 적는다", () => {
    const text = renderPreFillSummary({
      ...base,
      discarded: [
        {
          caseId: "get_weather",
          field: "unit",
          reason: "근거 있는 값을 덮어쓰려 해서 버렸습니다",
        },
      ],
    });
    expect(text).toContain("get_weather.unit");
    expect(text).toContain("근거 있는 값");
  });

  it("대상도 버림도 없으면 아무것도 찍지 않는다", () => {
    expect(
      renderPreFillSummary({
        toolCount: 3,
        proposedToolCount: 0,
        adopted: 0,
        notAdopted: 0,
        discarded: [],
      }),
    ).toBe("");
  });
});

describe("커버리지 분모 변화 고지", () => {
  const emptySuite: TestSuiteSpec = { schemaVersion: 1, id: "s", name: "s", cases: [] };
  const ranged: ToolDef = {
    name: "r",
    inputSchema: {
      type: "object",
      required: ["v"],
      properties: { v: { type: "integer", minimum: 1 } },
    },
  };
  const plain: ToolDef = {
    name: "p",
    inputSchema: { type: "object", required: ["v"], properties: { v: { type: "string" } } },
  };

  // 고지는 renderCoverage 안에 하나만 있다. 종전에는 renderRangeAxisNotice 가 따로 있어
  // 같은 말이 두 번 나가고, 전부 검증된 화면에도 "낮게 보이면" 안내가 붙었다.
  it("미검증인 범위 축이 있으면 분모가 커진 이유를 적는다", () => {
    const text = renderCoverage(computeCoverage({ tools: [ranged], suite: emptySuite }));
    expect(text).toContain("범위 제약");
    expect(text).toContain("새로 드러난 빈틈");
  });

  it("고지는 한 번만 나간다", () => {
    const text = renderCoverage(computeCoverage({ tools: [ranged], suite: emptySuite }));
    expect(text.split("새로 드러난 빈틈")).toHaveLength(2);
  });

  it("범위 축이 없으면 고지하지 않는다", () => {
    const text = renderCoverage(computeCoverage({ tools: [plain], suite: emptySuite }));
    expect(text).not.toContain("범위 제약");
  });

  it("범위 축이 전부 검증됐으면 고지하지 않는다", () => {
    const baseline = createBaselineSuite([ranged], { suiteId: "s", suiteName: "s" });
    const text = renderCoverage(baseline.coverage);
    // baseline 이 범위 위반 케이스까지 만들어 전부 덮는다. 고칠 것이 없는 화면에
    // 경고성 문구가 붙으면 영구 소음이 된다.
    expect(text).toContain("전부 검증");
    expect(text).not.toContain("새로 드러난 빈틈");
  });
});
