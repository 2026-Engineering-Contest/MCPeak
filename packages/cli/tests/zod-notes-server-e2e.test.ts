import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectStdio, type ToolDef } from "@mcpeak/core";
import { deriveContractAxes } from "@mcpeak/runner";
import { describe, expect, it, vi } from "vitest";
import { run } from "../src/index.js";

vi.mock("@mcpeak/core", async () => import("../../core/src/index.js"));
vi.mock("@mcpeak/runner", async () => import("../../runner/src/index.js"));
vi.mock("@mcpeak/generate", async () => import("../../generate/src/index.js"));

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const root = resolve(here, "../../..");
const wrapper = join(here, "fixtures/stdio-server-wrapper.mjs");
const server = join(root, "examples/zod-notes-server/server.mjs");
const mutant = join(root, "examples/zod-notes-server/server.mutant.mjs");
const sdkFixture = join(
  root,
  "packages/generate/tests/fixtures/sdk-schemas/zod-4.4.3-sdk-1.30.0.json",
);

const EXAMPLE_ID = "11111111-1111-4111-8111-111111111111";

// 세 값의 근거는 generate-integration-e2e.test.ts 의 같은 상수 주석에 있다. 세 파일의 값을 같게 둔다.
const EXIT_TIMEOUT_MS = 3_000;
const EXIT_POLL_INTERVAL_MS = 20;
const EXIT_MIN_POLLS = 25;

async function exited(pidFile: string): Promise<void> {
  const pid = Number((await readFile(pidFile, "utf8")).trim());
  expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
  const started = Date.now();
  for (let polls = 1; ; polls += 1) {
    try {
      process.kill(pid, 0);
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return;
      throw error;
    }
    const elapsed = Date.now() - started;
    if (polls >= EXIT_MIN_POLLS && elapsed >= EXIT_TIMEOUT_MS)
      throw new Error(
        `zod-notes-server(PID ${pid})가 ${elapsed}ms 동안 ${polls}회 확인에도 종료되지 않았습니다. ` +
          `확인: \`ps -p ${pid}\`로 생존 여부를 보고, examples/zod-notes-server 의 종료 처리와 ` +
          "CLI의 connection close 경로에 좀비 프로세스가 남는지 확인하세요.",
      );
    await new Promise((done) => setTimeout(done, EXIT_POLL_INTERVAL_MS));
  }
}

async function cleanup(pidFile: string): Promise<void> {
  try {
    const pid = Number((await readFile(pidFile, "utf8")).trim());
    if (Number.isSafeInteger(pid) && pid > 0) process.kill(pid, "SIGKILL");
  } catch (error: unknown) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ESRCH")
      )
    )
      throw error;
  }
}

async function listTools(pidFile: string): Promise<ToolDef[]> {
  const connection = await connectStdio({
    command: process.execPath,
    args: [wrapper, pidFile, server],
  });
  try {
    return await connection.client.listTools();
  } finally {
    await connection.close();
  }
}

const generateArgs = (suitePath: string, pidFile: string) => [
  "generate",
  "--suite-id",
  "zod-notes",
  "--name",
  "Zod Notes",
  "--out",
  suitePath,
  "--command",
  process.execPath,
  "--arg",
  wrapper,
  "--arg",
  pidFile,
  "--arg",
  server,
  "--baseline-only",
];

const testArgs = (suitePath: string, pidFile: string, target: string) => [
  "test",
  suitePath,
  "--command",
  process.execPath,
  "--arg",
  wrapper,
  "--arg",
  pidFile,
  "--arg",
  target,
  "--json",
];

/** 정상 케이스 입력. 아래 위반 케이스는 전부 여기서 한 필드만 바꾼 것이다. */
const CREATE_OK = {
  title: "example",
  priority: "low",
  dueAt: "2000-01-01T00:00:00Z",
  author: { name: "example" },
};
const { author: _a, ...CREATE_NO_AUTHOR } = CREATE_OK;
const { dueAt: _d, ...CREATE_NO_DUEAT } = CREATE_OK;
const { priority: _p, ...CREATE_NO_PRIORITY } = CREATE_OK;
const { title: _t, ...CREATE_NO_TITLE } = CREATE_OK;

