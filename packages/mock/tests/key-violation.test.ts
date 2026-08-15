import { describe, expect, it } from "vitest";
import { assertKeyable, findKeyViolation, MAX_KEY_DEPTH } from "../src/key-violation.js";

/** 깊이 n 짜리 중첩 객체를 만든다. 루트가 깊이 0. */
function nest(depth: number): unknown {
  let value: unknown = null;
  for (let i = 0; i < depth; i++) value = { a: value };
  return value;
}

describe("findKeyViolation — 통과하는 값", () => {
  it.each([
    ["빈 객체", {}],
    ["원시값만", { a: 1, b: "x", c: true, d: null }],
    ["중첩 객체", { a: { b: { c: 1 } } }],
    ["배열", { items: [1, "x", null, { a: 1 }] }],
    ["undefined 프로퍼티", { a: 1, b: undefined }],
    ["배열 안 undefined", { items: [1, undefined, 3] }],
    [
      "같은 객체를 두 번 참조 (순환 아님)",
      (() => {
        const s = { x: 1 };
        return { a: s, b: s };
      })(),
    ],
  ])("%s", (_name, value) => {
    expect(findKeyViolation(value)).toBeUndefined();
  });
});

describe("findKeyViolation — 거부하는 값", () => {
  it.each([
    ["루트의 NaN", { n: NaN }, { kind: "nonFinite", path: "args.n", found: "NaN" }],
    [
      "중첩된 Infinity",
      { a: { b: Infinity } },
      { kind: "nonFinite", path: "args.a.b", found: "Infinity" },
    ],
    [
      "배열 안 NaN",
      { items: [1, NaN] },
      { kind: "nonFinite", path: "args.items[1]", found: "NaN" },
    ],
    ["Date", { when: new Date(0) }, { kind: "notJson", path: "args.when", found: "Date" }],
    ["함수", { f: () => {} }, { kind: "notJson", path: "args.f", found: "function" }],
    ["Map", { m: new Map() }, { kind: "notJson", path: "args.m", found: "Map" }],
  ])("%s", (_name, value, expected) => {
    expect(findKeyViolation(value)).toEqual(expected);
  });

  it("희소 배열", () => {
    // biome-ignore lint/suspicious/noSparseArray: 희소 배열 판정을 테스트하려면 빈 슬롯이 필요하다.
    expect(findKeyViolation({ items: [1, , 3] })).toEqual({
      kind: "sparse",
      path: "args.items[1]",
    });
  });

  it("순환 참조", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(findKeyViolation(circular)).toEqual({ kind: "circular", path: "args.self" });
  });

  it("상한을 넘는 깊이", () => {
    const violation = findKeyViolation(nest(MAX_KEY_DEPTH + 2));
    expect(violation).toEqual({ kind: "tooDeep", depth: MAX_KEY_DEPTH + 1 });
  });

  it("상한과 같은 깊이는 통과한다", () => {
    expect(findKeyViolation(nest(MAX_KEY_DEPTH))).toBeUndefined();
  });
});

describe("assertKeyable — 문장 전문", () => {
  const source = "mock.on('add', ...)";

  it("순환 참조", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => assertKeyable(circular, source)).toThrow(
      [
        "→ mock.on('add', ...) 의 인자로 매칭 키를 만들 수 없습니다: 순환 참조",
        "→ 위치: args.self",
        "→ JSON 에는 순환 참조가 없어서 이 주입은 어떤 호출과도 맞지 않습니다. 참조를 끊고 값을 펼쳐 넘기세요.",
      ].join("\n"),
    );
  });

  it("희소 배열", () => {
    // biome-ignore lint/suspicious/noSparseArray: 희소 배열 판정을 테스트하려면 빈 슬롯이 필요하다.
    expect(() => assertKeyable({ items: [1, , 3] }, source)).toThrow(
      [
        "→ mock.on('add', ...) 의 인자로 매칭 키를 만들 수 없습니다: 희소 배열",
        "→ 위치: args.items[1] — 비어 있는 자리",
        "→ 와이어를 건너오면 빈 자리가 null 로 채워집니다. 빈 자리에 null 을 명시하세요.",
      ].join("\n"),
    );
  });

  it("유한하지 않은 수", () => {
    expect(() => assertKeyable({ n: NaN }, source)).toThrow(
      [
        "→ mock.on('add', ...) 의 인자로 매칭 키를 만들 수 없습니다: 유한하지 않은 수",
        "→ 위치: args.n — 발견: NaN",
        "→ JSON 에는 NaN · Infinity 가 없습니다. 유한한 수를 쓰거나 그 상태를 나타내는 문자열을 쓰세요.",
      ].join("\n"),
    );
  });

  it("JSON 으로 표현할 수 없는 값", () => {
    expect(() => assertKeyable({ when: new Date(0) }, source)).toThrow(
      [
        "→ mock.on('add', ...) 의 인자로 매칭 키를 만들 수 없습니다: JSON 으로 표현할 수 없는 값",
        "→ 위치: args.when — 발견: Date",
        "→ 매칭 키가 되는 것은 객체 · 배열 · 문자열 · 유한한 수 · 불리언 · null 뿐입니다. 직렬화한 값으로 바꿔 넘기세요 (예: Date → toISOString()).",
      ].join("\n"),
    );
  });

  it("너무 깊은 중첩", () => {
    expect(() => assertKeyable(nest(MAX_KEY_DEPTH + 2), source)).toThrow(
      [
        "→ mock.on('add', ...) 의 인자로 매칭 키를 만들 수 없습니다: 중첩이 너무 깊습니다",
        `→ 위치: 깊이 ${MAX_KEY_DEPTH + 1} — 상한: ${MAX_KEY_DEPTH}`,
        "→ 목에 넘기는 인자는 테스트가 읽을 수 있는 크기여야 합니다. 필요한 필드만 넘기세요.",
      ].join("\n"),
    );
  });

  it("정의 파일 경로는 진입점 표기만 바뀐다", () => {
    expect(() => assertKeyable({ n: NaN }, "정의 파일의 responses[0]")).toThrow(
      "→ 정의 파일의 responses[0] 의 인자로 매칭 키를 만들 수 없습니다: 유한하지 않은 수",
    );
  });

  it("문제가 없으면 던지지 않는다", () => {
    expect(() => assertKeyable({ a: 1, b: undefined }, source)).not.toThrow();
  });
});
