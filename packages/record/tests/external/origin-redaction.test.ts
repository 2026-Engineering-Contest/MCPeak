import { describe, expect, it } from "vitest";
import {
  REDACTED_ARG,
  redactOrigin,
  redactOriginArgs,
} from "../../src/external/origin-redaction.js";

/**
 * 설계 §7.3 의 표를 그대로 옮긴 것이다. 규칙(R1~R4)마다 한 줄 이상 있고, 통과해야 하는
 * 입력도 함께 있다. 과잉 마스킹은 값을 지우므로 통과 케이스가 마스킹 케이스만큼 중요하다.
 *
 * 여기 쓰는 값은 전부 **모양만 흉내 낸 가짜**다. 실제 비밀값을 넣지 않는다.
 */
const cases: readonly (readonly [string, readonly string[], readonly string[]])[] = [
  // R2. 이름이 민감 키면 다음 토큰을 가린다.
  [
    "R2: 민감 플래그 다음 토큰",
    ["--access-token", "sbp_0123456789abcdef0123"],
    ["--access-token", "[redacted]"],
  ],
  // R1. `--flag=value` 는 `=` 뒤만 가린다.
  ["R1: 붙여 쓴 값", ["--access-token=sbp_0123456789abcdef0123"], ["--access-token=[redacted]"]],
  // 이름으로 판정하므로 값이 짧아도 가린다.
  ["R2: 짧은 값도 이름으로 가린다", ["--api-key", "x"], ["--api-key", "[redacted]"]],
  // R2 는 다음 토큰을 무조건 가린다. 규칙을 바꾸면 이 케이스를 바꾼다.
  ["R2: 다음 토큰이 플래그여도 가린다", ["--token", "--verbose"], ["--token", "[redacted]"]],
  ["통과: 민감 키가 아닌 플래그", ["--project-ref", "nyyf"], ["--project-ref", "nyyf"]],
  ["통과: 값 없는 스위치", ["--read-only"], ["--read-only"]],
  [
    "통과: 짧은 플래그와 패키지 지정자",
    ["-y", "@supabase/mcp-server-supabase@0.12.0"],
    ["-y", "@supabase/mcp-server-supabase@0.12.0"],
  ],
  // R3. `NAME=value` 형태의 환경변수 래퍼.
  [
    "R3: 환경변수 래퍼",
    ["SUPABASE_ACCESS_TOKEN=sbp_x", "node", "s.mjs"],
    ["SUPABASE_ACCESS_TOKEN=[redacted]", "node", "s.mjs"],
  ],
  ["통과: 민감하지 않은 환경변수", ["PORT=3000"], ["PORT=3000"]],
  // R4. 이름이 없는 자리는 모양으로 본다.
  ["R4: 접두 + 최소 길이", ["sbp_0123456789abcdef0123"], ["[redacted]"]],
  ["통과: 접두는 맞지만 20자 미만", ["sbp_short"], ["sbp_short"]],
  ["R4: sk- 접두", ["sk-ant-api03-0123456789abcdef"], ["[redacted]"]],
  ["R4: JWT 모양", ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc"], ["[redacted]"]],
  ["R4: 서명이 빈 JWT", ["eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0."], ["[redacted]"]],
  ["통과: 접두를 닮은 일반 단어", ["skeleton-key-of-the-city"], ["skeleton-key-of-the-city"]],
  // ADR-0039 의 접미 단어열 규칙. 머리 명사가 다르면 통과한다.
  ["통과: tokenCount 는 개수다", ["--tokenCount", "5"], ["--tokenCount", "5"]],
  [
    "통과: passwordPolicy 는 정책이다",
    ["--password-policy", "strict"],
    ["--password-policy", "strict"],
  ],
  ["통과: stdin 관례 토큰", ["-"], ["-"]],
  ["통과: 빈 배열", [], []],
];

describe("redactOriginArgs", () => {
  it.each(cases)("%s", (_label, input, expected) => {
    expect(redactOriginArgs(input)).toEqual(expected);
  });

  it("반환값은 frozen 이다", () => {
    expect(Object.isFrozen(redactOriginArgs(["--read-only"]))).toBe(true);
  });

  it("입력 배열을 고치지 않는다", () => {
    const input = ["--access-token", "sbp_0123456789abcdef0123"];
    redactOriginArgs(input);
    expect(input).toEqual(["--access-token", "sbp_0123456789abcdef0123"]);
  });

  it("자리표시 문자열은 runtime.mjs 의 것과 같다", () => {
    expect(REDACTED_ARG).toBe("[redacted]");
  });
});

describe("redactOrigin", () => {
  it("args 만 가리고 command 와 suitePath 는 그대로 둔다", () => {
    expect(
      redactOrigin({
        command: "npx",
        args: ["-y", "@scope/server", "--access-token", "sbp_0123456789abcdef0123"],
        suitePath: "examples/weather.suite.json",
      }),
    ).toEqual({
      command: "npx",
      args: ["-y", "@scope/server", "--access-token", "[redacted]"],
      suitePath: "examples/weather.suite.json",
    });
  });

  it("반환값은 frozen 이다", () => {
    const origin = redactOrigin({ command: "node", args: ["s.mjs"], suitePath: "a.suite.json" });
    expect(Object.isFrozen(origin)).toBe(true);
    expect(Object.isFrozen(origin.args)).toBe(true);
  });
});
