import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpClient } from "@mcpeak/core";
import { connect } from "@mcpeak/core";
import { assertMockDefinition, createMockServer, type MockServer } from "@mcpeak/mock";
import { afterEach, describe, expect, it } from "vitest";
import type { FileContent, JsonValue, PutFileResponse } from "../src/api-types.js";
import { type DashboardServer, startDashboardServer } from "../src/index.js";
import {
  buildMockDefinition,
  type MockDraft,
  mockFilePath,
  serializeMockDefinition,
} from "../web/src/mock-builder/draft.js";
import { draftFromDefinition } from "../web/src/mock-builder/from-definition.js";

/**
 * 폼 초안 → 대시보드 PUT → 파일 → 목 서버. 그리고 기존 파일 → GET → 초안 → PUT → 목 서버.
 * 사용자가 화면에서 만들거나 고친 파일이 **목이 읽는 그대로** 동작하는지 본다.
 * 파일명이 `*-e2e.test.ts` 라 직렬 갈래로 수집된다.
 *
 * `mcpeak-mock` bin(stdio) 대신 `createMockServer`(HTTP)를 쓴다. 정의를 해석하는 경로
 * (`assertMockDefinition` → `seed` → `buildServer`)가 같고, bin 을 띄우려면 빌드 산출물이나
 * mock 패키지의 테스트 전용 로더가 필요하기 때문이다(계획서 "확정한 판단").
 */

const WEATHER_TOOL = {
  name: "get_weather",
  description: "",
  schemaMode: "fields" as const,
  fields: [{ name: "city", type: "string" as const, required: true }],
  schemaJson: "",
  extra: {},
};

const DRAFT: MockDraft = {
  tools: [WEATHER_TOOL],
  responses: [
    {
      tool: "get_weather",
      anyArgs: false,
      argsJson: '{"city":"Seoul"}',
      resultJson: '{"temperature":21.5}',
      isError: false,
      origin: "recording",
      extra: {},
    },
    {
      tool: "get_weather",
      anyArgs: false,
      argsJson: '{"city":"Nowhere"}',
      resultJson: '{"error":"unknown city"}',
      isError: true,
      origin: "manual",
      extra: {},
    },
    {
      tool: "get_weather",
      anyArgs: true,
      argsJson: "",
      resultJson: '{"temperature":0}',
      isError: false,
      origin: "manual",
      extra: {},
    },
  ],
  extra: {},
};

/** 손으로 쓴 기존 파일. 서식 · 기본값 명시 · 보존 키가 섞여 있다. */
const HANDWRITTEN = `{"$comment":"손으로 적은 메모","tools":[{"name":"get_weather","annotations":{"readOnlyHint":true},"inputSchema":{"type":"object","required":["city"],"properties":{"city":{"type":"string"}}}}],"responses":[{"tool":"get_weather","args":{"city":"Seoul"},"result":{"temperature":21.5},"isError":false}]}`;

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => undefined);
});

async function startDashboard(): Promise<{ base: string; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "mcpeak-mock-builder-e2e-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const server: DashboardServer = await startDashboardServer({ port: 0, root });
  cleanups.push(() => server.close());
  return { base: `http://127.0.0.1:${server.port}`, root };
}

