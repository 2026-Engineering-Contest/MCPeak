import type { ToolDef } from "@mcpeak/core";
import type { TestCaseSpec } from "@mcpeak/runner";
import { convertOutputSchema } from "./output-schema.js";
import { fail, type JsonObject, plainObject, validateSchema } from "./schema.js";
import { synthesizeValue } from "./synthesize.js";
import { buildValidBranchCases, type ValidBranchSkip } from "./valid-branches.js";
import {
  buildUpperBoundaryCases,
  buildViolationCases,
  type GeneratedCase,
} from "./violation-cases.js";

type GeneratedSuiteSpec = {
  schemaVersion: 1;
  id: string;
  name: string;
  defaultTimeoutMs: number;
  cases: GeneratedCase[];
};

export interface OutputContractSkip {
  readonly index: number;
  readonly name: string;
  readonly path: string;
  readonly message: string;
}

interface BuiltSuite {
  readonly suite: GeneratedSuiteSpec;
  readonly outputContractSkip?: OutputContractSkip;
  /** 비어 있으면 빈 배열이다. undefined 로 두지 않는다. 호출부가 `?? []` 를 안 써도 되게 한다. */
  readonly validBranchSkips: readonly ValidBranchSkip[];
}

/**
 * 명세에 싣는 모양으로 바꾼다. `pinnedFields` 를 벗기는 자리다.
 *
 * runner 의 케이스 검증은 모르는 키를 거절한다(`spec/validation.ts` 의 `unknowns` 가 받는 것은
 * id · name · timeoutMs · operation · assertions 다섯뿐이다). `pinnedFields` 를 그대로 실으면
 * `validateMcpSuite` 가 `UNKNOWN_FIELD` 로 스위트를 거절하고, 생성 파일을 사용자가 돌릴 때도
 * 같은 자리에서 거절된다. 그래서 명세가 되는 경계에서 벗긴다.
 *
 * 부수 효과로 스위트 바이트가 이 필드 때문에 흔들리지 않아 `suiteFingerprint` 가 안정적이다.
 */
export const toSuiteCase = ({
  pinnedFields: _pinnedFields,
  ...rest
}: GeneratedCase): TestCaseSpec => rest as TestCaseSpec;

function buildSuite(tool: ToolDef, index: number, baseName: string): BuiltSuite {
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

  const outputContract =
    tool.outputSchema === undefined
      ? undefined
      : convertOutputSchema(tool.outputSchema, `${toolPath}.outputSchema`);
  const outputContractSkip =
    outputContract !== undefined && !outputContract.supported
      ? {
          index,
          name: tool.name,
          path: outputContract.path,
          message: outputContract.message,
        }
      : undefined;

  const validBranches = buildValidBranchCases({
    tool,
    happyInput: input as JsonObject,
    baseName,
    responseSchema: outputContract?.supported === true ? outputContract.schema : null,
  });

  return {
    suite: {
      schemaVersion: 1,
      id: `${baseName}-generated`,
      name: `${tool.name} 생성 테스트`,
      defaultTimeoutMs: 10_000,
      cases: [
        {
          id: `${baseName}-success`,
          name: `${tool.name}가 오류 없이 응답한다`,
          operation: { type: "callTool", tool: tool.name, input: input as JsonObject },
          assertions: [
            { type: "isError", expected: false },
            ...(outputContract?.supported
              ? [{ type: "structuredContentMatchesSchema" as const, schema: outputContract.schema }]
              : []),
          ],
          // 기준 정상 케이스는 고정할 것이 없다. 근거 없는 값은 전부 사전보완이 채워도 된다.
          pinnedFields: [],
        },
        // 상한 경계 정상 케이스도 정상 입력을 한 군데만 고친 것이다. 위반 케이스보다 앞에
        // 둔다. 정상 → 상한 경계 정상 → 위반 순서가 읽는 순서다.
        ...buildUpperBoundaryCases({
          tool,
          happyInput: input as JsonObject,
          baseName,
          responseSchema: outputContract?.supported === true ? outputContract.schema : null,
        }),
        // 정상 분기 케이스도 정상 입력을 한 군데만 고친 것이다. 정상 계열을 앞에 모아 둔다.
        // 실패 목록을 위에서부터 읽을 때 "정상이 되는 입력" 이 한 덩어리로 보여야 한다.
        ...validBranches.cases,
        // 위반 케이스는 정상 입력을 한 군데만 고친 것이다. 정상 입력을 따로 합성하지 않는다.
        // 두 벌이면 "정상 케이스는 통과하는데 위반 케이스는 다른 이유로 실패" 하는 상황을
        // 디버깅할 수 없다.
        ...buildViolationCases({ tool, happyInput: input as JsonObject, baseName }),
      ],
    },
    validBranchSkips: validBranches.skips,
    ...(outputContractSkip === undefined ? {} : { outputContractSkip }),
  };
}

function renderSuite(suite: GeneratedSuiteSpec, outputContractSkip?: OutputContractSkip): string {
  return [
    'import { defineMcpSuite } from "@mcpeak/runner";',
    "",
    "// 이 파일은 @mcpeak/generate가 생성했습니다. 직접 수정하지 마세요.",
    "// 실제 client는 별도 실행 진입점에서 주입하고, 사람이 작성하는 테스트는 별도 파일에 두세요.",
    ...(outputContractSkip === undefined
      ? []
      : [`// 출력 계약 미검증: ${outputContractSkip.path}`, `// ${outputContractSkip.message}`]),
    `export const generatedSuite = defineMcpSuite(${JSON.stringify(
      { ...suite, cases: suite.cases.map(toSuiteCase) },
      null,
      2,
    )});`,
    "",
  ].join("\n");
}

/** 도구 하나를 검증하고 Runner 선언형 suite 소스로 렌더링한다. */
export function renderTool(tool: ToolDef, index: number, baseName: string): string {
  const built = buildSuite(tool, index, baseName);
  return renderSuite(built.suite, built.outputContractSkip);
}

/**
 * 파일 생성과 baseline이 함께 쓰는 단일 도구 case 합성 단계다.
 * 파일로 쓰는 suite와 baseline suite가 같은 case를 만들도록 buildSuite 하나만 쓴다.
 * 도구 하나가 기준 정상 케이스 1개와 파생 정상 케이스·위반 케이스 여러 개를 낸다.
 */
export function buildGeneratedCases(
  tool: ToolDef,
  index: number,
  baseName: string,
): {
  readonly cases: GeneratedCase[];
  readonly outputContractSkip?: OutputContractSkip;
  readonly validBranchSkips: readonly ValidBranchSkip[];
} {
  const built = buildSuite(tool, index, baseName);
  return {
    cases: built.suite.cases,
    validBranchSkips: built.validBranchSkips,
    ...(built.outputContractSkip === undefined
      ? {}
      : { outputContractSkip: built.outputContractSkip }),
  };
}