/** 설계 §6 단언 3 의 표. 순서까지 사양이다. */
const EXPECTED_OPERATIONS = [
  { type: "callTool", tool: "get_note", input: { id: EXAMPLE_ID } },
  { type: "callTool", tool: "get_note", input: {} },
  { type: "callTool", tool: "get_note", input: { id: 0 } },
  {
    type: "callTool",
    tool: "get_note",
    input: { id: EXAMPLE_ID, __mcpeak_undeclared__: "example" },
  },
  { type: "callTool", tool: "create_note", input: CREATE_OK },
  { type: "callTool", tool: "create_note", input: CREATE_NO_AUTHOR },
  { type: "callTool", tool: "create_note", input: CREATE_NO_DUEAT },
  { type: "callTool", tool: "create_note", input: CREATE_NO_PRIORITY },
  { type: "callTool", tool: "create_note", input: CREATE_NO_TITLE },
  { type: "callTool", tool: "create_note", input: { ...CREATE_OK, author: "example" } },
  { type: "callTool", tool: "create_note", input: { ...CREATE_OK, body: 0 } },
  { type: "callTool", tool: "create_note", input: { ...CREATE_OK, dueAt: 0 } },
  { type: "callTool", tool: "create_note", input: { ...CREATE_OK, parentId: 0 } },
  { type: "callTool", tool: "create_note", input: { ...CREATE_OK, priority: 0 } },
  { type: "callTool", tool: "create_note", input: { ...CREATE_OK, tags: "example" } },
  { type: "callTool", tool: "create_note", input: { ...CREATE_OK, title: 0 } },
  {
    type: "callTool",
    tool: "create_note",
    input: { ...CREATE_OK, priority: "__mcpeak_invalid_enum__" },
  },
  {
    type: "callTool",
    tool: "create_note",
    input: { ...CREATE_OK, tags: ["home", "home", "home", "home", "home", "home"] },
  },
  { type: "callTool", tool: "create_note", input: { ...CREATE_OK, title: "" } },
  { type: "callTool", tool: "list_notes", input: {} },
  { type: "callTool", tool: "list_notes", input: { filter: "example" } },
  { type: "callTool", tool: "list_notes", input: { limit: 1.5 } },
  { type: "callTool", tool: "list_notes", input: { limit: 0 } },
];

const EXPECTED_IDS = [
  "get-note-success",
  "get-note-missing-id",
  "get-note-type-id",
  "get-note-undeclared",
  "create-note-success",
  "create-note-missing-author",
  "create-note-missing-dueat",
  "create-note-missing-priority",
  "create-note-missing-title",
  "create-note-type-author",
  "create-note-type-body",
  "create-note-type-dueat",
  "create-note-type-parentid",
  "create-note-type-priority",
  "create-note-type-tags",
  "create-note-type-title",
  "create-note-enum-priority",
  "create-note-range-tags",
  "create-note-range-title",
  "list-notes-success",
  "list-notes-type-filter",
  "list-notes-type-limit",
  "list-notes-range-limit",
];

