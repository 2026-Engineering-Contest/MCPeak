import type { McpClient, ToolDef, ToolResult } from "@ohmymcp/core";
import type { Cassette } from "@ohmymcp/record";
import { CASSETTE_VERSION, cassetteClient, stableStringify } from "@ohmymcp/record";
import { describe, expect, it } from "vitest";
import { wireCassette } from "../src/cassette-wiring.js";

const tools: ToolDef[] = [{ name: "get_weather", inputSchema: { type: "object" } }];

interface FakeInner extends McpClient {
  readonly calls: string[];
  readonly closeCount: () => number;
}

/** 호출마다 다른 응답을 주고 싶을 때 쓰는 응답 생성기. 기본은 항상 같은 응답이다. */
const fakeInner = (
  respond: (name: string, index: number) => ToolResult = (name) => ({
    content: [{ type: "text", text: `${name} ok` }],
    isError: false,
    raw: { tool: name },
  }),
): FakeInner => {
  const calls: string[] = [];
  let closes = 0;
  return {
    calls,
    closeCount: () => closes,
    async listTools() {
      calls.push("listTools");
      return tools;
    },
    async callTool(name) {
      const index = calls.filter((call) => call === name).length;
      calls.push(name);
      return respond(name, index);
    },
    async close() {
      closes += 1;
    },
  };
};

interface FakeIo {
  load(path: string): Promise<Cassette | null>;
  save(path: string, cassette: Cassette): Promise<void>;
  readonly saved: Array<{ path: string; cassette: Cassette }>;
}

const fakeIo = (initial: Cassette | null = null, onLoad?: () => never): FakeIo => {
  const saved: Array<{ path: string; cassette: Cassette }> = [];
  return {
    saved,
    async load() {
      onLoad?.();
      return initial;
    },
    async save(path, cassette) {
      saved.push({ path, cassette });
    },
  };
};

/** 인메모리 카세트 하나를 만든다. 파일시스템을 쓰지 않는다. */
const recordedCassette = async (): Promise<Cassette> => {
  let snapshot: Cassette | undefined;
  const recorder = cassetteClient(fakeInner(), {
    cassette: null,
    mode: "record",
    onFlush: async (value) => {
      snapshot = value;
    },
  });
  await recorder.callTool("get_weather", { city: "서울" });
  await recorder.close();
  if (snapshot === undefined) throw new Error("녹화본을 만들지 못했습니다.");
  return snapshot;
};

