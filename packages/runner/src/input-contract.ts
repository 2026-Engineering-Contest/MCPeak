import type { ToolDef } from "@ohmymcp/core";
import { matchResponseSchema, plainObject, typeName } from "./schema-match.js";
import type { JsonValue, ResponseSchema, TestSuiteSpec } from "./spec/types.js";
import type { SpecFinding, SpecFindingCode, SpecFindingsResult } from "./spec-findings.js";
import { MAX_FINDINGS_PER_CASE } from "./spec-findings.js";

export interface InputContractOptions {
  readonly suite: TestSuiteSpec;
  /** McpClient.listTools()의 결과를 그대로 넘긴다. 순서는 결과에 영향을 주지 않는다. */
  readonly tools: readonly ToolDef[];
}

type DeclaredType = "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";

interface NormalizedField {
  /** 선언된 타입. 판정하지 않기로 한 필드는 null이다. */
  readonly type: DeclaredType | null;
  /** 선언된 enum. 없거나 판정하지 않기로 했으면 null이다. */
  readonly enumValues: readonly JsonValue[] | null;
}

interface NormalizedInputSchema {
  readonly fields: ReadonlyMap<string, NormalizedField>;
  readonly required: readonly string[];
  /** additionalProperties가 정확히 false일 때만 true. */
  readonly rejectsUndeclared: boolean;
}

/**
 * 이것이 하나라도 있으면 해석을 포기한다. 조합자·참조 계열은 "이 필드는 없어도 된다" 를
 * 말하고 있을 수 있고, 무시하면 스키마의 뜻이 뒤집혀 오탐이 된다. ADR-0015 참고.
 * 루트에 있으면 그 툴 전체를, 필드 안에 있으면 그 필드만 포기한다.
 */
const BLOCKING_KEYWORDS = [
  "anyOf",
  "oneOf",
  "allOf",
  "not",
  "if",
  "then",
  "else",
  "$ref",
  "$dynamicRef",
  "patternProperties",
  "dependentSchemas",
  "dependentRequired",
  "propertyNames",
  "unevaluatedProperties",
] as const;

const DECLARED_TYPES = [
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null",
] as const;

/** 설계 §9.2 의 검사 종류 순서. 낮을수록 앞에 온다. */
const CODE_ORDER: Record<string, number> = {
  TOOL_NOT_DECLARED: 0,
  SCHEMA_NOT_ANALYZABLE: 1,
  REQUIRED_MISSING: 2,
  UNDECLARED_FIELD: 3,
  TYPE_MISMATCH: 4,
  ENUM_MISMATCH: 5,
};

/** UTF-16 코드 단위 안정 비교. 로캘에 의존하지 않는다. schema-match.ts 의 byCodeUnit 과 같다. */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const hasBlockingKeyword = (schema: Record<string, unknown>): boolean =>
  BLOCKING_KEYWORDS.some((keyword) => Object.hasOwn(schema, keyword));

const declaredType = (value: unknown): DeclaredType | null =>
  DECLARED_TYPES.includes(value as DeclaredType) ? (value as DeclaredType) : null;

/**
 * 서버가 선언한 임의의 JSON Schema 를 우리가 이해하는 구조로 줄인다.
 * 줄이면서 정보를 잃으면 그 부분의 검사를 포기한다. 부분 성공은 없고 해석 불가면 null 이다.
 * 설계 §4.2 · §4.3, ADR-0015.
 */
function normalizeInputSchema(schema: unknown): NormalizedInputSchema | null {
  if (!plainObject(schema)) return null;
  if (hasBlockingKeyword(schema)) return null;
  // MCP 의 툴 입력은 객체지만 서버가 다르게 선언할 자유가 있다. 객체가 아니면 대조할 수 없다.
  if (schema.type !== "object") return null;
  const properties = schema.properties;
  if (!plainObject(properties)) return null;

  const fields = new Map<string, NormalizedField>();
  for (const name of Object.keys(properties).sort(byCodeUnit)) {
    const field = properties[name];
    // 필드 스키마가 객체가 아니거나 차단 키워드를 쓰면 그 필드만 포기한다. required 검사는 계속한다.
    if (!plainObject(field) || hasBlockingKeyword(field)) {
      fields.set(name, { type: null, enumValues: null });
      continue;
    }
    // type 이 배열이면(["string","null"]) 합집합이라 판정하지 않는다.
    const type = declaredType(field.type);
    const rawEnum = field.enum;
    const enumValues =
      Array.isArray(rawEnum) && rawEnum.length > 0 ? (rawEnum as readonly JsonValue[]) : null;
    fields.set(name, { type, enumValues });
  }

  const rawRequired = schema.required;
  const required = Array.isArray(rawRequired)
    ? rawRequired.filter((name): name is string => typeof name === "string")
    : [];

  return { fields, required, rejectsUndeclared: schema.additionalProperties === false };
}

