import { describe, expect, it } from "vitest";
import {
  describeChange,
  describeChangeParts,
  diffHunks,
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

describe("diffHunks", () => {
  /** 1 부터 count 까지의 숫자를 한 줄씩. */
  function numbered(count: number): string[] {
    return Array.from({ length: count }, (_unused, index) => `line ${index + 1}`);
  }

  it("달라진 줄이 없으면 빈 배열이다", () => {
    expect(diffHunks("a\nb\nc", "a\nb\nc")).toEqual([]);
    expect(diffHunks("", "")).toEqual([]);
  });

  it("가운데 한 줄을 바꾸면 묶음 하나에 앞뒤 2줄 문맥과 줄 번호가 있다", () => {
    const before = numbered(9);
    const after = [...before];
    after[4] = "changed";

    expect(diffHunks(before.join("\n"), after.join("\n"))).toEqual([
      [
        { kind: "same", text: "line 3", beforeNo: 3, afterNo: 3 },
        { kind: "same", text: "line 4", beforeNo: 4, afterNo: 4 },
        { kind: "removed", text: "line 5", beforeNo: 5 },
        { kind: "added", text: "changed", afterNo: 5 },
        { kind: "same", text: "line 6", beforeNo: 6, afterNo: 6 },
        { kind: "same", text: "line 7", beforeNo: 7, afterNo: 7 },
      ],
    ]);
  });

  it("줄을 지우면 뒤 줄의 고친 파일 번호가 하나 당겨진다", () => {
    expect(diffHunks("a\nb\nc\nd", "a\nc\nd", 1)).toEqual([
      [
        { kind: "same", text: "a", beforeNo: 1, afterNo: 1 },
        { kind: "removed", text: "b", beforeNo: 2 },
        { kind: "same", text: "c", beforeNo: 3, afterNo: 2 },
      ],
    ]);
  });

  it("같은 자리에서는 removed 가 added 보다 먼저다", () => {
    const [hunk] = diffHunks("a\nb\nc\nz", "x\ny\nz", 0);
    expect(hunk?.map((line) => line.kind)).toEqual([
      "removed",
      "removed",
      "removed",
      "added",
      "added",
    ]);
    expect(hunk?.map((line) => line.text)).toEqual(["a", "b", "c", "x", "y"]);
  });

  it("멀리 떨어진 두 변경은 묶음 둘이다", () => {
    const before = numbered(12);
    const after = [...before];
    after[1] = "first";
    // 두 변경 사이에 같은 줄이 5줄이다. 문맥 2줄씩으로는 닿지 않는다.
    after[7] = "second";

    const hunks = diffHunks(before.join("\n"), after.join("\n"));
    expect(hunks).toHaveLength(2);
    expect(hunks[0]?.map((line) => line.text)).toEqual([
      "line 1",
      "line 2",
      "first",
      "line 3",
      "line 4",
    ]);
    expect(hunks[1]?.map((line) => line.text)).toEqual([
      "line 6",
      "line 7",
      "line 8",
      "second",
      "line 9",
      "line 10",
    ]);
  });

  it("사이가 2 * context 줄 이하면 묶음 하나로 합친다", () => {
    const before = numbered(12);
    const after = [...before];
    after[1] = "first";
    // 두 변경 사이에 같은 줄이 4줄이다. 문맥이 맞닿는다.
    after[6] = "second";

    const hunks = diffHunks(before.join("\n"), after.join("\n"));
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.map((line) => line.text)).toEqual([
      "line 1",
      "line 2",
      "first",
      "line 3",
      "line 4",
      "line 5",
      "line 6",
      "line 7",
      "second",
      "line 8",
      "line 9",
    ]);
  });

  it("같은 입력은 같은 결과다", () => {
    expect(diffHunks("a\nb\nc\nb", "b\na\nb\nc")).toEqual(diffHunks("a\nb\nc\nb", "b\na\nb\nc"));
  });
});
