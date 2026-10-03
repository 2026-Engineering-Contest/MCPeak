import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { measureContributions, measureToolBytes, utf8Bytes } from "../src/measure.js";
import { renderReport } from "../src/report.js";
import type { OptimizedTool, OptimizeOverlay, ToolChange } from "../src/types.js";

// T2 는 T1 의 실제 출력을 기다리지 않는다(계획서 §9.2). 아래 오버레이는 §8.1 의 설계 의도를 따라
// 손으로 만든 원본·압축 쌍이고, 바이트는 measureToolBytes 로 실제로 잰다.
// 기대 리포트 파일과 비교하는 첫 테스트만 T1 의 synthetic.expected.overlay.json 을 입력으로 쓴다(T4).

const WORKSPACE = "Workspace that owns the item to operate.";

interface ToolPair {
  readonly name: string;
  readonly before: { description?: string; inputSchema: unknown };
  readonly after: { description?: string; inputSchema: unknown };
  readonly outputSchema?: unknown;
  readonly changes: readonly ToolChange[];
}

const PAIRS: readonly ToolPair[] = [
  {
    name: "get_item",
    before: {
      description:
        "Fetch one item by id (https://example.com/docs/items). Example: get_item({ id: 'a1' })",
      inputSchema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        title: "GetItemInput",
        type: "object",
        properties: {
          id: { type: "string", title: "Id", description: "The ID" },
          workspaceId: { type: "string", description: WORKSPACE },
        },
        required: [],
        additionalProperties: true,
      },
    },
    after: {
      description: "Fetch one item by id.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" }, workspaceId: { type: "string" } },
      },
    },
    changes: [
      { kind: "schema-key-removed", path: "inputSchema", key: "$schema" },
      { kind: "schema-key-removed", path: "inputSchema", key: "title" },
      { kind: "schema-key-removed", path: "inputSchema.properties.id", key: "title" },
      { kind: "schema-key-removed", path: "inputSchema", key: "required" },
      { kind: "schema-key-removed", path: "inputSchema", key: "additionalProperties" },
      {
        kind: "description-cleaned",
        path: "description",
        before:
          "Fetch one item by id (https://example.com/docs/items). Example: get_item({ id: 'a1' })",
        after: "Fetch one item by id.",
      },
      {
        kind: "description-removed",
        path: "inputSchema.properties.id.description",
        before: "The ID",
        reason: "restates-name",
      },
      {
        kind: "description-removed",
        path: "inputSchema.properties.workspaceId.description",
        before: WORKSPACE,
        reason: "promoted",
      },
    ],
  },
  {
    name: "list_items",
    before: {
      description: "List items in a workspace.",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string", description: WORKSPACE },
          order: { type: "string", enum: ["asc", "desc"], default: "asc" },
          filter: { type: "object", properties: {}, additionalProperties: false },
        },
      },
    },
    after: {
      description: "List items in a workspace.",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string" },
          order: { type: "string", enum: ["asc", "desc"], default: "asc" },
          filter: { type: "object", properties: {}, additionalProperties: false },
        },
      },
    },
    changes: [
      {
        kind: "description-removed",
        path: "inputSchema.properties.workspaceId.description",
        before: WORKSPACE,
        reason: "promoted",
      },
    ],
  },
  {
    name: "update_item",
    before: {
      description: "Update fields of an item.",
      inputSchema: {
        type: "object",
        $defs: {
          patch: {
            title: "Patch",
            type: "object",
            description: "Fields to change, see https://example.com/patch",
          },
        },
        properties: {
          workspaceId: { type: "string", description: WORKSPACE },
          patch: { $ref: "#/$defs/patch" },
        },
      },
    },
    after: {
      description: "Update fields of an item.",
      inputSchema: {
        type: "object",
        $defs: { patch: { type: "object", description: "Fields to change, see" } },
        properties: { workspaceId: { type: "string" }, patch: { $ref: "#/$defs/patch" } },
      },
    },
    changes: [
      { kind: "schema-key-removed", path: "inputSchema.$defs.patch", key: "title" },
      {
        kind: "description-cleaned",
        path: "inputSchema.$defs.patch.description",
        before: "Fields to change, see https://example.com/patch",
        after: "Fields to change, see",
      },
      {
        kind: "description-removed",
        path: "inputSchema.properties.workspaceId.description",
        before: WORKSPACE,
        reason: "promoted",
      },
    ],
  },
  {
    name: "delete_item",
    before: {
      description: "Delete an item permanently.",
      inputSchema: {
        type: "object",
        description: "Delete an item permanently.",
        properties: { workspaceId: { type: "string", description: WORKSPACE } },
      },
    },
    after: {
      description: "Delete an item permanently.",
      inputSchema: { type: "object", properties: { workspaceId: { type: "string" } } },
    },
    outputSchema: { type: "object", properties: { deleted: { type: "boolean" } } },
    changes: [
      {
        kind: "description-removed",
        path: "inputSchema.description",
        before: "Delete an item permanently.",
        reason: "duplicate-of-tool-description",
      },
      {
        kind: "description-removed",
        path: "inputSchema.properties.workspaceId.description",
        before: WORKSPACE,
        reason: "promoted",
      },
    ],
  },
  {
    name: "archive_item",
    before: {
      description: "Archive an item so it no longer shows in lists.",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string", description: WORKSPACE },
          note: { type: "string", description: "Reason recorded with the archive entry." },
        },
      },
    },
    after: {
      description: "Archive an item so it no longer shows in lists.",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string" },
          note: { type: "string", description: "Reason recorded with the archive entry." },
        },
      },
    },
    changes: [
      {
        kind: "description-removed",
        path: "inputSchema.properties.workspaceId.description",
        before: WORKSPACE,
        reason: "promoted",
      },
    ],
  },
];

