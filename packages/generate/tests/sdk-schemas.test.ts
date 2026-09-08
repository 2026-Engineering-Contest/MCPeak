import { readFileSync } from "node:fs";
import type { ToolDef } from "@mcpeak/core";
import { describe, expect, it } from "vitest";
import { createBaselineSuite } from "../src/index.js";
import type { JsonObject } from "../src/schema.js";

/**
 * 실측 SDK 스키마 회귀 고정(설계 §1.2, §8).
 *
 * fixture 는 2026-09-08 에 실제 SDK 에서 뽑은 것을 그대로 둔다. 손으로 다듬으면 실측 회귀가
 * 아니라 우리가 통과시키기 좋은 모양을 검사하는 것이 된다. 기대 입력이 어긋나면 fixture 나
 * 기대값이 아니라 구현을 의심한다.
 */
interface SdkFixture {
  readonly source: string;
  readonly supported: readonly ToolDef[];
  readonly unsupported: readonly (ToolDef & { readonly expectedPath: string })[];
}

const load = (name: string): SdkFixture =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/sdk-schemas/${name}.json`, import.meta.url), "utf8"),
  ) as SdkFixture;

const zod = load("zod-4.4.3-sdk-1.30.0");
const pydantic = load("pydantic-2");

/** 정상 툴 하나. 전 툴이 미지원이면 baseline 이 통째로 던지므로 앞에 붙일 대조군이다. */
const plain = zod.supported.find((item) => item.name === "plain") as ToolDef;

const successInputs = (tools: readonly ToolDef[]): Record<string, unknown> => {
  const result = createBaselineSuite(tools, { suiteId: "s", suiteName: "s" });
  expect(result.skippedTools).toEqual([]);
  const inputs: Record<string, unknown> = {};
  for (const item of result.suite.cases) {
    if (!item.id.endsWith("-success") || item.operation.type !== "callTool") continue;
    inputs[item.operation.tool] = item.operation.input as JsonObject;
  }
  return inputs;
};

describe(zod.source, () => {
  it("supported 툴은 하나도 건너뛰지 않는다", () => {
    expect(
      createBaselineSuite(zod.supported, { suiteId: "s", suiteName: "s" }).skippedTools,
    ).toEqual([]);
  });

  it("정상 케이스 입력이 고정값이다", () => {
    expect(successInputs(zod.supported)).toEqual({
      shapes: {
        id: "00000000-0000-4000-8000-000000000000",
        when: "2000-01-01T00:00:00Z",
        slug: "a",
        note: "example",
        kind: "a",
        n: 1,
        who: { name: "example" },
        list: ["example"],
        either: "example",
        lit: "x",
      },
      rec: { root: { v: "example" } },
      plain: { x: "example" },
      strictroot: { x: "example" },
      // 임의 키 맵은 빈 객체다. 필수 키가 없어 만들 것이 없다(ADR-0087). 이 값이 박혀 있어야
      // 나중에 "임의 키를 하나 만들어 넣자" 로 바꿀 때 여기서 걸린다.
      record: { rec: {} },
      more: {
        s: "aaa",
        nn: 0,
        en: "x",
        du: { k: "a", a: "example" },
        pos: 1,
        inner: { q: "example" },
        email: "user@example.com",
        url: "https://example.com",
        arr: [{ v: 0 }],
      },
    });
  });

  it.each(zod.unsupported.map((item) => [item.name, item] as const))(
    "unsupported 툴 %s 는 expectedPath 로 건너뛴다",
    (_name, item) => {
      const result = createBaselineSuite(
        [plain, { name: item.name, inputSchema: item.inputSchema }],
        {
          suiteId: "s",
          suiteName: "s",
        },
      );
      expect(result.skippedTools[0]?.path).toBe(item.expectedPath.replace("tools[0]", "tools[1]"));
    },
  );

  it("두 번 만든 baselineFingerprint 가 같다", () => {
    const once = createBaselineSuite(zod.supported, { suiteId: "s", suiteName: "s" });
    const twice = createBaselineSuite(zod.supported, { suiteId: "s", suiteName: "s" });
    expect(once.suiteFingerprint).toBe(twice.suiteFingerprint);
  });
});

describe(pydantic.source, () => {
  it("supported 툴은 하나도 건너뛰지 않는다", () => {
    expect(
      createBaselineSuite(pydantic.supported, { suiteId: "s", suiteName: "s" }).skippedTools,
    ).toEqual([]);
  });

  it("정상 케이스 입력이 고정값이다", () => {
    expect(successInputs(pydantic.supported)).toEqual({
      args: {
        id: "a",
        kind: "a",
        who: { name: "example" },
        items: [{ name: "example" }],
        n: 1,
      },
    });
  });

  it("두 번 만든 baselineFingerprint 가 같다", () => {
    const once = createBaselineSuite(pydantic.supported, { suiteId: "s", suiteName: "s" });
    const twice = createBaselineSuite(pydantic.supported, { suiteId: "s", suiteName: "s" });
    expect(once.suiteFingerprint).toBe(twice.suiteFingerprint);
  });
});
