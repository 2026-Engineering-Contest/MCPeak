import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { McpStdioConnection, ToolDef } from "@mcpeak/core";
import { connectStdio } from "@mcpeak/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { OptimizeOverlay } from "../src/types.js";

/**
 * 계획서 §8.5. 상류는 examples/weather-server 이고, 프록시는 **배포 진입점 그 자체**
 * (src/proxy-stdio.ts)를 tests/fixtures/proxy-entry.mjs 를 거쳐 소스로 띄운다.
 *
 * 이 파일이 확인하는 것은 "도구 정의만 바뀌고 호출은 원본과 같다" 는 프록시의 계약이다.
 * 그래서 호출 결과는 원본 서버에 **직접** 붙은 결과와 raw 째로 비교한다.
 */

const WEATHER = fileURLToPath(
  new URL("../../../examples/weather-server/server.mjs", import.meta.url),
);
const ENTRY = fileURLToPath(new URL("./fixtures/proxy-entry.mjs", import.meta.url));
/**
 * core 소스에 매개변수 프로퍼티가 있어 strip-only 모드로는 못 돈다(proxy-entry.mjs 머리말).
 * `--no-warnings` 는 실험 기능 경고가 stderr 에 섞여 문장 단언을 깨지 않게 한다.
 */
const NODE_FLAGS = ["--experimental-transform-types", "--no-warnings"];
const TIMEOUT_MS = 30_000;

const opened: McpStdioConnection[] = [];
let direct: McpStdioConnection;
let originalTools: ToolDef[];

/** 원본 서버에 직접 붙는다. 프록시 결과와 비교할 기준이다. */
beforeAll(async () => {
  direct = await connectStdio({ command: process.execPath, args: [WEATHER] });
  originalTools = await direct.client.listTools();
}, TIMEOUT_MS);

afterAll(async () => {
  await direct?.close();
});

afterEach(async () => {
  await Promise.all(opened.splice(0).map((connection) => connection.close()));
});

/**
 * weather-server 의 tools/list 로 오버레이를 만든다. optimize() 는 이 태스크 시점에 아직
 * 스텁이라 손으로 만든다. **일부러 원본과 다르게** 만든다. 같으면 프록시가 오버레이를 냈는지
 * 상류 목록을 흘렸는지 테스트가 구분하지 못한다. 바꾸는 것은 안전 프로필이 실제로 바꾸는
 * 종류(설명 문장, 파라미터 설명)로 고른다.
 */
function buildOverlay(tools: readonly ToolDef[]): OptimizeOverlay {
  const toolNames = tools.map((tool) => tool.name).sort();
  return {
    schemaVersion: 1,
    generator: { name: "@mcpeak/optimize", version: "0.0.0-test" },
    source: {
      toolCount: tools.length,
      toolNames,
      instructions: "",
      bytes: 0,
      otherCapabilities: [],
    },
    instructions: "",
    tools: tools.map((tool) => ({
      name: tool.name,
      description: `(압축) ${tool.description ?? ""}`,
      inputSchema: withoutPropertyDescriptions(tool.inputSchema),
      changes: [],
      bytes: { before: 0, after: 0 },
    })),
    totals: { bytesBefore: 0, bytesAfter: 0, bytesAfterWithInstructions: 0, promotedParameters: 0 },
  };
}

function withoutPropertyDescriptions(schema: unknown): unknown {
  const copy = structuredClone(schema) as { properties?: Record<string, { description?: string }> };
  for (const property of Object.values(copy.properties ?? {})) delete property.description;
  return copy;
}

function writeOverlay(overlay: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "mcpeak-optimize-"));
  const path = join(dir, "overlay.json");
  writeFileSync(path, JSON.stringify(overlay), "utf8");
  return path;
}

/** 프록시를 띄우고 core 로 붙는다. 사용자가 MCP 클라이언트에서 붙는 경로와 같다. */
async function connectProxy(overlayPath: string): Promise<McpStdioConnection> {
  const connection = await connectStdio({
    command: process.execPath,
    args: [...NODE_FLAGS, ENTRY, overlayPath, "--", process.execPath, WEATHER],
  });
  opened.push(connection);
  return connection;
}