/** 코드 포인트 기준 레벤슈타인 거리. 두 행만 들고 돌아 입력 길이에 선형인 메모리를 쓴다. */
function levenshtein(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_unused, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const deletion = (previous[j] as number) + 1;
      const insertion = (current[j - 1] as number) + 1;
      current[j] = Math.min(substitution, deletion, insertion);
    }
    previous = current;
  }
  return previous[b.length] as number;
}

/**
 * 오타 후보를 하나만 고른다. 설계 §5.4 의 6 단계 규칙이다.
 * 길이 절반 조건이 없으면 'id' 와 'at' 같은 짧은 이름이 서로 후보가 되고,
 * 동점 처리가 없으면 Object.keys 순서에 결과가 달라져 결정론이 깨진다.
 */
function suggestName(target: string, candidates: readonly string[]): string | undefined {
  let best: { name: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const distance = levenshtein(target, candidate);
    const longer = Math.max(Array.from(target).length, Array.from(candidate).length);
    if (distance > 2 || distance > Math.floor(longer / 2)) continue;
    if (
      best === undefined ||
      distance < best.distance ||
      (distance === best.distance && byCodeUnit(candidate, best.name) < 0)
    )
      best = { name: candidate, distance };
  }
  return best?.name;
}

/** suggestion 이 없으면 키 자체를 만들지 않는다. 소비자가 존재 여부로 분기한다. */
const withSuggestion = (finding: SpecFinding, suggestion: string | undefined): SpecFinding =>
  suggestion === undefined ? finding : { ...finding, suggestion };

/**
 * 선언한 type 과 enum 판정을 schema-match.ts 에 위임한다. 두 벌을 두면 null·배열 판정과
 * 깊은 비교가 갈라진다. 위임하면 type 위반 시 enum 을 보지 않는 단락 순서까지 그대로 따른다.
 */
function judgeField(field: NormalizedField, value: JsonValue): SpecFindingCode | null {
  const probe: ResponseSchema = {};
  if (field.type !== null) probe.type = field.type;
  if (field.enumValues !== null) probe.enum = [...field.enumValues];
  if (probe.type === undefined && probe.enum === undefined) return null;

  const violation = matchResponseSchema(probe, value).violations[0];
  if (violation === undefined) return null;
  return violation.code === "TYPE_MISMATCH" ? "TYPE_MISMATCH" : "ENUM_MISMATCH";
}

/**
 * 명세의 callTool 입력을 서버가 선언한 inputSchema와 대조한다. 서버를 호출하지 않는다.
 * 해석하지 못하는 스키마는 SCHEMA_NOT_ANALYZABLE 하나만 내고 그 툴의 다른 검사를 전부 건너뛴다.
 *
 * 판정이 애매하면 finding 을 내지 않는다. 이 결과가 승인 차단 근거로 쓰이므로 오탐 1 건이
 * 미탐 1 건보다 비싸다(ADR-0015).
 */
