import { describe, expect, it } from "vitest";
import { DIAGNOSIS_PROVIDER_SCHEMA, MAX_CAUSE_CHARS } from "../src/diagnosis-schema.js";

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