interface RawSession {
  /** 한 줄짜리 JSON-RPC 메시지를 보낸다. id 가 있으면 그 id 의 응답을 기다린다. */
  send(message: Record<string, unknown>): Promise<unknown>;
  /** stdin 을 닫는다. 클라이언트가 서버를 끝내는 정상 경로다. */
  end(): void;
  readonly exited: Promise<{ code: number | null; stdout: string; stderr: string }>;
}

/**
 * 프록시를 SDK 없이 띄운다. stdout 의 바이트를 그대로 보려면 클라이언트 SDK 가 끼면 안 된다.
 * SDK 는 JSON 이 아닌 줄을 조용히 버리므로 오염을 가린다.
 */
function spawnProxy(args: readonly string[]): RawSession {
  const child = spawn(process.execPath, [...NODE_FLAGS, ENTRY, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const waiting = new Map<unknown, (message: unknown) => void>();
  let buffered = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
    buffered += chunk;
    let newline = buffered.indexOf("\n");
    while (newline !== -1) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf("\n");
      // 파싱 실패는 여기서 삼킨다. 오염 여부는 테스트가 stdout 전체로 판정한다.
      try {
        const message = JSON.parse(line) as { id?: unknown };
        waiting.get(message.id)?.(message);
      } catch {}
    }
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exited = new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
    },
  );
  return {
    send(message) {
      const reply =
        "id" in message
          ? new Promise<unknown>((resolve) => waiting.set(message.id, resolve))
          : Promise.resolve(undefined);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
      return reply;
    },
    end() {
      child.stdin.end();
    },
    exited,
  };
}

async function initialize(session: RawSession): Promise<void> {
  await session.send({
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "proxy-e2e", version: "0.0.0" },
    },
  });
  await session.send({ method: "notifications/initialized" });
}

/** stdout 이 줄 단위 JSON-RPC 메시지로만 이뤄졌는지. 어긋난 첫 줄을 그대로 보여준다. */
function expectOnlyJsonRpc(stdout: string): void {
  expect(stdout.endsWith("\n")).toBe(true);
  for (const line of stdout.slice(0, -1).split("\n")) {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      throw new Error(`stdout 에 JSON 이 아닌 줄이 섞였습니다: ${JSON.stringify(line)}`);
    }
    expect(message, `JSON-RPC 가 아닌 메시지: ${line}`).toMatchObject({ jsonrpc: "2.0" });
  }
}

