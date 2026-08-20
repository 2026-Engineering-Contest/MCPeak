import type { McpClient, ToolResult } from "@mcpeak/core";
import { describe, expect, it } from "vitest";
import {
  type Cassette,
  type CassetteInteraction,
  cassetteClient,
  diffCassettes,
  droppedInteractionsMessage,
  matchKey,
} from "../src/index.js";

/**
 * `--record` 가 기존 녹화본을 말없이 지우던 문제의 회귀 스펙.
 *
 * 지우는 것 자체는 `--record` 의 의미라 막지 않는다. 이 스펙이 고정하는 것은 **지울 때
 * 알린다**는 것 하나다. 저장 내용은 경고 유무와 무관하게 같아야 한다.
 */

const ok = (raw: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(raw) }],
  isError: false,
  raw,
});

const interaction = (toolName: string, args: unknown, raw: unknown): CassetteInteraction => ({
  key: matchKey(toolName, args),
  request: { toolName, args },
  response: { content: [{ type: "text", text: JSON.stringify(raw) }], isError: false, raw },
});

const cassetteOf = (...interactions: CassetteInteraction[]): Cassette => ({
  version: 1,
  interactions,
});

function fakeClient(results: ToolResult[]): McpClient & { calls: { callTool: number } } {
  const calls = { callTool: 0 };
  return {
    calls,
    async listTools() {
      return [];
    },
    async callTool() {
      calls.callTool++;
      const result = results.shift();
      if (result === undefined) throw new Error("준비된 응답이 없습니다");
      return result;
    },
    async close() {},
  };
}

const SEOUL = interaction("get_weather", { city: "서울" }, { temp: 21 });
const BUSAN = interaction("get_weather", { city: "부산" }, { temp: 24 });
const JEJU = interaction("get_weather", { city: "제주" }, { temp: 26 });

describe("diffCassettes", () => {
  it("before 가 null 이면 사라지는 것이 없고 전부 added 다", () => {
    const report = diffCassettes(null, cassetteOf(SEOUL, BUSAN));

    expect(report.dropped).toStrictEqual([]);
    expect(report.kept).toBe(0);
    expect(report.added).toBe(2);
  });

  it("이번 실행에 없는 상호작용을 dropped 로 센다", () => {
    const report = diffCassettes(cassetteOf(SEOUL, BUSAN), cassetteOf(SEOUL));

    expect(report.dropped.map((item) => item.request.args)).toStrictEqual([{ city: "부산" }]);
    expect(report.kept).toBe(1);
    expect(report.added).toBe(0);
  });

  it("같은 key 에 응답만 바뀐 것은 손실이 아니라 갱신이다", () => {
    const changed = interaction("get_weather", { city: "서울" }, { temp: 99 });
    const report = diffCassettes(cassetteOf(SEOUL), cassetteOf(changed));

    expect(report.dropped).toStrictEqual([]);
    expect(report.kept).toBe(1);
    expect(report.added).toBe(0);
  });

  it("after 가 before 의 상위집합이면 사라지는 것이 없다", () => {
    const report = diffCassettes(cassetteOf(SEOUL), cassetteOf(SEOUL, BUSAN));

    expect(report.dropped).toStrictEqual([]);
    expect(report.kept).toBe(1);
    expect(report.added).toBe(1);
  });
});

describe("droppedInteractionsMessage", () => {
  it("사라지는 것이 없으면 null 이다", () => {
    expect(droppedInteractionsMessage(diffCassettes(cassetteOf(SEOUL), cassetteOf(SEOUL)))).toBe(
      null,
    );
  });

  it("개수 · 사라지는 요청 · 해법을 모두 담는다", () => {
    const report = diffCassettes(cassetteOf(SEOUL, BUSAN), cassetteOf(SEOUL));
    const message = droppedInteractionsMessage(report, "fixtures/weather.cassette.json");

    expect(message).not.toBe(null);
    expect(message).toContain("fixtures/weather.cassette.json");
    expect(message).toContain("상호작용 1개를 지웁니다");
    expect(message).toContain("기존 2개 중 1개는 유지되고");
    expect(message).toContain('get_weather({"city":"부산"})');
    // 무엇을 해야 하는지가 보여야 한다 (CLAUDE.md — 실패 메시지가 곧 제품이다).
    expect(message).toContain("--record 없이 실행하세요");
  });

  it("4개 이상이면 3개만 보이고 나머지는 개수로 줄인다", () => {
    const many = Array.from({ length: 5 }, (_, index) =>
      interaction("add", { a: index, b: index }, { sum: index * 2 }),
    );
    const message = droppedInteractionsMessage(diffCassettes(cassetteOf(...many), cassetteOf()));

    expect(message).toContain("외 2개");
    expect(message).toContain("상호작용 5개를 지웁니다");
  });

  it("비밀값이 든 args 는 마스킹해서 보여준다", () => {
    const secret = interaction("login", { user: "kim", apiKey: "sk-live-1234" }, { ok: true });
    const message = droppedInteractionsMessage(diffCassettes(cassetteOf(secret), cassetteOf()));

    expect(message).toContain("[redacted]");
    expect(message).not.toContain("sk-live-1234");
  });
});

