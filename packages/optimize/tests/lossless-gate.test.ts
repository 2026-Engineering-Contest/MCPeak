import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDef } from "@mcpeak/core";
import { describe, expect, it } from "vitest";
import { assertLossless } from "../src/lossless-gate.js";
import { optimize } from "../src/optimize.js";
import { type OptimizedTool, OptimizeError } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));

const original: ToolDef[] = JSON.parse(
  readFileSync(join(here, "fixtures", "synthetic.tools.json"), "utf8"),
).tools;

/** 정상 결과를 매번 새로 복제한다. 변조는 이 복제본 한 군데에만 한다. */
function optimizedCopy(): OptimizedTool[] {
  const overlay = optimize({ tools: original, instructions: "", otherCapabilities: [] }, "0.0.0");
  return structuredClone(overlay.tools) as OptimizedTool[];
}

type Json = Record<string, unknown>;

function toolNamed(tools: OptimizedTool[], name: string): Json {
  const tool = tools.find((t) => t.name === name);
  if (tool === undefined) throw new Error(`픽스처에 ${name} 가 없다`);
  return tool as unknown as Json;
}

function at(root: Json, ...keys: string[]): Json {
  let node: unknown = root;
  for (const key of keys) node = (node as Json)[key];
  return node as Json;
}

const HEAD = "→ 압축 결과가 원본과 다른 입력을 받게 됩니다. 이것은 mcpeak optimize 의 결함입니다.";
const FIX =
  "해결: 오버레이를 쓰지 마세요. 이 메시지와 서버 이름을 이슈로 알려 주세요: https://github.com/2026-Engineering-Contest/MCPeak/issues";

function violationOf(tools: OptimizedTool[]): OptimizeError {
  try {
    assertLossless(original, tools);
  } catch (error) {
    expect(error).toBeInstanceOf(OptimizeError);
    expect((error as OptimizeError).code).toBe("LOSSLESS_VIOLATION");
    return error as OptimizeError;
  }
  throw new Error("게이트가 통과시켰다");
}

describe("assertLossless (게이트 A)", () => {
  it("정상 결과는 통과한다", () => {
    expect(() => assertLossless(original, optimizedCopy())).not.toThrow();
  });

  it("도구가 하나 빠지면 LOSSLESS_VIOLATION 이고 문장이 §7.1 과 같다", () => {
    const tools = optimizedCopy().filter((t) => t.name !== "delete_item");
    expect(violationOf(tools).message).toBe(
      [HEAD, "→ 도구 'delete_item' 의 tools 에서 'delete_item' 가 사라졌습니다.", FIX].join("\n"),
    );
  });

  it("도구 이름이 바뀌면 실패한다", () => {
    const tools = optimizedCopy();
    toolNamed(tools, "get_item").name = "fetch_item";
    expect(violationOf(tools).message).toBe(
      [
        HEAD,
        "→ 도구 'get_item' 의 tools 에서 'get_item' 가 사라졌습니다.",
        "→ 도구 'fetch_item' 의 tools 에서 'fetch_item' 가 생겼습니다.",
        FIX,
      ].join("\n"),
    );
  });

  it("outputSchema 가 바뀌면 실패한다", () => {
    const tools = optimizedCopy();
    at(toolNamed(tools, "delete_item"), "outputSchema", "properties", "deleted").type = "string";
    expect(violationOf(tools).message).toBe(
      [
        HEAD,
        "→ 도구 'delete_item' 의 outputSchema.properties.deleted 에서 'type' 가 바뀌었습니다.",
        FIX,
      ].join("\n"),
    );
  });

  it("additionalProperties:false 가 사라지면 실패한다", () => {
    const tools = optimizedCopy();
    delete at(toolNamed(tools, "list_items"), "inputSchema", "properties", "filter")
      .additionalProperties;
    expect(violationOf(tools).message).toBe(
      [
        HEAD,
        "→ 도구 'list_items' 의 inputSchema.properties.filter 에서 'additionalProperties' 가 사라졌습니다.",
        FIX,
      ].join("\n"),
    );
  });

  it("enum 값이 하나 빠지면 실패한다", () => {
    const tools = optimizedCopy();
    at(toolNamed(tools, "list_items"), "inputSchema", "properties", "sort").enum = ["asc"];
    expect(violationOf(tools).message).toBe(
      [
        HEAD,
        "→ 도구 'list_items' 의 inputSchema.properties.sort 에서 'enum' 가 바뀌었습니다.",
        FIX,
      ].join("\n"),
    );
  });

  it("원본에 없던 키가 생기면 실패한다", () => {
    const tools = optimizedCopy();
    at(toolNamed(tools, "get_item"), "inputSchema", "properties", "id").minLength = 1;
    expect(violationOf(tools).message).toBe(
      [
        HEAD,
        "→ 도구 'get_item' 의 inputSchema.properties.id 에서 'minLength' 가 생겼습니다.",
        FIX,
      ].join("\n"),
    );
  });

  it("description 만 다르면 통과한다", () => {
    const tools = optimizedCopy();
    toolNamed(tools, "get_item").description = "완전히 다른 설명";
    delete toolNamed(tools, "archive_item").description;
    at(toolNamed(tools, "list_items"), "inputSchema", "properties", "sort").description = "바꿈";
    delete at(toolNamed(tools, "update_item"), "inputSchema", "properties", "id").description;
    expect(() => assertLossless(original, tools)).not.toThrow();
  });

  it("위반 6건이면 5줄 + '그 외 1건' 이다", () => {
    const tools = optimizedCopy();
    const sort = at(toolNamed(tools, "list_items"), "inputSchema", "properties", "sort");
    sort.enum = ["asc"];
    sort.default = "desc";
    sort.type = "integer";
    const limit = at(toolNamed(tools, "list_items"), "inputSchema", "properties", "limit");
    limit.minimum = 0;
    limit.maximum = 1000;
    limit.multipleOf = 5;
    const lines = violationOf(tools).message.split("\n");
    expect(lines).toHaveLength(8);
    expect(lines[0]).toBe(HEAD);
    expect(lines.slice(1, 6).every((line) => line.startsWith("→ 도구 'list_items' 의 "))).toBe(
      true,
    );
    expect(lines[6]).toBe("→ 그 외 1건");
    expect(lines[7]).toBe(FIX);
  });
});
