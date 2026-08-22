import { describe, expect, it } from "vitest";
import {
  keyWords,
  LATEST_SENSITIVE_KEYS_VERSION,
  sensitiveKeyIn,
  sensitiveKeysOf,
} from "../../src/shared/sensitive-keys.mjs";

const latest = sensitiveKeysOf(LATEST_SENSITIVE_KEYS_VERSION);
const isSensitive = (key: string) => sensitiveKeyIn(latest, key);

describe("민감 키 판정", () => {
  it("접미 단어열이 정확히 일치할 때만 걸린다", () => {
    expect(isSensitive("accessToken")).toBe(true);
    expect(isSensitive("X-Api-Key")).toBe(true);
    expect(isSensitive("user_password")).toBe(true);

    // 머리 명사가 다르면 통과한다. 과잉 마스킹은 그 필드를 테스트가 영영 못 보게 만든다.
    expect(isSensitive("tokenCount")).toBe(false);
    expect(isSensitive("passwordPolicy")).toBe(false);
    expect(isSensitive("secretariat")).toBe(false);
  });

  it("복수형을 흡수하되 머리 명사는 건드리지 않는다", () => {
    expect(isSensitive("tokens")).toBe(true);
    expect(isSensitive("apiKeys")).toBe(true);
    expect(isSensitive("tokenCounts")).toBe(false);
  });

  it("`key` 단독은 민감이 아니다 — 합성어만 목록에 있다", () => {
    expect(isSensitive("key")).toBe(false);
    expect(isSensitive("apikey")).toBe(true);
    expect(isSensitive("privateKey")).toBe(true);
  });

  it("꼬리 숫자를 떼고 본다", () => {
    expect(isSensitive("apiKey0")).toBe(true);
    expect(isSensitive("cookieCount2")).toBe(false);
  });

  it("구분자와 카멜케이스 경계를 함께 쪼갠다", () => {
    expect(keyWords("APIKey")).toEqual(["api", "key"]);
    expect(keyWords("access_token")).toEqual(["access", "token"]);
    expect(keyWords("X-Api-Key")).toEqual(["x", "api", "key"]);
  });
});

describe("version 스냅샷", () => {
  it("모르는 version은 조용히 최신으로 넘어가지 않고 던진다", () => {
    // 조용히 최신을 주면 옛 세션을 새 규칙으로 읽어 matchKey 가 어긋난다.
    const unknown = LATEST_SENSITIVE_KEYS_VERSION + 1;
    expect(() => sensitiveKeysOf(unknown)).toThrow(new RegExp(`version ${unknown}`));
  });

  it("스냅샷은 얼어 있다 — 목록을 고치면 이미 나간 세션의 matchKey가 바뀐다", () => {
    expect(Object.isFrozen(sensitiveKeysOf(1))).toBe(true);
    expect(() => {
      (sensitiveKeysOf(1) as string[]).push("newword");
    }).toThrow();
  });

  it("version 1 스냅샷의 내용이 고정돼 있다", () => {
    // 이 배열이 바뀌면 이미 저장된 External 세션이 전부 miss 가 된다. 단어를 추가하려면
    // version 2 스냅샷을 새로 만들어야 하며, 이 단언이 그 경계를 지킨다.
    expect([...sensitiveKeysOf(1)]).toEqual([
      "authorization",
      "apikey",
      "accesstoken",
      "refreshtoken",
      "token",
      "secret",
      "password",
      "cookie",
      "privatekey",
      "secretkey",
      "signingkey",
      "sessionkey",
      "credential",
      "passwd",
    ]);
  });
});

describe("legacy와 external이 같은 구현을 쓴다", () => {
  it("external runtime의 sensitiveKey가 shared와 같은 답을 준다", async () => {
    const { sensitiveKey } = await import("../../src/external/runtime.mjs");
    const probes = [
      "accessToken",
      "tokenCount",
      "X-Api-Key",
      "key",
      "secretariat",
      "apiKeys",
      "cookieCount2",
      "passwd",
    ];

    for (const probe of probes) {
      expect([probe, sensitiveKey(probe)]).toEqual([probe, isSensitive(probe)]);
    }
  });
});