const INSTRUCTIONS = "Item store server.\nAll tools act on a single workspace.";
const DICTIONARY = `Common parameters (shared by several tools):\n- workspaceId: ${WORKSPACE}`;

function toOptimizedTool(pair: ToolPair): OptimizedTool {
  return {
    name: pair.name,
    description: pair.after.description,
    inputSchema: pair.after.inputSchema,
    ...(pair.outputSchema === undefined ? {} : { outputSchema: pair.outputSchema }),
    changes: pair.changes,
    bytes: {
      before: measureToolBytes({ name: pair.name, ...pair.before }),
      after: measureToolBytes({ name: pair.name, ...pair.after }),
    },
  };
}

/** 원본·압축 쌍과 instructions 로 오버레이를 만든다. totals 는 도구 바이트에서 계산한다. */
function buildOverlay(
  pairs: readonly ToolPair[],
  options: {
    instructions?: string;
    instructionsAfter?: string;
    promotedParameters?: number;
    otherCapabilities?: OptimizeOverlay["source"]["otherCapabilities"];
  } = {},
): OptimizeOverlay {
  const instructions = options.instructions ?? "";
  const instructionsAfter = options.instructionsAfter ?? instructions;
  const tools = pairs.map(toOptimizedTool);
  const bytesBefore = tools.reduce((sum, tool) => sum + tool.bytes.before, 0);
  const bytesAfter = tools.reduce((sum, tool) => sum + tool.bytes.after, 0);
  return {
    schemaVersion: 1,
    generator: { name: "@mcpeak/optimize", version: "0.1.0" },
    source: {
      toolCount: tools.length,
      toolNames: tools.map((tool) => tool.name).sort(),
      instructions,
      bytes: bytesBefore,
      otherCapabilities: options.otherCapabilities ?? [],
    },
    instructions: instructionsAfter,
    tools,
    totals: {
      bytesBefore,
      bytesAfter,
      bytesAfterWithInstructions:
        bytesAfter + utf8Bytes(instructionsAfter) - utf8Bytes(instructions),
      promotedParameters: options.promotedParameters ?? 0,
    },
  };
}

