import { MCP_SUITE_JSON_SCHEMA } from "@ohmymcp/runner";

const runner = structuredClone(MCP_SUITE_JSON_SCHEMA) as Record<string, unknown>;
const runnerDefs = runner.$defs;
delete runner.$defs;
delete runner.$id;
delete runner.$schema;
const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
};

/** Provider envelope schema. The runner schema is cloned, never extended in place. */
export const AUTHORING_OUTPUT_SCHEMA = freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["status"],
  properties: {
    status: { enum: ["candidate", "questions"] },
    suite: { $ref: "#/$defs/suite" },
    summary: { type: "string" },
    warnings: { type: "array" },
    questions: { type: "array", items: { type: "string", minLength: 1 } },
  },
  oneOf: [
    {
      required: ["status", "suite", "summary", "warnings", "questions"],
      properties: { status: { const: "candidate" } },
    },
    {
      required: ["status", "questions"],
      properties: { status: { const: "questions" } },
      not: {
        anyOf: [{ required: ["suite"] }, { required: ["summary"] }, { required: ["warnings"] }],
      },
    },
  ],
  $defs: { ...(runnerDefs as Record<string, unknown>), suite: runner },
});

/**
 * provider(Codex/Claude) 전송 전용 스키마.
 * 두 CLI 공통 지원 범위만 사용한다: $schema / $id / $ref / $defs / 최상위 oneOf·allOf·anyOf·not 없음,
 * 재귀 없음, nullable 없음. 문자열 제약은 pattern만 쓴다(minLength/minItems는 CLI별 지원이 불확실).
 * suite는 객체가 아니라 JSON 문자열로 받는다. 근거는 docs/adr/0007-provider-전송-스키마-분리.md.
 */
export const PROVIDER_OUTPUT_SCHEMA = freeze({
  type: "object",
  additionalProperties: false,
  required: ["status", "suiteJson", "summary", "warnings", "questions"],
  properties: {
    status: { enum: ["candidate", "questions"] },
    // status가 "questions"이면 빈 문자열, "candidate"이면 TestSuiteSpec의 JSON 직렬화.
    suiteJson: { type: "string" },
    // status가 "questions"이면 빈 문자열.
    summary: { type: "string" },
    warnings: { type: "array", items: { type: "string" } },
    questions: { type: "array", items: { type: "string", pattern: "\\S" } },
  },
});
