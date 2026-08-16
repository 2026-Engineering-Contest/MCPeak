import { describe, expect, it } from "vitest";
import {
  buildDiagnosisProviderSchema,
  DIAGNOSIS_PROVIDER_SCHEMA,
  type DiagnosisFailure,
  type DiagnosisRequest,
  diagnosisCaseIds,
  MAX_CAUSE_CHARS,
} from "../src/diagnosis-schema.js";

/** 스키마 전체를 깊이 우선으로 순회한다. 객체와 배열 원소를 모두 방문한다. */
function walk(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (value !== null && typeof value === "object") {
    visit(value as Record<string, unknown>);
    for (const item of Object.values(value)) walk(item, visit);
  }
}

describe("DIAGNOSIS_PROVIDER_SCHEMA", () => {
  it("DIAGNOSIS_PROVIDER_SCHEMA 는 최상위에 oneOf·anyOf·not 을 두지 않는다", () => {
    const keys = Object.keys(DIAGNOSIS_PROVIDER_SCHEMA);
    expect(keys).not.toContain("oneOf");
    expect(keys).not.toContain("anyOf");
    expect(keys).not.toContain("not");
  });

  it("DIAGNOSIS_PROVIDER_SCHEMA 는 minLength·minItems 를 쓰지 않는다", () => {
    const found: string[] = [];
    walk(DIAGNOSIS_PROVIDER_SCHEMA, (node) => {
      for (const key of ["minLength", "minItems"]) if (key in node) found.push(key);
    });
    expect(found).toEqual([]);
  });

  it("DIAGNOSIS_PROVIDER_SCHEMA 는 동결돼 있다", () => {
    expect(Object.isFrozen(DIAGNOSIS_PROVIDER_SCHEMA)).toBe(true);
    const unfrozen: unknown[] = [];
    walk(DIAGNOSIS_PROVIDER_SCHEMA, (node) => {
      if (!Object.isFrozen(node)) unfrozen.push(node);
    });
    expect(unfrozen).toEqual([]);
  });

  it("MAX_CAUSE_CHARS 는 500 이다", () => {
    expect(MAX_CAUSE_CHARS).toBe(500);
  });
});

const failure = (caseId: string): DiagnosisFailure => ({
  caseId,
  caseName: `케이스 ${caseId}`,
  tool: "get_weather",
  diagnostics: [{ code: "IS_ERROR_MISMATCH", message: "isError 가 다릅니다." }],
});

const request = (caseIds: readonly string[]): DiagnosisRequest => ({
  specApproved: true,
  suite: { id: "weather", name: "날씨" },
  failures: caseIds.map((id) => failure(id)),
  tools: [],
});

/** 요청별 스키마에서 caseId 제약만 꺼낸다. */
const caseIdSchema = (schema: unknown): Record<string, unknown> =>
  (
    (schema as { properties: { causes: { items: { properties: Record<string, unknown> } } } })
      .properties.causes.items.properties as Record<string, Record<string, unknown>>
  ).caseId as Record<string, unknown>;

describe("buildDiagnosisProviderSchema", () => {
  it("caseId enum 이 요청의 실패 caseId 와 같은 순서로 들어간다", () => {
    const schema = buildDiagnosisProviderSchema(request(["c-3", "c-1", "c-2"]));
    expect(caseIdSchema(schema).enum).toEqual(["c-3", "c-1", "c-2"]);
  });

  it("중복 caseId 는 enum 에 한 번만 들어간다", () => {
    const schema = buildDiagnosisProviderSchema(request(["c-1", "c-2", "c-1"]));
    expect(caseIdSchema(schema).enum).toEqual(["c-1", "c-2"]);
  });

  it("빈 문자열이나 공백뿐인 caseId 는 enum 에 안 들어간다", () => {
    const schema = buildDiagnosisProviderSchema(request(["", "   ", "c-1"]));
    expect(caseIdSchema(schema)).toEqual({ enum: ["c-1"] });
  });

  it("caseId 가 전부 공백이면 enum 대신 pattern 제약으로 돌아간다", () => {
    const schema = buildDiagnosisProviderSchema(request(["", " "]));
    expect(caseIdSchema(schema)).toEqual({ type: "string", pattern: "\\S" });
  });

  it("요청별 스키마도 최상위 oneOf·anyOf·not 을 두지 않는다", () => {
    const keys = Object.keys(buildDiagnosisProviderSchema(request(["c-1"])));
    for (const forbidden of ["oneOf", "anyOf", "not"]) expect(keys).not.toContain(forbidden);
  });

  it("요청별 스키마도 minLength·minItems 를 쓰지 않는다", () => {
    const found: string[] = [];
    walk(buildDiagnosisProviderSchema(request(["c-1", "c-2"])), (node) => {
      for (const key of ["minLength", "minItems"]) if (key in node) found.push(key);
    });
    expect(found).toEqual([]);
  });

  it("요청별 스키마가 동결돼 있다", () => {
    const schema = buildDiagnosisProviderSchema(request(["c-1"]));
    expect(Object.isFrozen(schema)).toBe(true);
    const unfrozen: unknown[] = [];
    walk(schema, (node) => {
      if (!Object.isFrozen(node)) unfrozen.push(node);
    });
    expect(unfrozen).toEqual([]);
  });

  it("같은 요청으로 두 번 만든 스키마가 동일하다", () => {
    const target = request(["c-1", "c-2"]);
    expect(JSON.stringify(buildDiagnosisProviderSchema(target))).toBe(
      JSON.stringify(buildDiagnosisProviderSchema(target)),
    );
  });

  it("실패가 없으면 caseId 를 빈 enum 으로 만들지 않는다", () => {
    // 빈 enum 은 어떤 값도 만족시킬 수 없다. 조립 단계가 이미 거르지만 여기서도 안 만든다.
    const schema = buildDiagnosisProviderSchema(request([]));
    expect(caseIdSchema(schema)).toEqual({ type: "string", pattern: "\\S" });
  });

  it("diagnosisCaseIds 가 스키마의 enum 과 같은 값을 낸다", () => {
    const target = request(["c-1", "c-1", "c-2"]);
    expect(diagnosisCaseIds(target)).toEqual(
      caseIdSchema(buildDiagnosisProviderSchema(target)).enum,
    );
  });
});
