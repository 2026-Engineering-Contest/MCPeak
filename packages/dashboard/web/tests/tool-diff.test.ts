import { describe, expect, it } from "vitest";
import { describeChange, findSourceTool, formatToolSide } from "../src/analyze/tool-diff.js";

describe("formatToolSide", () => {
  it("description 이 없으면 키를 싣지 않고 2칸 들여쓰기로 적는다", () => {
    expect(formatToolSide({ name: "a", inputSchema: { type: "object" } })).toBe(
      '{\n  "name": "a",\n  "inputSchema": {\n    "type": "object"\n  }\n}',
    );
  });

  it("description 이 있으면 name 다음에 온다", () => {
    expect(formatToolSide({ inputSchema: {}, description: "설명", name: "a" })).toBe(
      '{\n  "name": "a",\n  "description": "설명",\n  "inputSchema": {}\n}',
    );
  });
});

describe("findSourceTool", () => {
  const tools = [
    { name: "a", inputSchema: {} },
    { name: "b", description: "B", inputSchema: {} },
  ];

  it("이름으로 원본을 찾는다", () => {
    expect(findSourceTool(tools, "b")).toBe(tools[1]);
  });

  it("없으면 undefined 다", () => {
    expect(findSourceTool(tools, "c")).toBeUndefined();
  });
});

describe("describeChange", () => {
  it("schema-key-removed", () => {
    expect(
      describeChange({ kind: "schema-key-removed", path: "/properties/x", key: "$schema" }),
    ).toBe("`/properties/x` 에서 '$schema' 키를 지웠습니다. 검증 의미는 같습니다.");
  });

  it("description-cleaned", () => {
    expect(
      describeChange({ kind: "description-cleaned", path: "/", before: "  A  ", after: "A" }),
    ).toBe('`/` 설명을 정리했습니다: "  A  " → "A"');
  });

  it.each([
    ["restates-name", "이름을 되풀이함"],
    ["empty", "비어 있음"],
    ["duplicate-of-tool-description", "도구 설명과 같음"],
    ["promoted", "공통 파라미터로 서버 instructions 에 옮김"],
  ] as const)("description-removed (%s)", (reason, text) => {
    expect(
      describeChange({ kind: "description-removed", path: "/properties/q", before: "q", reason }),
    ).toBe(`\`/properties/q\` 설명을 지웠습니다(${text}): "q"`);
  });
});