describe("wireCassette", () => {
  it("path 가 undefined 면 client 가 inner 와 같은 객체다", async () => {
    const inner = fakeInner();
    const wiring = await wireCassette({ inner, path: undefined, forceRecord: false });
    expect(wiring.client).toBe(inner);
    expect(wiring.warnings).toEqual([]);
  });

  it("path 가 undefined 면 flush 가 save 를 부르지 않는다", async () => {
    const io = fakeIo();
    const inner = fakeInner();
    const wiring = await wireCassette({ inner, path: undefined, forceRecord: false, io });
    await wiring.flush();
    expect(io.saved).toEqual([]);
    expect(inner.closeCount()).toBe(0);
  });

  it("파일이 없으면 record 모드로 동작한다", async () => {
    const inner = fakeInner();
    const wiring = await wireCassette({
      inner,
      path: ".ohmymcp/x.json",
      forceRecord: false,
      io: fakeIo(null),
    });
    await wiring.client.callTool("get_weather", { city: "서울" });
    expect(inner.calls).toEqual(["get_weather"]);
    // 화면이 재생 여부를 말할 때 파일 존재로 다시 추정하지 않도록 모드를 그대로 내보낸다.
    expect(wiring.mode).toBe("record");
  });

  it("파일이 있으면 auto 모드로 동작한다", async () => {
    const inner = fakeInner();
    const wiring = await wireCassette({
      inner,
      path: ".ohmymcp/x.json",
      forceRecord: false,
      io: fakeIo(await recordedCassette()),
    });
    // 카세트에 있는 키다. inner 로 가지 않는다.
    await wiring.client.callTool("get_weather", { city: "서울" });
    expect(inner.calls).toEqual([]);
    // 카세트에 없는 키는 inner 로 간다. 새 케이스가 추가되는 것이 이 경로의 정상 흐름이다.
    await wiring.client.callTool("get_weather", { city: "부산" });
    expect(inner.calls).toEqual(["get_weather"]);
    expect(wiring.mode).toBe("auto");
  });

  it("forceRecord 면 파일이 있어도 전부 inner 로 간다", async () => {
    const inner = fakeInner();
    const wiring = await wireCassette({
      inner,
      path: ".ohmymcp/x.json",
      forceRecord: true,
      io: fakeIo(await recordedCassette()),
    });
    await wiring.client.callTool("get_weather", { city: "서울" });
    expect(inner.calls).toEqual(["get_weather"]);
  });

  it("client.close() 가 inner.close() 를 부르고 save 는 안 부른다", async () => {
    const io = fakeIo();
    const inner = fakeInner();
    const wiring = await wireCassette({ inner, path: ".ohmymcp/x.json", forceRecord: false, io });
    await wiring.client.close();
    expect(inner.closeCount()).toBe(1);
    expect(io.saved).toEqual([]);
  });

  it("flush() 가 save 를 정확히 1회 부른다", async () => {
    const io = fakeIo();
    const wiring = await wireCassette({
      inner: fakeInner(),
      path: ".ohmymcp/x.json",
      forceRecord: false,
      io,
    });
    await wiring.flush();
    expect(io.saved).toHaveLength(1);
    expect(io.saved[0]?.path).toBe(".ohmymcp/x.json");
  });

  it("flush() 가 저장한 카세트에 녹화된 호출이 들어 있다", async () => {
    const io = fakeIo();
    const wiring = await wireCassette({
      inner: fakeInner(),
      path: ".ohmymcp/x.json",
      forceRecord: false,
      io,
    });
    await wiring.client.callTool("get_weather", { city: "서울" });
    await wiring.flush();
    const interactions = io.saved[0]?.cassette.interactions ?? [];
    expect(interactions).toHaveLength(1);
    expect(interactions[0]?.request).toEqual({
      toolName: "get_weather",
      args: { city: "서울" },
    });
  });

  it("같은 키에 다른 응답이 오면 warnings 에 문장이 쌓인다", async () => {
    const inner = fakeInner((name, index) => ({
      content: [{ type: "text", text: `${name} ${index}` }],
      isError: false,
      raw: { attempt: index },
    }));
    const wiring = await wireCassette({
      inner,
      path: ".ohmymcp/x.json",
      forceRecord: false,
      io: fakeIo(),
    });
    await wiring.client.callTool("get_weather", { city: "서울" });
    await wiring.client.callTool("get_weather", { city: "서울" });
    expect(wiring.warnings).toHaveLength(1);
  });

  it("warnings 문장이 record 가 만든 것과 같다", async () => {
    const respond = (name: string, index: number): ToolResult => ({
      content: [{ type: "text", text: `${name} ${index}` }],
      isError: false,
      raw: { attempt: index },
    });
    const wiring = await wireCassette({
      inner: fakeInner(respond),
      path: ".ohmymcp/x.json",
      forceRecord: false,
      io: fakeIo(),
    });
    await wiring.client.callTool("get_weather", { city: "서울" });
    await wiring.client.callTool("get_weather", { city: "서울" });

    // 같은 상황을 cassetteClient 로 직접 만들어 문장을 비교한다. 우리가 다시 만들지 않는다.
    const direct: string[] = [];
    const recorder = cassetteClient(fakeInner(respond), {
      cassette: null,
      mode: "record",
      cassettePath: ".ohmymcp/x.json",
      onWarning: (message) => direct.push(message),
    });
    await recorder.callTool("get_weather", { city: "서울" });
    await recorder.callTool("get_weather", { city: "서울" });

    expect(wiring.warnings).toEqual(direct);
  });

  it("load 가 던지면 wireCassette 가 그대로 던진다", async () => {
    const broken = fakeIo(null, () => {
      throw new Error("→ 카세트가 올바르지 않습니다");
    });
    await expect(
      wireCassette({
        inner: fakeInner(),
        path: ".ohmymcp/x.json",
        forceRecord: false,
        io: broken,
      }),
    ).rejects.toThrow("→ 카세트가 올바르지 않습니다");
  });

  it("같은 입력으로 2회 돌린 저장 카세트가 바이트 동일하다", async () => {
    const run = async (): Promise<string> => {
      const io = fakeIo();
      const wiring = await wireCassette({
        inner: fakeInner(),
        path: ".ohmymcp/x.json",
        forceRecord: false,
        io,
      });
      await wiring.client.listTools();
      await wiring.client.callTool("get_weather", { city: "서울" });
      await wiring.client.callTool("get_weather", { city: "부산" });
      await wiring.flush();
      return stableStringify(io.saved[0]?.cassette);
    };
    const first = await run();
    expect(await run()).toBe(first);
    expect(first).toContain(`"version":${CASSETTE_VERSION}`);
  });
});
