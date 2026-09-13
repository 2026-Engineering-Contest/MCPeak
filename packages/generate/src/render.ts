import type { ToolDef } from "@mcpeak/core";
import type { TestCaseSpec } from "@mcpeak/runner";
import type { FieldOrigin, FixtureFile, ValueOrigin } from "./fixtures.js";
import { fixtureValuesFor } from "./fixtures.js";
import { convertOutputSchema } from "./output-schema.js";
import {
  fail,
  type JsonObject,
  type JsonSchema,
  type JsonValue,
  plainObject,
  validateSchema,
} from "./schema.js";
import { synthesizeValue, valueMatchesSchema } from "./synthesize.js";
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

/**
 * 서버 선언이 값을 못 박고 있는지. `provenance.ts` 의 같은 이름 함수와 **같은 규칙**이다.
 * 그쪽은 출처를 집계하고 여기는 출처를 이름 붙인다. 규칙이 갈리면 두 화면이 같은 필드를
 * 다르게 말한다.
 */
const hasCandidate = (schema: Record<string, unknown>): boolean =>
  "const" in schema ||
  "default" in schema ||
  (Array.isArray(schema.examples) && schema.examples.length > 0) ||
  (Array.isArray(schema.enum) && schema.enum.length > 0);

/**
 * 픽스처를 얹은 정상 입력과 그 출처.
 *
 * **최상위 필드에만 적용한다.** `synthesizeValue` 는 재귀하므로 픽스처를 들고 내려가면
 * 중첩 경로 문법(#388)과 뒤엉킨다. 루트 객체를 만든 **뒤** 한 자리에서 덮는 쪽을 골랐다.
 * 그래야 합성 규칙을 한 줄도 안 건드리고, `synthesizeValue` 의 여러 호출부가 그대로 있는다.
 *
 * 픽스처가 `const`·`default` 보다 앞이다. `default` 가 자리값인 서버가 많고, 사용자가 실재
 * 값을 줬는데 서버의 선언이 이기면 픽스처 파일이 무의미해진다. **`const` 를 위한 별도 규칙은
 * 두지 않는다.** 픽스처 값이 `const` 와 다르면 아래 검증이 거절하고, 같으면 결과가 같다.
 */
function applyFixtures(
  tool: ToolDef,
  input: JsonObject,
  toolPath: string,
  fixtures: FixtureFile | undefined,
): { readonly input: JsonObject; readonly fieldOrigins: readonly FieldOrigin[] } {
  const properties = plainObject(tool.inputSchema)
    ? (tool.inputSchema.properties as Record<string, unknown> | undefined)
    : undefined;
  const declared = plainObject(properties) ? properties : {};
  const values = fixtureValuesFor(fixtures, tool.name);
  const next: JsonObject = { ...input };

  for (const [field, value] of Object.entries(values)) {
    const fieldSchema = declared[field];
    // 선언에 없는 필드를 조용히 무시하지 않는다. 오타를 무시하면 사용자는 값이 왜 안 들어가는지
    // 모른 채 실패 화면만 본다.
    if (!plainObject(fieldSchema)) {
      fail(
        "INVALID_FIXTURE_VALUE",
        `${toolPath}.inputSchema.properties.${field}`,
        `픽스처 값이 도구 선언에 없는 필드를 가리킵니다:\n  ${tool.name}.${field}`,
        "픽스처 파일에서 그 필드를 지우거나 이름을 선언과 맞추세요.",
      );
    }
    // 검증은 합성값과 **같은 함수**를 쓴다. 두 벌을 만들면 합성값은 통과하고 픽스처 값만
    // 거절되는(또는 그 반대의) 자리가 생긴다.
    if (
      !valueMatchesSchema(
        value,
        fieldSchema as JsonSchema,
        plainObject(tool.inputSchema) ? (tool.inputSchema as JsonSchema) : {},
      )
    ) {
      fail(
        "INVALID_FIXTURE_VALUE",
        `${toolPath}.inputSchema.properties.${field}`,
        `픽스처 값이 도구 선언을 만족하지 않습니다:\n  ${tool.name}.${field}\n  값: ${JSON.stringify(value)}\n  선언: ${JSON.stringify(fieldSchema)}`,
        "픽스처 파일의 해당 값을 선언에 맞게 고치세요.",
      );
    }
    next[field] = value as JsonValue;
  }

  // 출처는 **정상 입력에 실제로 든 최상위 필드**마다 한 건이다. 키 순서는 선언 순서가 아니라
  // 코드 단위 오름차순이라 픽스처 파일의 키 순서가 결과를 바꾸지 않는다.
  const fieldOrigins = Object.keys(next)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((field): FieldOrigin => {
      const fieldSchema = declared[field];
      const origin: ValueOrigin = Object.hasOwn(values, field)
        ? "userFixture"
        : plainObject(fieldSchema) && hasCandidate(fieldSchema)
          ? "schemaDeclared"
          : // format 표의 값도 여기다. 문서용 예약 값이라 형식은 맞지만 실재하지 않는다.
            "schemaHint";
      return { tool: tool.name, field, origin };
    });
  return { input: next, fieldOrigins };
}