export function checkInputContract(options: InputContractOptions): SpecFindingsResult {
  const { suite, tools } = options;

  // 이름으로만 조회한다. 배열 순서를 쓰지 않아야 tools 순서가 결과를 바꾸지 않는다.
  const declaredTools = new Map<string, ToolDef>();
  for (const tool of tools) if (!declaredTools.has(tool.name)) declaredTools.set(tool.name, tool);
  const toolNames = [...declaredTools.keys()].sort(byCodeUnit);
  /** 같은 툴을 여러 케이스가 쓰므로 정규화를 한 번만 한다. null 도 캐시한다. */
  const normalized = new Map<string, NormalizedInputSchema | null>();
  const normalizeOnce = (tool: ToolDef): NormalizedInputSchema | null => {
    if (!normalized.has(tool.name))
      normalized.set(tool.name, normalizeInputSchema(tool.inputSchema));
    return normalized.get(tool.name) ?? null;
  };

  const findings: SpecFinding[] = [];
  let totalFindings = 0;

  for (const testCase of suite.cases) {
    // listTools 는 입력이 없어서 대조할 계약이 없다.
    if (testCase.operation.type !== "callTool") continue;
    const caseId = testCase.id;
    const toolName = testCase.operation.tool;
    const caseFindings: SpecFinding[] = [];

    const tool = declaredTools.get(toolName);
    if (tool === undefined) {
      caseFindings.push(
        withSuggestion(
          {
            code: "TOOL_NOT_DECLARED",
            severity: "blocking",
            caseId,
            path: "operation.tool",
            actual: toolName,
          },
          suggestName(toolName, toolNames),
        ),
      );
    } else {
      const schema = normalizeOnce(tool);
      if (schema === null) {
        caseFindings.push({
          code: "SCHEMA_NOT_ANALYZABLE",
          severity: "advisory",
          caseId,
          path: "operation.tool",
          actual: toolName,
        });
      } else {
        const input = testCase.operation.input;
        // 입력이 객체가 아니면 대조할 키가 없다. validateMcpSuite 가 형식을 따로 잡는다.
        if (plainObject(input)) {
          const inputKeys = Object.keys(input).sort(byCodeUnit);
          const undeclaredKeys = inputKeys.filter((key) => !schema.fields.has(key));
          const declaredNames = [...schema.fields.keys()];

          for (const name of schema.required) {
            if (Object.hasOwn(input, name)) continue;
            caseFindings.push(
              withSuggestion(
                {
                  code: "REQUIRED_MISSING",
                  severity: "blocking",
                  caseId,
                  path: `input.${name}`,
                  expected: name,
                },
                suggestName(name, undeclaredKeys),
              ),
            );
          }

          // JSON Schema 의 기본값이 "허용" 이라 정확히 false 일 때만 본다. 반대로 잡으면 오탐이 쏟아진다.
          if (schema.rejectsUndeclared)
            for (const key of undeclaredKeys)
              caseFindings.push(
                withSuggestion(
                  {
                    code: "UNDECLARED_FIELD",
                    severity: "blocking",
                    caseId,
                    path: `input.${key}`,
                    actual: key,
                  },
                  suggestName(
                    key,
                    declaredNames.filter((name) => !Object.hasOwn(input, name)),
                  ),
                ),
              );

          for (const key of inputKeys) {
            const field = schema.fields.get(key);
            if (field === undefined) continue;
            const value = input[key] as JsonValue;
            const code = judgeField(field, value);
            if (code === "TYPE_MISMATCH")
              caseFindings.push({
                code,
                severity: "blocking",
                caseId,
                path: `input.${key}`,
                expected: field.type,
                actual: typeName(value),
              });
            else if (code === "ENUM_MISMATCH") {
              const allowed = field.enumValues ?? [];
              caseFindings.push(
                withSuggestion(
                  {
                    code,
                    severity: "blocking",
                    caseId,
                    path: `input.${key}`,
                    expected: [...allowed],
                    actual: value,
                  },
                  typeof value === "string"
                    ? suggestName(
                        value,
                        allowed.filter((item): item is string => typeof item === "string"),
                      )
                    : undefined,
                ),
              );
            }
          }
        }
      }
    }

    caseFindings.sort(
      (left, right) =>
        (CODE_ORDER[left.code] ?? 0) - (CODE_ORDER[right.code] ?? 0) ||
        byCodeUnit(left.path, right.path),
    );
    totalFindings += caseFindings.length;
    // 상한을 넘으면 목록에서 자르되 총합은 자르기 전 개수로 센다.
    findings.push(...caseFindings.slice(0, MAX_FINDINGS_PER_CASE));
  }

  return { findings, totalFindings };
}