describe("cassetteClient — record 모드의 축소 경고", () => {
  /** record 모드로 한 번 돌리고, 나온 경고와 저장된 카세트를 함께 준다. */
  async function recordRun(
    baseline: Cassette | null,
    calls: readonly (readonly [string, unknown])[],
    results: ToolResult[],
    withFlush = true,
  ) {
    const warnings: string[] = [];
    let flushed: Cassette | undefined;
    const client = cassetteClient(fakeClient(results), {
      cassette: baseline,
      mode: "record",
      cassettePath: "demo.cassette.json",
      onWarning: (message) => warnings.push(message),
      ...(withFlush
        ? {
            onFlush: async (value: Cassette) => {
              flushed = value;
            },
          }
        : {}),
    });
    for (const [name, args] of calls) await client.callTool(name, args);
    await client.close();
    return { warnings, flushed };
  }

  it("기존 카세트를 일부만 다시 부르면 close 때 경고한다", async () => {
    const { warnings } = await recordRun(
      cassetteOf(SEOUL, BUSAN, JEJU),
      [["get_weather", { city: "서울" }]],
      [ok({ temp: 21 })],
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("상호작용 2개를 지웁니다");
    expect(warnings[0]).toContain('get_weather({"city":"부산"})');
    expect(warnings[0]).toContain('get_weather({"city":"제주"})');
  });

  it("기존 것을 전부 다시 부르면 경고하지 않는다", async () => {
    const { warnings } = await recordRun(
      cassetteOf(SEOUL, BUSAN),
      [
        ["get_weather", { city: "서울" }],
        ["get_weather", { city: "부산" }],
      ],
      [ok({ temp: 21 }), ok({ temp: 24 })],
    );

    expect(warnings).toStrictEqual([]);
  });

  it("새 파일(cassette: null)이면 경고하지 않는다", async () => {
    const { warnings } = await recordRun(
      null,
      [["get_weather", { city: "서울" }]],
      [ok({ temp: 21 })],
    );

    expect(warnings).toStrictEqual([]);
  });

  it("저장하지 않으면(onFlush 없음) 파일이 안 바뀌므로 경고하지 않는다", async () => {
    const { warnings } = await recordRun(
      cassetteOf(SEOUL, BUSAN),
      [["get_weather", { city: "서울" }]],
      [ok({ temp: 21 })],
      false,
    );

    expect(warnings).toStrictEqual([]);
  });

  it("auto 모드는 지우지 않으므로 이 경고를 내지 않는다", async () => {
    const warnings: string[] = [];
    let flushed: Cassette | undefined;
    const client = cassetteClient(fakeClient([]), {
      cassette: cassetteOf(SEOUL, BUSAN),
      mode: "auto",
      onWarning: (message) => warnings.push(message),
      onFlush: async (value) => {
        flushed = value;
      },
    });
    await client.callTool("get_weather", { city: "서울" });
    await client.close();

    expect(warnings).toStrictEqual([]);
    // auto 는 부르지 않은 것도 그대로 들고 있다.
    expect(flushed?.interactions).toHaveLength(2);
  });

  it("저장(onFlush)이 실패하면 경고하지 않는다 — 파일이 그대로이므로 사라진 것도 없다", async () => {
    const warnings: string[] = [];
    const client = cassetteClient(fakeClient([ok({ temp: 21 })]), {
      cassette: cassetteOf(SEOUL, BUSAN, JEJU),
      mode: "record",
      cassettePath: "demo.cassette.json",
      onWarning: (message) => warnings.push(message),
      onFlush: async () => {
        throw new Error("디스크가 가득 찼습니다");
      },
    });
    await client.callTool("get_weather", { city: "서울" });

    await expect(client.close()).rejects.toThrow("디스크가 가득 찼습니다");
    expect(warnings).toStrictEqual([]);
  });

  it("경고는 저장을 막지 않는다 — 저장 내용은 경고 없을 때와 같다", async () => {
    const { warnings, flushed } = await recordRun(
      cassetteOf(SEOUL, BUSAN, JEJU),
      [["get_weather", { city: "서울" }]],
      [ok({ temp: 21 })],
    );

    expect(warnings).toHaveLength(1);
    // --record 의 의미는 그대로다. 이번 실행이 부른 것만 남는다.
    expect(flushed?.interactions).toHaveLength(1);
    expect(flushed?.interactions[0]?.request.args).toStrictEqual({ city: "서울" });
  });
});