async function saveDraft(
  base: string,
  path: string,
  draft: MockDraft,
  baseMtimeMs = 0,
): Promise<void> {
  const built = buildMockDefinition(draft);
  if (!built.ok) throw new Error(built.errors.join("\n"));
  const response = await fetch(`${base}${mockFilePath(path)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: serializeMockDefinition(built.definition), baseMtimeMs }),
  });
  expect(response.status).toBe(200);
  expect(((await response.json()) as PutFileResponse).saved).toBe(true);
}

/** 화면의 "기존 목 수정" 과 같은 길로 연다. */
async function openMock(
  base: string,
  path: string,
): Promise<{ draft: MockDraft; mtimeMs: number }> {
  const response = await fetch(`${base}${mockFilePath(path)}`);
  expect(response.status).toBe(200);
  const file = (await response.json()) as FileContent;
  return {
    draft: draftFromDefinition(JSON.parse(file.content) as JsonValue),
    mtimeMs: file.mtimeMs,
  };
}

/** 저장된 파일을 목이 읽는 방식 그대로 읽어 띄우고 붙는다. */
async function connectToSavedMock(file: string): Promise<McpClient> {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  assertMockDefinition(parsed, file);
  const mock: MockServer = await createMockServer(parsed);
  cleanups.push(() => mock.close());
  const client = await connect({ url: mock.url });
  cleanups.push(() => client.close());
  return client;
}

function textOf(result: { content: unknown }): unknown {
  const content = result.content as { type: string; text: string }[];
  const first = content[0];
  if (first?.type !== "text") throw new Error("text content 가 없다");
  return JSON.parse(first.text);
}

describe.sequential("목 만들기 왕복", () => {
  it("새로 만든 파일을 목이 tools/list · tools/call 로 적은 대로 내놓는다", async () => {
    const { base, root } = await startDashboard();
    await saveDraft(base, "weather.mock.json", DRAFT);

    const client = await connectToSavedMock(join(root, "weather.mock.json"));

    const tools = await client.listTools();
    expect(tools.map((tool) => ({ name: tool.name, inputSchema: tool.inputSchema }))).toEqual([
      {
        name: "get_weather",
        inputSchema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    ]);

    const seoul = await client.callTool("get_weather", { city: "Seoul" });
    expect(seoul.isError).toBe(false);
    expect(textOf(seoul)).toEqual({ temperature: 21.5 });

    const nowhere = await client.callTool("get_weather", { city: "Nowhere" });
    expect(nowhere.isError).toBe(true);
    expect(textOf(nowhere)).toEqual({ error: "unknown city" });

    // 인자 무관(ANY) 응답이 지정되지 않은 인자를 받는다.
    const busan = await client.callTool("get_weather", { city: "Busan" });
    expect(busan.isError).toBe(false);
    expect(textOf(busan)).toEqual({ temperature: 0 });
  });

  it("같은 초안을 두 번 저장하면 두 파일이 바이트 단위로 같다", async () => {
    const { base, root } = await startDashboard();
    await saveDraft(base, "a.mock.json", DRAFT);
    await saveDraft(base, "b.mock.json", DRAFT);

    const [a, b] = await Promise.all([
      readFile(join(root, "a.mock.json")),
      readFile(join(root, "b.mock.json")),
    ]);
    expect(a.equals(b)).toBe(true);
  });

  it("기존 파일을 열어 응답을 더해 저장하면 보존 키가 살고, 목이 새 응답까지 내놓는다", async () => {
    const { base, root } = await startDashboard();
    await writeFile(join(root, "weather.mock.json"), HANDWRITTEN, "utf8");

    const opened = await openMock(base, "weather.mock.json");
    const edited: MockDraft = {
      ...opened.draft,
      responses: [
        ...opened.draft.responses,
        { ...DRAFT.responses[2], extra: {} } as MockDraft["responses"][number],
      ],
    };
    await saveDraft(base, "weather.mock.json", edited, opened.mtimeMs);

    const saved = JSON.parse(await readFile(join(root, "weather.mock.json"), "utf8")) as {
      $comment?: string;
      tools: { annotations?: unknown }[];
      responses: { isError?: boolean }[];
    };
    expect(saved.$comment).toBe("손으로 적은 메모");
    expect(saved.tools[0]?.annotations).toEqual({ readOnlyHint: true });
    expect("isError" in (saved.responses[0] ?? {})).toBe(false);

    const client = await connectToSavedMock(join(root, "weather.mock.json"));
    expect(textOf(await client.callTool("get_weather", { city: "Seoul" }))).toEqual({
      temperature: 21.5,
    });
    expect(textOf(await client.callTool("get_weather", { city: "Busan" }))).toEqual({
      temperature: 0,
    });
  });

  it("열어서 그대로 두 번 저장하면 두 번째부터 바이트가 같다", async () => {
    const { base, root } = await startDashboard();
    const file = join(root, "weather.mock.json");
    await writeFile(file, HANDWRITTEN, "utf8");

    const first = await openMock(base, "weather.mock.json");
    await saveDraft(base, "weather.mock.json", first.draft, first.mtimeMs);
    const afterFirst = await readFile(file);

    const second = await openMock(base, "weather.mock.json");
    await saveDraft(base, "weather.mock.json", second.draft, second.mtimeMs);
    expect((await readFile(file)).equals(afterFirst)).toBe(true);
  });
});