function syntheticOverlay(
  otherCapabilities: OptimizeOverlay["source"]["otherCapabilities"] = [],
): OptimizeOverlay {
  return buildOverlay(PAIRS, {
    instructions: INSTRUCTIONS,
    instructionsAfter: `${INSTRUCTIONS}\n\n${DICTIONARY}`,
    promotedParameters: 1,
    otherCapabilities,
  });
}

/** 바이트만 손으로 정한 도구. 숫자 포맷 검증용이다. */
function toolWithBytes(name: string, before: number, after: number): OptimizedTool {
  return { name, inputSchema: { type: "object" }, changes: [], bytes: { before, after } };
}

function overlayWithBytes(
  tools: readonly OptimizedTool[],
  totals: OptimizeOverlay["totals"],
): OptimizeOverlay {
  return {
    ...buildOverlay([]),
    source: { ...buildOverlay([]).source, toolCount: tools.length },
    tools,
    totals,
  };
}

const LAST_LINE =
  "이 오버레이는 tools/list 만 바꿉니다. tools/call 은 원본 이름과 인자로 서버에 전달됩니다.";

describe("renderReport", () => {
  it("synthetic 오버레이의 리포트가 fixtures/synthetic.expected.report.txt 와 글자 단위로 같다", () => {
    // 입력은 손으로 만든 오버레이가 아니라 T1 의 optimize() 가 낸 파일 픽스처다. 기대 리포트의
    // 숫자가 실제 변환기의 출력과 한 쌍으로 묶여야 둘 중 하나만 바뀌었을 때 여기서 걸린다.
    const overlay = JSON.parse(
      readFileSync(new URL("./fixtures/synthetic.expected.overlay.json", import.meta.url), "utf8"),
    ) as OptimizeOverlay;
    const expected = readFileSync(
      new URL("./fixtures/synthetic.expected.report.txt", import.meta.url),
      "utf8",
    );
    expect(renderReport(overlay)).toBe(expected);
  });

  it("otherCapabilities 가 있으면 주의 문단이 마지막 줄 앞에 들어간다", () => {
    const lines = renderReport(syntheticOverlay(["resources", "prompts"])).split("\n");
    // 끝의 개행 때문에 마지막 원소는 빈 문자열이다.
    expect(lines.slice(-6)).toEqual([
      "",
      "주의: 서버가 resources, prompts 능력도 광고합니다. 프록시는 tools 만 중계하므로 그 능력은",
      "클라이언트에 보이지 않습니다.",
      "",
      LAST_LINE,
      "",
    ]);
    expect(renderReport(syntheticOverlay())).not.toContain("주의:");
  });

  it("전혀 줄지 않은 도구 수를 센다", () => {
    const report = renderReport(
      overlayWithBytes(
        [
          toolWithBytes("a", 100, 100),
          toolWithBytes("b", 100, 60),
          toolWithBytes("c", 50, 50),
          toolWithBytes("d", 80, 90),
        ],
        {
          bytesBefore: 330,
          bytesAfter: 300,
          bytesAfterWithInstructions: 300,
          promotedParameters: 0,
        },
      ),
    );
    expect(report).toContain("\n전혀 줄지 않은 도구 3개\n");
    // 줄지 않은 도구는 "가장 많이 줄어든 도구" 목록에 오르지 않는다.
    expect(report).toContain("가장 많이 줄어든 도구\n  b  100 → 60  (40.0%)\n\n");
  });

  it("퍼센트는 소수 첫째 자리, 토큰은 바이트÷4 반올림이다", () => {
    const report = renderReport(
      overlayWithBytes([toolWithBytes("a", 1001, 667), toolWithBytes("b", 3, 2)], {
        bytesBefore: 1001,
        bytesAfter: 667,
        bytesAfterWithInstructions: 667,
        promotedParameters: 0,
      }),
    );
    // 1001/4 = 250.25 → 250, 667/4 = 166.75 → 167, 334/1001 = 33.366… → 33.4
    expect(report).toContain("  원본            1001  (~250 토큰)\n");
    expect(report).toContain("  압축            667  (~167 토큰, 33.4% 감소)\n");
    // 1/3 = 33.33… → 33.3, 정수로 떨어져도 소수 첫째 자리를 적는다
    expect(report).toContain("  b  3 → 2  (33.3%)\n");
    expect(
      renderReport(
        overlayWithBytes([toolWithBytes("a", 10, 9)], {
          bytesBefore: 10,
          bytesAfter: 9,
          bytesAfterWithInstructions: 9,
          promotedParameters: 0,
        }),
      ),
    ).toContain("  a  10 → 9  (10.0%)\n");
  });

  it("도구 정렬은 감소 바이트 내림차순이고 같으면 원본 순서이며 최대 5줄이다", () => {
    const tools = ["t1", "t2", "t3", "t4", "t5", "t6", "t7"].map((name, i) =>
      toolWithBytes(name, 100, i === 2 ? 50 : 90),
    );
    const report = renderReport(
      overlayWithBytes(tools, {
        bytesBefore: 700,
        bytesAfter: 590,
        bytesAfterWithInstructions: 590,
        promotedParameters: 0,
      }),
    );
    const section = report.split("가장 많이 줄어든 도구\n")[1]?.split("\n\n")[0];
    expect(section?.split("\n").map((line) => line.trim().split(" ")[0])).toEqual([
      "t3",
      "t1",
      "t2",
      "t4",
      "t5",
    ]);
  });

  it("같은 입력에 두 번 렌더링한 결과가 같다", () => {
    expect(renderReport(syntheticOverlay(["logging"]))).toBe(
      renderReport(syntheticOverlay(["logging"])),
    );
  });
});

