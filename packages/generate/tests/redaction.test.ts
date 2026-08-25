import { REDACTED } from "@mcpeak/runner";
import { describe, expect, it } from "vitest";
import { sanitizeRedactable } from "../src/redaction.js";

/**
 * runner 가 ADR-0082 로 민감 키 판정을 접미 단어열 규칙(ADR-0039·0045)으로 맞췄다. generate 가
 * 같은 목록을 가져다 정확 일치로 판정하면 같은 응답이 실패 메시지에서는 가려지고 provider 로
 * 나가는 요청에서는 원문이다(#368). 판정은 runner 의 `isSensitiveKey` 한 벌이어야 한다.
 */
describe("sanitizeRedactable 의 민감 키 판정", () => {
  const mask = (key: string) =>
    (sanitizeRedactable({ [key]: "v" }) as Record<string, unknown>)[key] === REDACTED;

  it("접미 단어열이 목록과 일치하는 합성 키를 가린다", () => {
    expect(mask("sessionToken")).toBe(true);
    expect(mask("X-Api-Key")).toBe(true);
    expect(mask("privateKey")).toBe(true);
  });

  it("복수형을 가린다", () => {
    expect(mask("tokens")).toBe(true);
    expect(mask("cookies")).toBe(true);
  });

  it("머리 명사가 다르면 통과시킨다", () => {
    expect(mask("tokenCount")).toBe(false);
    expect(mask("passwordPolicy")).toBe(false);
    expect(mask("cacheKey")).toBe(false);
  });

  it("sensitiveKeys 로 넘긴 이름도 같은 규칙으로 판정한다", () => {
    const value = sanitizeRedactable(
      { tenantId: "t", tenantIdCount: 3, legacyTenantId: "l" },
      { sensitiveKeys: ["tenantId"] },
    );
    expect(value).toEqual({ tenantId: REDACTED, tenantIdCount: 3, legacyTenantId: REDACTED });
  });
});
