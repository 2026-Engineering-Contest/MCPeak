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