interface BuiltSuite {
  readonly suite: GeneratedSuiteSpec;
  readonly outputContractSkip?: OutputContractSkip;
  readonly fieldOrigins: readonly FieldOrigin[];
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

function buildSuite(
  tool: ToolDef,
  index: number,
  baseName: string,
  fixtures?: FixtureFile,
): BuiltSuite {
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

  // 픽스처를 얹는다. 합성이 끝난 **뒤** 최상위 필드만 덮는다.
  const fixtured = applyFixtures(tool, input as JsonObject, toolPath, fixtures);
  const happyInput = fixtured.input;
  /**
   * 사용자가 실재를 보증한 필드. 사전보완이 이 값을 AI 에게 묻지 않게 한다(#390 §6).
   *
   * #401 이 만든 `pinnedFields` 를 재사용한다. 새 통로를 만들지 않는다. 그대로 두면
   * `analyzeToolProvenance` 가 스키마만 보고 이 필드를 placeholder 로 세어, 픽스처 값이
   * 실패했을 때 AI 값이 채택돼 **사용자가 보증한 값이 덮인다.**
   */
  const fixtureFields = fixtured.fieldOrigins
    .filter((item) => item.origin === "userFixture")
    .map((item) => item.field);

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
    happyInput,
    baseName,
    responseSchema: outputContract?.supported === true ? outputContract.schema : null,
  });

  // 기준 정상 케이스를 먼저 좁혀 둔다. 배열 리터럴 안에서 만들면 `operation.type` 이
  // `string` 으로 넓어져 GeneratedCase 에 안 맞는다.
  const successCase: GeneratedCase = {
    id: `${baseName}-success`,
    name: `${tool.name}가 오류 없이 응답한다`,
    operation: { type: "callTool", tool: tool.name, input: happyInput },
    assertions: [
      { type: "isError", expected: false },
      ...(outputContract?.supported
        ? [{ type: "structuredContentMatchesSchema" as const, schema: outputContract.schema }]
        : []),
    ],
    // 기준 정상 케이스는 고정할 것이 없다. 근거 없는 값은 전부 사전보완이 채워도 된다.
    // 픽스처로 준 필드만 아래 withFixturePins 가 더한다.
    pinnedFields: [],
  };
  const suiteCases: GeneratedCase[] = [
    successCase,
    // 상한 경계 정상 케이스도 정상 입력을 한 군데만 고친 것이다. 위반 케이스보다 앞에
    // 둔다. 정상 → 상한 경계 정상 → 위반 순서가 읽는 순서다.
    ...buildUpperBoundaryCases({
      tool,
      happyInput,
      baseName,
      responseSchema: outputContract?.supported === true ? outputContract.schema : null,
    }),
    // 정상 분기 케이스도 정상 입력을 한 군데만 고친 것이다. 정상 계열을 앞에 모아 둔다.
    // 실패 목록을 위에서부터 읽을 때 "정상이 되는 입력" 이 한 덩어리로 보여야 한다.
    ...validBranches.cases,
    // 위반 케이스는 정상 입력을 한 군데만 고친 것이다. 정상 입력을 따로 합성하지 않는다.
    // 두 벌이면 "정상 케이스는 통과하는데 위반 케이스는 다른 이유로 실패" 하는 상황을
    // 디버깅할 수 없다.
    ...buildViolationCases({ tool, happyInput, baseName }),
  ].map((item) => withFixturePins(item, fixtureFields));

  return {
    suite: {
      schemaVersion: 1,
      id: `${baseName}-generated`,
      name: `${tool.name} 생성 테스트`,
      defaultTimeoutMs: 10_000,
      cases: suiteCases,
    },
    validBranchSkips: validBranches.skips,
    fieldOrigins: fixtured.fieldOrigins,
    ...(outputContractSkip === undefined ? {} : { outputContractSkip }),
  };
}

/**
 * 픽스처로 준 필드를 정상 케이스의 `pinnedFields` 에 더한다.
 *
 * 위반 케이스는 건드리지 않는다. 사전보완이 애초에 안 고르고(`isHappyPath`), 위반 값은
 * 일부러 어긴 것이라 고정할 대상이 아니다.
 *
 * `valid-branches.ts` 와 `violation-cases.ts` 에 인자를 하나씩 더 넘기지 않고 여기서 합친다.
 * 그 둘은 #401 의 규칙(무엇이 그 케이스를 그 케이스이게 하는가)만 알면 되고, 픽스처는 그
 * 규칙이 아니라 **입력의 출처**다. 두 가지를 한 함수에 섞으면 다음에 출처가 하나 늘 때
 * 세 파일을 함께 고쳐야 한다.
 */
const withFixturePins = (item: GeneratedCase, fields: readonly string[]): GeneratedCase => {
  if (fields.length === 0) return item;
  if (item.assertions[0].expected !== false) return item;
  const merged = [...item.pinnedFields];
  for (const field of fields) if (!merged.includes(field)) merged.push(field);
  return { ...item, pinnedFields: merged };
};

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
export function renderTool(
  tool: ToolDef,
  index: number,
  baseName: string,
  fixtures?: FixtureFile,
): string {
  const built = buildSuite(tool, index, baseName, fixtures);
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
  fixtures?: FixtureFile,
): {
  readonly cases: GeneratedCase[];
  readonly outputContractSkip?: OutputContractSkip;
  readonly validBranchSkips: readonly ValidBranchSkip[];
  /** 정상 입력의 최상위 필드마다 한 건. 위반 케이스는 안 센다(#390). */
  readonly fieldOrigins: readonly FieldOrigin[];
} {
  const built = buildSuite(tool, index, baseName, fixtures);
  return {
    cases: built.suite.cases,
    validBranchSkips: built.validBranchSkips,
    fieldOrigins: built.fieldOrigins,
    ...(built.outputContractSkip === undefined
      ? {}
      : { outputContractSkip: built.outputContractSkip }),
  };
}
