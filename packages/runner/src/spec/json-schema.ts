import type { ReadonlyJsonObject, ReadonlyJsonValue } from "./types.js";

const freeze = <T extends ReadonlyJsonValue>(value: T): T => {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

export const MCP_SUITE_JSON_SCHEMA: ReadonlyJsonObject = freeze<ReadonlyJsonObject>({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://ohmymcp.dev/schemas/test-suite/v1.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "id", "name", "cases"],
  properties: {
    schemaVersion: { const: 1 },
    id: { $ref: "#/$defs/nonEmptyString" },
    name: { $ref: "#/$defs/nonEmptyString" },
    defaultTimeoutMs: { $ref: "#/$defs/timeoutMs" },
    cases: {
      type: "array",
      minItems: 1,
      items: { oneOf: [{ $ref: "#/$defs/listToolsCase" }, { $ref: "#/$defs/callToolCase" }] },
    },
  },
  $defs: {
    nonEmptyString: { type: "string", minLength: 1, pattern: "\\S" },
    timeoutMs: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
    jsonValue: {
      oneOf: [
        { type: "null" },
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "array", items: { $ref: "#/$defs/jsonValue" } },
        { type: "object", additionalProperties: { $ref: "#/$defs/jsonValue" } },
      ],
    },
    toolExistsAssertion: {
      type: "object",
      additionalProperties: false,
      required: ["type", "tool"],
      properties: { type: { const: "toolExists" }, tool: { $ref: "#/$defs/nonEmptyString" } },
    },
    isErrorAssertion: {
      type: "object",
      additionalProperties: false,
      required: ["type", "expected"],
      properties: { type: { const: "isError" }, expected: { type: "boolean" } },
    },
    listToolsCase: {
      type: "object",
      additionalProperties: false,
      required: ["id", "name", "operation", "assertions"],
      properties: {
        id: { $ref: "#/$defs/nonEmptyString" },
        name: { $ref: "#/$defs/nonEmptyString" },
        timeoutMs: { $ref: "#/$defs/timeoutMs" },
        operation: {
          type: "object",
          additionalProperties: false,
          required: ["type"],
          properties: { type: { const: "listTools" } },
        },
        assertions: { type: "array", minItems: 1, items: { $ref: "#/$defs/toolExistsAssertion" } },
      },
    },
    callToolCase: {
      type: "object",
      additionalProperties: false,
      required: ["id", "name", "operation", "assertions"],
      properties: {
        id: { $ref: "#/$defs/nonEmptyString" },
        name: { $ref: "#/$defs/nonEmptyString" },
        timeoutMs: { $ref: "#/$defs/timeoutMs" },
        operation: {
          type: "object",
          additionalProperties: false,
          required: ["type", "tool", "input"],
          properties: {
            type: { const: "callTool" },
            tool: { $ref: "#/$defs/nonEmptyString" },
            input: { type: "object", additionalProperties: { $ref: "#/$defs/jsonValue" } },
          },
        },
        assertions: { type: "array", minItems: 1, items: { $ref: "#/$defs/isErrorAssertion" } },
      },
    },
  },
});
