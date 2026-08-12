import type { ToolDef } from "@ohmymcp/core";
import { fail, type JsonObject, plainObject, validateSchema } from "./schema.js";
import { synthesizeValue } from "./synthesize.js";

type GeneratedSuiteSpec = {
  schemaVersion: 1;
  id: string;
  name: string;
  defaultTimeoutMs: number;
  cases: Array<{
    id: string;
    name: string;
    operation: { type: "callTool"; tool: string; input: JsonObject };
    assertions: [{ type: "isError"; expected: false }];
  }>;
};

function buildSuite(tool: ToolDef, index: number, baseName: string): GeneratedSuiteSpec {
  const toolPath = `tools[${index}]`;
  if (!plainObject(tool)) {
    fail(
      "INVALID_TOOL",
      toolPath,
      `도구 정의가 객체가 아닙니다: ${toolPath}`,
      "name과 inputSchema가 있는 ToolDef 객체를 전달하세요.",
    );
  }
  if (typeof tool.name !== "string" || !/\S/.test(tool.name)) {
    fail(
      "INVALID_TOOL",
      `${toolPath}.name`,
      `도구 이름이 비어 있습니다: ${toolPath}.name`,
      "비어 있지 않은 MCP 도구 이름을 지정하세요.",
    );
  }

  validateSchema(tool.inputSchema, `${toolPath}.inputSchema`);
  if (tool.inputSchema.type !== "object") {
    fail(
      "UNSUPPORTED_SCHEMA",
      `${toolPath}.inputSchema.type`,
      `도구 입력 스키마의 루트는 object여야 합니다: ${tool.name}`,
      "MCP 도구 인자를 object JSON Schema로 선언하세요.",
    );
  }

  const input = synthesizeValue(tool.inputSchema, `${toolPath}.inputSchema`);
  if (!plainObject(input)) {
    fail(
      "GENERATED_SUITE_INVALID",
      `${toolPath}.inputSchema`,
      `도구 입력을 JSON 객체로 생성하지 못했습니다: ${tool.name}`,
      "입력 스키마의 루트 type과 required 프로퍼티를 확인하세요.",
    );
  }

  return {
    schemaVersion: 1,
    id: `${baseName}-generated`,
    name: `${tool.name} 생성 테스트`,
    defaultTimeoutMs: 10_000,
    cases: [
      {
        id: `${baseName}-success`,
        name: `${tool.name}가 오류 없이 응답한다`,
        operation: { type: "callTool", tool: tool.name, input: input as JsonObject },
        assertions: [{ type: "isError", expected: false }],
      },
    ],
  };
}

function renderSuite(suite: GeneratedSuiteSpec): string {
  return [
    'import { defineMcpSuite } from "@ohmymcp/runner";',
    "",
    "// 이 파일은 @ohmymcp/generate가 생성했습니다. 실제 client는 별도 실행 진입점에서 주입하세요.",
    `export const generatedSuite = defineMcpSuite(${JSON.stringify(suite, null, 2)});`,
    "",
  ].join("\n");
}

/** 도구 하나를 검증하고 Runner 선언형 suite 소스로 렌더링한다. */
export function renderTool(tool: ToolDef, index: number, baseName: string): string {
  return renderSuite(buildSuite(tool, index, baseName));
}