describe("measureContributions", () => {
  it("세 변환의 기여 합이 전체 감소와 같다", () => {
    const overlay = syntheticOverlay();
    const c = measureContributions(overlay);
    expect(c.lossless + c.noise + c.promotion).toBe(
      overlay.totals.bytesBefore - overlay.totals.bytesAfterWithInstructions,
    );
    expect(c.dictionary).toBe(utf8Bytes(`\n\n${DICTIONARY}`));
  });

  it("changes 의 kind·reason 으로 잡음 제거와 승격을 나눠 센다", () => {
    const c = measureContributions(syntheticOverlay());
    const removed = (text: string) => utf8Bytes(`"description":${JSON.stringify(text)}`) + 1;
    const cleaned = (before: string, after: string) =>
      utf8Bytes(JSON.stringify(before)) - utf8Bytes(JSON.stringify(after));
    expect(c.noise).toBe(
      cleaned(
        "Fetch one item by id (https://example.com/docs/items). Example: get_item({ id: 'a1' })",
        "Fetch one item by id.",
      ) +
        removed("The ID") +
        cleaned("Fields to change, see https://example.com/patch", "Fields to change, see"),
    );
    // duplicate-of-tool-description 은 §3.1 대로 무손실 정규화 몫이다.
    expect(c.lossless).toBeGreaterThanOrEqual(removed("Delete an item permanently."));
    expect(c.promotion).toBe(5 * removed(WORKSPACE) - c.dictionary);
  });

  it("measureToolBytes 는 {name, description, input_schema} 의 compact JSON UTF-8 바이트다", () => {
    const tool = { name: "날씨", description: "é", inputSchema: { type: "object" } };
    expect(measureToolBytes(tool)).toBe(
      Buffer.byteLength('{"name":"날씨","description":"é","input_schema":{"type":"object"}}'),
    );
    expect(measureToolBytes({ name: "a", inputSchema: {} })).toBe(
      Buffer.byteLength('{"name":"a","input_schema":{}}'),
    );
  });
});