describe("mcpeak-optimize-proxy (weather-server)", { timeout: TIMEOUT_MS }, () => {
  it("프록시의 listTools 가 오버레이의 name·description·inputSchema 와 같다", async () => {
    const overlay = buildOverlay(originalTools);
    const proxy = await connectProxy(writeOverlay(overlay));

    const listed = await proxy.client.listTools();

    expect(listed).toEqual(
      overlay.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    );
    // 오버레이가 원본과 다르게 만들어졌다는 전제를 확인한다. 같으면 위 단언이 아무것도 못 가른다.
    expect(listed).not.toEqual(originalTools);
  });

  it("get_weather 호출 결과의 raw 가 원본 서버에 직접 호출한 raw 와 깊은 비교로 같다", async () => {
    const proxy = await connectProxy(writeOverlay(buildOverlay(originalTools)));

    const viaProxy = await proxy.client.callTool("get_weather", { city: "서울" });
    const viaDirect = await direct.client.callTool("get_weather", { city: "서울" });

    expect(viaProxy.isError).toBe(false);
    expect(viaProxy.raw).toEqual(viaDirect.raw);
  });

  it("잘못된 인자를 보내면 원본과 같은 isError 와 같은 content 를 돌려준다", async () => {
    const proxy = await connectProxy(writeOverlay(buildOverlay(originalTools)));

    // 스키마 위반(타입), 필수 인자 누락, 데이터에 없는 값. 프록시가 검증을 하면 셋 중 앞의 둘은
    // 원본과 다른 문장이 나온다. 셋 다 원본 서버의 문장이어야 한다.
    for (const args of [{ city: 123 }, {}, { city: "없는도시" }]) {
      const viaProxy = await proxy.client.callTool("get_weather", args);
      const viaDirect = await direct.client.callTool("get_weather", args);

      expect(viaDirect.isError).toBe(true);
      expect(viaProxy.isError).toBe(viaDirect.isError);
      expect(viaProxy.content).toEqual(viaDirect.content);
      expect(viaProxy.raw).toEqual(viaDirect.raw);
    }
  });

  it("오버레이의 toolNames 를 하나 바꾸면 OVERLAY_UPSTREAM_MISMATCH 문장으로 종료 코드 1", async () => {
    const overlay = buildOverlay(originalTools);
    const stale = {
      ...overlay,
      source: {
        ...overlay.source,
        toolNames: overlay.source.toolNames.map((name) =>
          name === "get_weather" ? "get_forecast" : name,
        ),
      },
    };
    const path = writeOverlay(stale);

    const session = spawnProxy([path, "--", process.execPath, WEATHER]);
    const { code, stdout, stderr } = await session.exited;

    expect(stderr).toBe(
      [
        "→ 오버레이는 도구 2개인데 서버는 2개를 냅니다.",
        "→ 서버에만 있는 도구: 'get_weather'",
        "→ 오버레이에만 있는 도구: 'get_forecast'",
        `해결: 서버가 바뀌었습니다. mcpeak optimize --out ${path} -- ${process.execPath} ${WEATHER} 으로 오버레이를 다시 만드세요.`,
        "",
      ].join("\n"),
    );
    expect(code).toBe(1);
    // 대조가 끝나기 전에는 stdio 서버를 붙이지 않는다. 한 바이트라도 나가면 클라이언트가
    // 반쯤 뜬 서버로 오해한다.
    expect(stdout).toBe("");
  });

  it("stdout 에 JSON-RPC 외 바이트가 없다", async () => {
    const path = writeOverlay(buildOverlay(originalTools));
    const session = spawnProxy([path, "--", process.execPath, WEATHER]);

    await initialize(session);
    await session.send({ id: 2, method: "tools/list" });
    await session.send({
      id: 3,
      method: "tools/call",
      params: { name: "get_weather", arguments: { city: "서울" } },
    });
    await session.send({
      id: 4,
      method: "tools/call",
      params: { name: "get_weather", arguments: { city: 123 } },
    });
    // 클라이언트가 stdin 을 닫는 것이 정상 종료다. 상류까지 정리하고 0 으로 끝나야 한다.
    session.end();
    const { code, stdout, stderr } = await session.exited;

    expectOnlyJsonRpc(stdout);
    expect(stdout.trimEnd().split("\n")).toHaveLength(4);
    expect(stderr).toBe("");
    expect(code).toBe(0);
  });

  /**
   * §6.7. 계획서의 다섯 이름 밖이지만 종료 순서의 한 갈래라 함께 고정한다. 상류가 죽은 뒤에도
   * 프록시가 살아 있으면 클라이언트는 모든 호출에 실패만 받는 서버를 붙들고 있게 된다.
   *
   * 상류는 weather-server 를 그대로 싣고, tools/call 이 들어오는 순간 종료 코드 3 으로 끝나게
   * 감싼다. 시각이 아니라 요청으로 죽이므로 느린 CI 에서도 같은 순서로 일어난다.
   */
  it("상류가 종료 코드 3 으로 죽으면 stderr 한 줄을 남기고 같은 종료 코드로 끝난다", async () => {
    const path = writeOverlay(buildOverlay(originalTools));
    const script = [
      "process.stdin.on('data', (chunk) => { if (String(chunk).includes('\"tools/call\"')) process.exit(3); });",
      `await import(${JSON.stringify(pathToFileURL(WEATHER).href)});`,
    ].join(" ");
    const upstream = [process.execPath, "--input-type=module", "-e", script];
    const session = spawnProxy([path, "--", ...upstream]);

    await initialize(session);
    void session.send({
      id: 2,
      method: "tools/call",
      params: { name: "get_weather", arguments: { city: "서울" } },
    });
    const { code, stdout, stderr } = await session.exited;

    expect(stderr).toBe(
      `→ 원본 서버가 끝나서 프록시도 끝냅니다 (종료 코드 3): ${upstream.join(" ")}\n`,
    );
    expect(code).toBe(3);
    expectOnlyJsonRpc(stdout);
  });
});