describe.sequential("zod-notes-server (McpServer + zod) 실서버 E2E", () => {
  it("기동·핸드셰이크·tools/list 가 실제로 되고 SDK 변환 스키마가 고정 파일과 같다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcpeak-zod-notes-"));
    const pidFile = join(directory, "server.pid");
    try {
      const tools = await listTools(pidFile);
      expect(tools.map((tool) => tool.name)).toEqual(["get_note", "create_note", "list_notes"]);

      const getNote = tools[0]?.inputSchema as {
        additionalProperties?: unknown;
        properties: { id: { format?: string; pattern?: string; examples?: unknown } };
      };
      const createNote = tools[1]?.inputSchema as {
        properties: { dueAt: { anyOf: { type?: string; format?: string; pattern?: string }[] } };
      };
      expect(getNote.additionalProperties).toBe(false);
      expect(getNote.properties.id.format).toBe("uuid");
      expect(getNote.properties.id.examples).toEqual([EXAMPLE_ID]);
      expect(createNote.properties.dueAt.anyOf).toHaveLength(2);
      expect(createNote.properties.dueAt.anyOf[1]).toEqual({ type: "null" });
      expect(createNote.properties.dueAt.anyOf[0]?.format).toBe("date-time");

      const fixture = JSON.parse(await readFile(sdkFixture, "utf8")) as {
        supported: {
          name: string;
          inputSchema: { properties: Record<string, { pattern?: string }> };
        }[];
      };
      const shapes = fixture.supported[0];
      expect(shapes?.name).toBe("shapes");
      const drift =
        "실서버가 낸 pattern 이 고정 파일과 다릅니다. SDK 나 zod 가 바뀌어 실측 스키마가 달라졌다면 " +
        "packages/generate/tests/fixtures/sdk-schemas/ 의 파일을 다시 재고 파일명의 버전을 갱신하세요. " +
        "예제나 이 테스트를 고쳐 맞추지 마세요.";
      expect(getNote.properties.id.pattern, drift).toBe(shapes?.inputSchema.properties.id?.pattern);
      expect(createNote.properties.dueAt.anyOf[0]?.pattern, drift).toBe(
        shapes?.inputSchema.properties.when?.pattern,
      );
      await exited(pidFile);
    } finally {
      await cleanup(pidFile);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("generate --baseline-only 가 세 툴 전부에서 23 케이스를 결정론적으로 만든다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcpeak-zod-notes-"));
    const pidFile = join(directory, "server.pid");
    const secondPidFile = join(directory, "server-2.pid");
    const axisPidFile = join(directory, "axis-count.pid");
    const suitePath = join(directory, "baseline.json");
    const secondPath = join(directory, "baseline-2.json");
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(await run(generateArgs(suitePath, pidFile))).toBe(0);
      expect(err).not.toHaveBeenCalled();
      const suite = JSON.parse(await readFile(suitePath, "utf8")) as {
        cases: { id: string; operation: unknown }[];
      };
      // 상수 23 과 선언에서 센 축 수를 둘 다 본다. 하나만 보면 "선언이 바뀌었다" 와 "생성이 깨졌다" 가
      // 구분되지 않는다(generate-integration-e2e.test.ts 와 같은 이유).
      expect(suite.cases).toHaveLength(23);
      const tools = await listTools(axisPidFile);
      expect(suite.cases).toHaveLength(
        tools.reduce((sum, tool) => sum + deriveContractAxes(tool).axes.length, 0),
      );
      expect(suite.cases.map((item) => item.id)).toEqual(EXPECTED_IDS);
      expect(suite.cases.map((item) => item.operation)).toEqual(EXPECTED_OPERATIONS);

      // 결정론. 같은 입력의 두 번째 실행이 바이트까지 같아야 한다.
      expect(await run(generateArgs(secondPath, secondPidFile))).toBe(0);
      expect(
        await readFile(secondPath, "utf8"),
        "같은 서버로 두 번 생성한 명세가 다릅니다. 타임스탬프·랜덤·순서 의존이 들어간 것입니다.",
      ).toBe(await readFile(suitePath, "utf8"));

      await exited(pidFile);
      await exited(secondPidFile);
      await exited(axisPidFile);
    } finally {
      out.mockRestore();
      err.mockRestore();
      await cleanup(pidFile);
      await cleanup(secondPidFile);
      await cleanup(axisPidFile);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("정상 서버는 23 케이스 전부 통과하고 변이 서버는 정확히 그 4 케이스에서 실패한다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcpeak-zod-notes-"));
    const generatePid = join(directory, "generate.pid");
    const okPid = join(directory, "ok.pid");
    const mutantPid = join(directory, "mutant.pid");
    const suitePath = join(directory, "baseline.json");
    const outputs: string[] = [];
    const out = vi.spyOn(process.stdout, "write").mockImplementation((text) => {
      outputs.push(String(text));
      return true;
    });
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(await run(generateArgs(suitePath, generatePid))).toBe(0);
      outputs.length = 0;

      expect(await run(testArgs(suitePath, okPid, server))).toBe(0);
      const okReport = JSON.parse(outputs.join("")) as {
        summary: Record<string, number>;
        cases: { spec: { id: string }; status: string }[];
      };
      expect(okReport.summary).toEqual({
        total: 23,
        passed: 23,
        failed: 0,
        timedOut: 0,
        cancelled: 0,
        notRun: 0,
        // McpServer 는 zod 검증 실패를 -32602 로 돌려주고 runner 가 그것을 verified 로 읽는다.
        // weather-server 의 손으로 쓴 거절 문장과 달리 여기서는 0 이어야 한다.
        rejectionUnverified: 0,
      });
      expect(err).not.toHaveBeenCalled();
      outputs.length = 0;

      expect(await run(testArgs(suitePath, mutantPid, mutant))).toBe(1);
      const mutantReport = JSON.parse(outputs.join("")) as {
        summary: Record<string, number>;
        cases: { spec: { id: string }; status: string }[];
      };
      expect(mutantReport.summary).toEqual({
        total: 23,
        passed: 19,
        failed: 4,
        timedOut: 0,
        cancelled: 0,
        notRun: 0,
        // 거절해야 할 입력을 받아들인 4건은 거절 근거를 확인할 수 없다.
        rejectionUnverified: 4,
      });
      expect(
        mutantReport.cases.filter((item) => item.status === "failed").map((item) => item.spec.id),
        "변이 서버에서 실패해야 할 케이스가 다릅니다. 빠진 id 의 축은 우리 도구가 검출력을 잃은 것이고, " +
          "늘어난 id 는 예제나 변이 서버가 설계 §5.2 와 다르게 바뀐 것입니다.",
      ).toEqual([
        "create-note-enum-priority",
        "create-note-range-title",
        "list-notes-type-limit",
        "list-notes-range-limit",
      ]);

      await exited(generatePid);
      await exited(okPid);
      await exited(mutantPid);
    } finally {
      out.mockRestore();
      err.mockRestore();
      await cleanup(generatePid);
      await cleanup(okPid);
      await cleanup(mutantPid);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
