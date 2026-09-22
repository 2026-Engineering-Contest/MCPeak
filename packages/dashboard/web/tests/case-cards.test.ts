import { describe, expect, it } from "vitest";
import type { RelayCase, RelayEvent, RelayEventInput } from "../../src/api-types.js";
import { toCaseCards } from "../src/relay/case-cards.js";

const CASES: readonly RelayCase[] = [
  { id: "get-weather-success", tag: "c1", tool: "get_weather", input: { city: "서울" } },
  { id: "add-missing-a", tag: "c2", tool: "add", input: { b: 2 } },
];

const withIds = (inputs: readonly RelayEventInput[]): readonly RelayEvent[] =>
  inputs.map((event, index) => ({ ...event, id: index + 1 }) as RelayEvent);

describe("케이스 칸", () => {
  it("이벤트가 없으면 전부 기다리는 중이다", () => {
    expect(toCaseCards(CASES, []).map((card) => card.status)).toEqual(["waiting", "waiting"]);
  });

  it("칸 순서는 케이스 순서 그대로다", () => {
    expect(toCaseCards(CASES, []).map((card) => card.id)).toEqual([
      "get-weather-success",
      "add-missing-a",
    ]);
  });

  it("꼬리표로 줄을 갈라 제 칸에 넣는다", () => {
    const cards = toCaseCards(
      CASES,
      withIds([
        { kind: "call", case: "c2", method: "tools/call", tool: "add", args: { b: 2 } },
        {
          kind: "call",
          case: "c1",
          method: "tools/call",
          tool: "get_weather",
          args: { city: "서울" },
        },
        {
          kind: "result",
          case: "c1",
          tool: "get_weather",
          ok: true,
          bytes: 97,
          ms: 2,
          body: { t: 21 },
        },
      ]),
    );
    // `toStrictEqual` 이어야 한다. `toEqual` 은 `{code: undefined}` 를 `{}` 와 같다고 보므로,
    // 구현이 없는 필드를 `undefined` 로 싣도록 바뀌어도 통과한다 — 계약이 "필드 자체가
    // 없다" 인 자리에서는 그 관대함이 회귀를 덮는다(`relay-lines.test.ts` 가 먼저 배운 것).
    expect(cards[0]?.results).toStrictEqual([{ ok: true, bytes: 97, ms: 2, body: { t: 21 } }]);
    expect(cards[1]?.results).toStrictEqual([]);
    expect(cards[1]?.calls).toStrictEqual([{ tool: "add", args: { b: 2 } }]);
  });

  it("툴을 안 부른 채 AI 가 끝나면 「호출 없음」이다", () => {
    // 권한에 막히면 종료 코드 0 으로 끝나면서 tools/call 이 한 건도 없다(설계 §3).
    const cards = toCaseCards(
      CASES,
      withIds([{ kind: "aiDone", case: "get-weather-success", ok: true }]),
    );
    expect(cards[0]?.status).toBe("noCall");
    expect(cards[1]?.status).toBe("waiting");
  });

  it("AI 가 끝나기 전에는 호출이 없어도 기다리는 중이다", () => {
    expect(toCaseCards(CASES, []).at(0)?.status).toBe("waiting");
  });

  it("툴 오류와 프로토콜 오류를 가른다", () => {
    const cards = toCaseCards(
      CASES,
      withIds([
        { kind: "call", case: "c1", method: "tools/call", tool: "get_weather" },
        { kind: "result", case: "c1", ok: false, bytes: 40, ms: 1, body: { isError: true } },
        { kind: "call", case: "c2", method: "tools/call", tool: "add" },
        { kind: "result", case: "c2", ok: false, code: -32602, message: "bad" },
      ]),
    );
    expect(cards[0]?.status).toBe("toolError");
    expect(cards[1]?.status).toBe("protocolError");
  });

  it("initialize·tools/list 는 칸의 상태를 바꾸지 않는다", () => {
    // 툴 호출이 아닌 왕복까지 「불렀다」로 세면 「호출 없음」 칸이 영영 안 뜬다.
    const cards = toCaseCards(
      CASES,
      withIds([
        { kind: "call", case: "c1", method: "initialize" },
        { kind: "result", case: "c1", ok: true, bytes: 125, ms: 4, body: {} },
        { kind: "aiDone", case: "get-weather-success", ok: true },
      ]),
    );
    expect(cards[0]?.status).toBe("noCall");
  });

  it("꼬리표 없는 줄은 어느 칸에도 안 들어간다", () => {
    const cards = toCaseCards(
      CASES,
      withIds([{ kind: "call", method: "tools/call", tool: "get_weather" }]),
    );
    expect(cards.flatMap((card) => card.calls)).toStrictEqual([]);
  });
});
