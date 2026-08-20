import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpClient, ToolResult } from "@mcpeak/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type Cassette,
  type CassetteMode,
  cassetteClient,
  loadCassette,
  saveCassette,
} from "../src/index.js";

/**
 * 파일에 이미 있는 녹화본이 `--record` 없는 재실행에서 살아남는지 고정한다.
 *
 * 기존 `cassetteClient` 스펙은 `onFlush` 를 인메모리로 받아 스냅샷만 본다. 사용자가 실제로
 * 겪는 것은 그다음 단계 — `saveCassette` 가 파일을 통째로 덮어쓰는 것 — 이라, 이번 실행이
 * 부르지 않은 상호작용이 그 덮어쓰기에서 사라지지 않는다는 보장은 파일 왕복으로만 잡힌다.
 */

const ok = (raw: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(raw) }],
  isError: false,
  raw,
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
      if (result === undefined) throw new Error("fake client 에 준비된 응답이 없습니다");
      return result;
    },
    async close() {},
  };
}

/** `cli/src/cassette-wiring.ts` 의 판정을 그대로 옮긴 것. 카세트가 있으면 auto 다. */
const resolveMode = (cassette: Cassette | null, forceRecord: boolean): CassetteMode =>
  forceRecord || cassette === null ? "record" : "auto";

interface RunResult {
  readonly mode: CassetteMode;
  readonly seen: readonly ToolResult[];
  readonly innerCalls: number;
}

/** load → 모드 판정 → 호출 → flush → save. `wireCassette` 가 하는 일과 같은 순서다. */
async function run(
  path: string,
  forceRecord: boolean,
  calls: readonly (readonly [string, unknown])[],
  results: ToolResult[],
): Promise<RunResult> {
  const loaded = await loadCassette(path);
  const mode = resolveMode(loaded, forceRecord);
  const inner = fakeClient(results);
  let snapshot: Cassette | undefined;
  const client = cassetteClient(inner, {
    cassette: loaded,
    mode,
    cassettePath: path,
    onFlush: async (value) => {
      snapshot = value;
    },
  });

  const seen: ToolResult[] = [];
  for (const [name, args] of calls) seen.push(await client.callTool(name, args));
  await client.close();
  if (snapshot !== undefined) await saveCassette(path, snapshot);

  return { mode, seen, innerCalls: inner.calls.callTool };
}

async function storedRequests(path: string): Promise<string[]> {
  const cassette = await loadCassette(path);
  if (cassette === null) throw new Error(`카세트를 읽지 못했습니다: ${path}`);
  return cassette.interactions
    .map(
      (interaction) =>
        `${interaction.request.toolName}(${JSON.stringify(interaction.request.args)})`,
    )
    .sort();
}

describe("파일 왕복: auto 모드와 record 모드의 보존 차이", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mcpeak-cassette-"));
    path = join(dir, "demo-cassette.json");
    // 씨앗: 서로 다른 두 호출을 녹화해 파일로 남긴다.
    const seeded = await run(
      path,
      false,
      [
        ["get_weather", { city: "Seoul" }],
        ["get_weather", { city: "Busan" }],
      ],
      [ok({ temp: 21 }), ok({ temp: 25 })],
    );
    expect(seeded.mode).toBe("record"); // 파일이 없었으므로 record 로 시작한다
    expect(await storedRequests(path)).toStrictEqual([
      'get_weather({"city":"Busan"})',
      'get_weather({"city":"Seoul"})',
    ]);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("auto 모드는 이번 실행이 부르지 않은 녹화본까지 파일에 남긴다", async () => {
    // Seoul 은 히트, get_forecast 는 미스. Busan 은 아예 부르지 않는다.
    const second = await run(
      path,
      false,
      [
        ["get_weather", { city: "Seoul" }],
        ["get_forecast", { city: "Seoul" }],
      ],
      [ok({ days: 3 })],
    );

    expect(second.mode).toBe("auto");
    // 미스 하나만 실제 서버로 나갔다. 히트는 카세트가 답했다.
    expect(second.innerCalls).toBe(1);
    expect(second.seen[0]?.raw).toStrictEqual({ temp: 21 });

    // 부르지 않은 Busan 이 그대로 살아 있고, 새 호출이 덧붙었다.
    expect(await storedRequests(path)).toStrictEqual([
      'get_forecast({"city":"Seoul"})',
      'get_weather({"city":"Busan"})',
      'get_weather({"city":"Seoul"})',
    ]);
  });

  it("record 모드는 같은 실행에서 부르지 않은 녹화본을 파일에서 지운다", async () => {
    const second = await run(path, true, [["get_weather", { city: "Seoul" }]], [ok({ temp: 30 })]);

    expect(second.mode).toBe("record");
    // 파일에 있던 응답을 무시하고 실제 서버를 부른다.
    expect(second.innerCalls).toBe(1);
    expect(second.seen[0]?.raw).toStrictEqual({ temp: 30 });

    // Busan 은 사라졌다. 이번 실행이 부른 것만 남는다.
    expect(await storedRequests(path)).toStrictEqual(['get_weather({"city":"Seoul"})']);
  });
});
