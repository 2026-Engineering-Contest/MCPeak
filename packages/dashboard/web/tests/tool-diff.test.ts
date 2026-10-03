import { describe, expect, it } from "vitest";
import {
  describeChange,
  describeChangeParts,
  diffLines,
  findSourceTool,
  formatToolSide,
} from "../src/analyze/tool-diff.js";

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
    ).toBe("/properties/x 에서 '$schema' 키를 지웠습니다. 검증 의미는 같습니다.");
  });

  it("description-cleaned", () => {
    expect(
      describeChange({ kind: "description-cleaned", path: "/", before: "  A  ", after: "A" }),
    ).toBe('/ 설명을 정리했습니다: "  A  " → "A"');
  });

  it.each([
    ["restates-name", "이름을 되풀이함"],
    ["empty", "비어 있음"],
    ["duplicate-of-tool-description", "도구 설명과 같음"],
    ["promoted", "공통 파라미터로 서버 instructions 에 옮김"],
  ] as const)("description-removed (%s)", (reason, text) => {
    expect(
      describeChange({ kind: "description-removed", path: "/properties/q", before: "q", reason }),
    ).toBe(`/properties/q 설명을 지웠습니다(${text}): "q"`);
  });

  it("문장에 백틱 문자가 없다", () => {
    const sentences = [
      describeChange({ kind: "schema-key-removed", path: "/properties/x", key: "$schema" }),
      describeChange({ kind: "description-cleaned", path: "/", before: "  A  ", after: "A" }),
      describeChange({
        kind: "description-removed",
        path: "/properties/q",
        before: "q",
        reason: "empty",
      }),
    ];
    for (const sentence of sentences) {
      expect(sentence).not.toContain("`");
    }
  });
});

describe("describeChangeParts", () => {
  it("schema-key-removed", () => {
    expect(
      describeChangeParts({ kind: "schema-key-removed", path: "/properties/x", key: "$schema" }),
    ).toEqual({
      path: "/properties/x",
      text: "에서 '$schema' 키를 지웠습니다. 검증 의미는 같습니다.",
    });
  });

  it("description-cleaned", () => {
    expect(
      describeChangeParts({ kind: "description-cleaned", path: "/", before: "  A  ", after: "A" }),
    ).toEqual({ path: "/", text: '설명을 정리했습니다: "  A  " → "A"' });
  });

  it("description-removed", () => {
    expect(
      describeChangeParts({
        kind: "description-removed",
        path: "/properties/q",
        before: "q",
        reason: "promoted",
      }),
    ).toEqual({
      path: "/properties/q",
      text: '설명을 지웠습니다(공통 파라미터로 서버 instructions 에 옮김): "q"',
    });
  });
});

describe("diffLines", () => {
  /** 한쪽 배열을 다시 문자열로. 줄 순서가 입력 그대로인지 본다. */
  function joined(lines: readonly { readonly text: string }[]): string {
    return lines.map((line) => line.text).join("\n");
  }

  it("같은 문자열이면 전부 same 이다", () => {
    const same = [
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
    ];
    expect(diffLines("a\nb", "a\nb")).toEqual({ before: same, after: same });
  });

  it("가운데 한 줄을 지우면 before 의 그 줄만 removed 이고 after 는 전부 same 이다", () => {
    expect(diffLines("a\nb\nc", "a\nc")).toEqual({
      before: [
        { kind: "same", text: "a" },
        { kind: "removed", text: "b" },
        { kind: "same", text: "c" },
      ],
      after: [
        { kind: "same", text: "a" },
        { kind: "same", text: "c" },
      ],
    });
  });

  it("한 줄을 바꾸면 before 는 removed, after 는 added 다", () => {
    expect(diffLines("a\nb\nc", "a\nB\nc")).toEqual({
      before: [
        { kind: "same", text: "a" },
        { kind: "removed", text: "b" },
        { kind: "same", text: "c" },
      ],
      after: [
        { kind: "same", text: "a" },
        { kind: "added", text: "B" },
        { kind: "same", text: "c" },
      ],
    });
  });

  it("before·after 배열을 이으면 입력과 같다", () => {
    const before = '{\n  "name": "a",\n  "description": "A  ",\n\n  "x": 1\n}';
    const after = '{\n  "name": "a",\n  "description": "A",\n  "y": 2\n}\n';
    const diff = diffLines(before, after);
    expect(joined(diff.before)).toBe(before);
    expect(joined(diff.after)).toBe(after);
    expect(diff.before.every((line) => line.kind !== "added")).toBe(true);
    expect(diff.after.every((line) => line.kind !== "removed")).toBe(true);
  });

  it("같은 입력은 같은 결과다", () => {
    expect(diffLines("a\nb\nc\nb", "b\na\nb\nc")).toEqual(diffLines("a\nb\nc\nb", "b\na\nb\nc"));
  });

  it("LCS 가 여럿이면 원본의 앞쪽 줄을 먼저 맞춘다", () => {
    // "a" 를 맞추는 답과 "b" 를 맞추는 답이 길이가 같다. 원본의 첫 줄 "a" 를 고른다.
    expect(diffLines("a\nb", "b\na")).toEqual({
      before: [
        { kind: "same", text: "a" },
        { kind: "removed", text: "b" },
      ],
      after: [
        { kind: "added", text: "b" },
        { kind: "same", text: "a" },
      ],
    });
  });

  it("빈 문자열끼리는 빈 줄 하나가 same 이다", () => {
    expect(diffLines("", "")).toEqual({
      before: [{ kind: "same", text: "" }],
      after: [{ kind: "same", text: "" }],
    });
  });
});
