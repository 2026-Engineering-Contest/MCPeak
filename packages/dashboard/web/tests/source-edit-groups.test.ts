import { describe, expect, it } from "vitest";
import type { SourceEditResult } from "../../src/api-types.js";
import { groupSourceEditResults, toolsLabel } from "../src/analyze/source-edit-groups.js";

const NOT_FOUND_DETAIL =
  "소스 파일에서 찾지 못했습니다. SDK 나 라이브러리가 만드는 값이면 소스에서 고칠 수 없습니다.";
const UNSUPPORTED_DETAIL = "이 종류의 변경은 자동으로 고치지 않습니다. 직접 고쳐야 합니다.";
const READY_DETAIL = "소스에서 1곳을 찾았습니다.";
const SCHEMA_TEXT = "에서 '$schema' 키를 지웠습니다. 검증 의미는 같습니다.";

function schemaNotFound(tool: string, path = "/"): SourceEditResult {
  return {
    tool,
    change: { kind: "schema-key-removed", path, key: "$schema" },
    status: "not-found",
    detail: NOT_FOUND_DETAIL,
  };
}

function cleanedReady(tool: string, before: string): SourceEditResult {
  return {
    tool,
    change: { kind: "description-cleaned", path: "/", before, after: "A" },
    status: "ready",
    detail: READY_DETAIL,
  };
}

describe("groupSourceEditResults", () => {
  it("같은 상태·경로·문장·사유는 한 묶음이다", () => {
    const tools = ["t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9"];

    expect(groupSourceEditResults(tools.map((tool) => schemaNotFound(tool)))).toEqual([
      { status: "not-found", path: "/", text: SCHEMA_TEXT, detail: NOT_FOUND_DETAIL, tools },
    ]);
  });

  it("같은 도구가 한 묶음에 두 번 오면 이름도 두 번 남는다", () => {
    const groups = groupSourceEditResults([
      schemaNotFound("a"),
      schemaNotFound("b"),
      schemaNotFound("a"),
    ]);

    expect(groups.map((group) => group.tools)).toEqual([["a", "b", "a"]]);
  });

  it("경로나 사유가 다르면 다른 묶음이다", () => {
    const groups = groupSourceEditResults([
      schemaNotFound("a"),
      schemaNotFound("b", "/properties/city"),
      { ...schemaNotFound("c"), status: "unsupported", detail: UNSUPPORTED_DETAIL },
      // 상태는 같고 사유 문장만 다르다.
      { ...schemaNotFound("d"), detail: "다른 사유" },
      // 경로와 사유는 같고 변경 문장만 다르다.
      {
        ...schemaNotFound("e"),
        change: { kind: "schema-key-removed", path: "/", key: "additionalProperties" },
      },
      schemaNotFound("f"),
    ]);

    expect(groups).toEqual([
      {
        status: "not-found",
        path: "/",
        text: SCHEMA_TEXT,
        detail: NOT_FOUND_DETAIL,
        tools: ["a", "f"],
      },
      {
        status: "not-found",
        path: "/properties/city",
        text: SCHEMA_TEXT,
        detail: NOT_FOUND_DETAIL,
        tools: ["b"],
      },
      {
        status: "unsupported",
        path: "/",
        text: SCHEMA_TEXT,
        detail: UNSUPPORTED_DETAIL,
        tools: ["c"],
      },
      { status: "not-found", path: "/", text: SCHEMA_TEXT, detail: "다른 사유", tools: ["d"] },
      {
        status: "not-found",
        path: "/",
        text: "에서 'additionalProperties' 키를 지웠습니다. 검증 의미는 같습니다.",
        detail: NOT_FOUND_DETAIL,
        tools: ["e"],
      },
    ]);
  });

  it("ready 묶음이 먼저 오고 나머지는 처음 나온 순서다", () => {
    const groups = groupSourceEditResults([
      schemaNotFound("a"),
      cleanedReady("a", "A tool.  "),
      { ...schemaNotFound("b"), status: "unsupported", detail: UNSUPPORTED_DETAIL },
      cleanedReady("b", "B tool.  "),
      schemaNotFound("c"),
      cleanedReady("c", "A tool.  "),
    ]);

    expect(groups.map((group) => [group.status, group.text, group.tools])).toEqual([
      ["ready", '설명을 정리했습니다: "A tool.  " → "A"', ["a", "c"]],
      ["ready", '설명을 정리했습니다: "B tool.  " → "A"', ["b"]],
      ["not-found", SCHEMA_TEXT, ["a", "c"]],
      ["unsupported", SCHEMA_TEXT, ["b"]],
    ]);
  });

  it("결과가 없으면 묶음도 없다", () => {
    expect(groupSourceEditResults([])).toEqual([]);
  });

  it("같은 입력은 같은 결과다", () => {
    const results = [
      schemaNotFound("a"),
      cleanedReady("a", "A tool.  "),
      schemaNotFound("b"),
      cleanedReady("b", "B tool.  "),
    ];
    const snapshot = JSON.stringify(results);

    const first = groupSourceEditResults(results);
    const second = groupSourceEditResults(results);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    // 입력을 고치지 않는다.
    expect(JSON.stringify(results)).toBe(snapshot);
  });
});

describe("toolsLabel", () => {
  it("1개면 그 이름이다", () => {
    expect(toolsLabel(["a"])).toBe("a");
  });

  it("2개 이상이면 첫 이름과 나머지 개수다", () => {
    expect(toolsLabel(["a", "b"])).toBe("a 외 1개");
    expect(toolsLabel(["a", "b", "c"])).toBe("a 외 2개");
  });
});
