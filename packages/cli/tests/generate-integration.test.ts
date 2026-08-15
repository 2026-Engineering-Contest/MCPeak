import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectStdio } from "@ohmymcp/core";
import {
  applyAuthoringChanges,
  createAuthoringDiff,
  createAuthoringSession,
  createBaselineSuite,
  dispatchAuthoringRequest,
  finalizeAuthoringDraft,
  getAuthoringExecutionSuite,
  prepareAuthoringRequest,
  reviewLocalAuthoringCandidate,
} from "@ohmymcp/generate";
import { deriveContractAxes, validateMcpSuite } from "@ohmymcp/runner";
import { describe, expect, it, vi } from "vitest";
import { nodeGenerateDependencies, runGenerateCommand } from "../src/generate-command.js";
import { run } from "../src/index.js";

vi.mock("@ohmymcp/core", async () => import("../../core/src/index.js"));
vi.mock("@ohmymcp/runner", async () => import("../../runner/src/index.js"));
vi.mock("@ohmymcp/generate", async () => import("../../generate/src/index.js"));

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const root = resolve(here, "../../..");
const wrapper = join(here, "fixtures/stdio-server-wrapper.mjs");
const server = join(root, "examples/weather-server/server.mjs");

/**
 * 프로세스 종료 판정은 조건(ESRCH) 폴링이고, 아래 세 값은 안전장치일 뿐이다. 실측 근거:
 * 15코어를 전부 포화시킨 부하(`yes > /dev/null` × 15)에서 60회 측정한 실제 종료 지연은
 * 최대 1ms였다(58회는 0ms). 이 함수를 부르는 시점에는 CLI가 자식의 종료를 이미 await한 뒤라
 * 정상 경로는 첫 폴링에서 끝난다. 기존 값 1초에는 근거가 없었다.
 */
// 실측 최악값(1ms)의 3000배. vitest 기본 테스트 타임아웃(5초)보다 짧아야 vitest의 무의미한
// 타임아웃 메시지 대신 아래 진단 메시지가 먼저 나온다.
const EXIT_TIMEOUT_MS = 3_000;
// 정상 경로는 첫 폴링에서 끝나므로 이 값은 비정상 상황에서만 의미가 있다. 20ms면 3초 동안
// 150회를 확인하면서 spin으로 CPU를 뺏지 않는다.
const EXIT_POLL_INTERVAL_MS = 20;
// 부하로 이벤트 루프가 밀리면 폴링을 몇 번 못 한 채 벽시계 마감만 지날 수 있다. 그것이 이
// 테스트가 흔들리던 방식이므로, 최소 이 횟수는 실제로 확인한 뒤에만 실패로 판정한다.
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
        `weather-server(PID ${pid})가 ${elapsed}ms 동안 ${polls}회 확인에도 종료되지 않았습니다. ` +
          `확인: \`ps -p ${pid}\`로 생존 여부를 보고, examples/weather-server/server.mjs의 종료 처리와 ` +
          "CLI의 connection close 경로에 좀비 프로세스가 남는지 확인하세요.",
      );
    await new Promise((done) => setTimeout(done, EXIT_POLL_INTERVAL_MS));
  }
}

/**
 * 서버 선언에서 직접 센 축 수. 케이스 수를 상수로만 박으면 `examples` 서버 선언이 바뀌었을 때
 * "선언이 바뀌었다" 와 "생성이 깨졌다" 가 구분되지 않는다. 축 하나에 케이스 하나가 대응하므로
 * (HAPPY_PATH 축은 정상 케이스에 대응한다) 이 수가 곧 기대 케이스 수다.
 */
async function declaredAxisCount(pidFile: string): Promise<number> {
  const connection = await connectStdio({
    command: process.execPath,
    args: [wrapper, pidFile, server],
  });
  try {
    const tools = await connection.client.listTools();
    return tools.reduce((sum, tool) => sum + deriveContractAxes(tool).axes.length, 0);
  } finally {
    await connection.close();
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

describe.sequential("generate 실제 weather-server", () => {
  it("weather-server에서 baseline JSON을 만들고 process를 종료한다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ohmymcp-generate-"));
    const pidFile = join(directory, "server.pid");
    // 축 수를 세는 연결은 pid 파일을 따로 쓴다. 같은 파일을 쓰면 아래 exited 가 어느 프로세스를
    // 본 것인지 흐려진다.
    const axisPidFile = join(directory, "axis-count.pid");
    const suitePath = join(directory, "baseline.json");
    try {
      expect(
        await run([
          "generate",
          "--suite-id",
          "weather",
          "--name",
          "Weather",
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
        ]),
      ).toBe(0);
      const suite = JSON.parse(await readFile(suitePath, "utf8"));
      // 케이스 수를 상수로만 박으면 examples 서버 선언이 바뀌었을 때 "선언이 바뀌었다" 와
      // "생성이 깨졌다" 가 구분되지 않는다. 서버 선언에서 센 축 수와도 맞춰 본다.
      // HAPPY_PATH 축 하나가 정상 케이스 하나에 대응하므로 축 총수가 곧 케이스 수다.
      expect(suite.cases).toHaveLength(8);
      expect(suite.cases).toHaveLength(await declaredAxisCount(axisPidFile));
      expect(suite.cases.map((item: { operation: unknown }) => item.operation)).toEqual([
        { type: "callTool", tool: "get_weather", input: { city: "example" } },
        { type: "callTool", tool: "get_weather", input: {} },
        { type: "callTool", tool: "get_weather", input: { city: 0 } },
        { type: "callTool", tool: "add", input: { a: 0, b: 0 } },
        { type: "callTool", tool: "add", input: { b: 0 } },
        { type: "callTool", tool: "add", input: { a: 0 } },
        { type: "callTool", tool: "add", input: { a: "example", b: 0 } },
        { type: "callTool", tool: "add", input: { a: 0, b: "example" } },
      ]);
      await exited(pidFile);
      await exited(axisPidFile);
    } finally {
      await cleanup(pidFile);
      await cleanup(axisPidFile);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("weather baseline은 실제 test에서 신뢰도 한계를 드러낸다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ohmymcp-generate-"));
    const pidFile = join(directory, "server.pid");
    const suitePath = join(directory, "baseline.json");
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(
        await run([
          "generate",
          "--suite-id",
          "weather",
          "--name",
          "Weather",
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
        ]),
      ).toBe(0);
      out.mockClear();
      expect(
        await run([
          "test",
          suitePath,
          "--command",
          process.execPath,
          "--arg",
          wrapper,
          "--arg",
          pidFile,
          "--arg",
          server,
          "--json",
        ]),
      ).toBe(1);
      const report = JSON.parse(out.mock.calls.map(([value]) => String(value)).join(""));
      expect(report.summary).toEqual({
        total: 8,
        passed: 7,
        failed: 1,
        timedOut: 0,
        cancelled: 0,
        notRun: 0,
      });
      // weather-server 는 이미 입력을 검증하므로(typeof city !== "string",
      // typeof a !== "number" || typeof b !== "number") 위반 케이스 6개가 모두 통과한다.
      expect(report.cases.map((item: { status: string }) => item.status)).toEqual([
        "failed", // get-weather-success  city "example" 이 WEATHER 에 없다. 도메인 값 문제(§2 비범위)
        "passed", // get-weather-missing-city
        "passed", // get-weather-type-city
        "passed", // add-success
        "passed", // add-missing-a
        "passed", // add-missing-b
        "passed", // add-type-a
        "passed", // add-type-b
      ]);
      expect(err).not.toHaveBeenCalled();
      await exited(pidFile);
    } finally {
      out.mockRestore();
      err.mockRestore();
      await cleanup(pidFile);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("실행할 수 없는 server command는 안전한 Core 오류가 된다", async () => {
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(
        await run([
          "generate",
          "--suite-id",
          "weather",
          "--name",
          "Weather",
          "--out",
          "/tmp/weather.json",
          "--command",
          "ohmymcp-no-command",
          "--baseline-only",
        ]),
      ).toBe(1);
      expect(err.mock.calls.map(([value]) => String(value)).join("")).not.toMatch(
        /ENOENT|Error:|at /,
      );
    } finally {
      err.mockRestore();
    }
  });

  it("입력값 교정으로 고친 값이 실제 서버 명세에 남는다", async () => {
    // baseline 합성값 city "example" 은 weather-server 가 거절한다. 교정 단계가 사람에게 값을
    // 받아 그 케이스만 다시 실행하고, 통과한 값이 저장된 명세에 반영되는지 실제 서버로 본다.
    const directory = await mkdtemp(join(tmpdir(), "ohmymcp-generate-"));
    const pidFile = join(directory, "server.pid");
    const suitePath = join(directory, "repaired.json");
    const outputs: string[] = [];
    const choices = ["save"];
    const inputs = ["서울"];
    const io = {
      interactive: true,
      choose: vi.fn(async () => choices.shift() ?? "cancel"),
      input: vi.fn(async () => inputs.shift() ?? ""),
      confirm: vi.fn(async () => true),
      write: vi.fn(),
    };
    try {
      expect(
        await runGenerateCommand(
          [
            "generate",
            "--suite-id",
            "weather",
            "--name",
            "Weather",
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
          ],
          {
            ...nodeGenerateDependencies(),
            connect: connectStdio,
            createBaselineSuite,
            createAuthoringSession,
            finalizeAuthoringDraft,
            getAuthoringExecutionSuite,
            validateSuite: validateMcpSuite,
            reviewIO: io,
            prepareAuthoringRequest,
            dispatchAuthoringRequest,
            createAuthoringDiff,
            applyAuthoringChanges,
            reviewLocalAuthoringCandidate,
          },
        ),
      ).toBe(0);
      const saved = JSON.parse(await readFile(suitePath, "utf8")) as {
        cases: { id: string; operation: { tool?: string; input?: { city?: unknown } } }[];
        approval: { fingerprint: string; cases?: { id: string; status: string }[] };
      };
      const repaired = saved.cases.find((item) => item.operation.input?.city !== undefined);
      expect(repaired?.operation.input?.city).toBe("서울");
      // 교정으로 통과했으므로 분류를 묻지 않고 전부 passed 로 실린다(§6.3).
      expect(saved.approval.cases?.every((item) => item.status === "passed")).toBe(true);
      const out = vi.spyOn(process.stdout, "write").mockImplementation((text) => {
        outputs.push(String(text));
        return true;
      });
      const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        expect(
          await run([
            "test",
            suitePath,
            "--command",
            process.execPath,
            "--arg",
            wrapper,
            "--arg",
            pidFile,
            "--arg",
            server,
            "--json",
          ]),
        ).toBe(0);
        expect(JSON.parse(outputs.join("")).summary.failed).toBe(0);
      } finally {
        out.mockRestore();
        err.mockRestore();
      }
      await exited(pidFile);
    } finally {
      await cleanup(pidFile);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("사용자 지시를 반영한 승인 candidate는 실제 test를 통과한다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ohmymcp-generate-"));
    const pidFile = join(directory, "server.pid");
    const suitePath = join(directory, "approved.json");
    const outputs: string[] = [];
    const choices = ["codex", "apply-all", "save"];
    const inputs = ["", "서울을 정상 도시로 사용"];
    const io = {
      interactive: true,
      choose: vi.fn(async () => choices.shift() ?? "cancel"),
      input: vi.fn(async () => inputs.shift() ?? ""),
      confirm: vi.fn(async () => true),
      write: vi.fn(),
    };
    const provider = {
      id: "codex" as const,
      model: "gpt-5.6-luna",
      author: vi.fn(async (request: import("@ohmymcp/generate").AuthoringRequest) => ({
        status: "candidate" as const,
        suite: {
          ...request.candidate,
          // 정상 응답을 기대하는 케이스만 고친다. 위반 케이스까지 정상 입력으로 바꾸면
          // 서버가 거절하지 않아 그 케이스가 실패한다. AI 가 고칠 것은 도메인 값이지
          // 위반 케이스의 목적이 아니다.
          cases: request.candidate.cases.map((item) =>
            item.operation &&
            typeof item.operation === "object" &&
            (item.operation as { tool?: string }).tool === "get_weather" &&
            (item.assertions as readonly { type: string; expected?: unknown }[]).some(
              (assertion) => assertion.type === "isError" && assertion.expected === false,
            )
              ? { ...item, operation: { ...(item.operation as object), input: { city: "서울" } } }
              : item,
          ),
        },
        summary: "서울을 사용합니다.",
        warnings: [],
        questions: [],
      })),
    };
    try {
      expect(
        await runGenerateCommand(
          [
            "generate",
            "--suite-id",
            "weather",
            "--name",
            "Weather",
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
          ],
          {
            ...nodeGenerateDependencies(),
            connect: connectStdio,
            createBaselineSuite,
            createAuthoringSession,
            finalizeAuthoringDraft,
            getAuthoringExecutionSuite,
            validateSuite: validateMcpSuite,
            reviewIO: io,
            providers: { codex: () => provider },
            prepareAuthoringRequest,
            dispatchAuthoringRequest,
            createAuthoringDiff,
            applyAuthoringChanges,
            reviewLocalAuthoringCandidate,
          },
        ),
      ).toBe(0);
      expect(provider.author).toHaveBeenCalledOnce();
      // 셋은 기존(요청 전송·변경 적용·저장)이고 넷째가 시험 실행 고지다. 이 서버는 케이스가
      // 전부 통과하므로 분류는 묻지 않는다.
      expect(io.confirm).toHaveBeenCalledTimes(4);
      // 실제 서버에 돌린 결과가 승인 기록으로 남는다. 지문은 approval 을 제외해 계산하므로
      // 이것이 실려도 저장 직후 재검증 세 조건이 그대로 성립한다.
      const saved = JSON.parse(await readFile(suitePath, "utf8")) as {
        cases: { id: string }[];
        approval: { fingerprint: string; cases?: { id: string; status: string }[] };
      };
      expect(saved.approval.cases?.map((item) => item.id)).toEqual(
        saved.cases.map((item) => item.id),
      );
      expect(saved.approval.cases?.every((item) => item.status === "passed")).toBe(true);
      const out = vi.spyOn(process.stdout, "write").mockImplementation((text) => {
        outputs.push(String(text));
        return true;
      });
      const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        expect(
          await run([
            "test",
            suitePath,
            "--command",
            process.execPath,
            "--arg",
            wrapper,
            "--arg",
            pidFile,
            "--arg",
            server,
            "--json",
          ]),
        ).toBe(0);
        expect(JSON.parse(outputs.join("")).summary).toEqual({
          total: 8,
          passed: 8,
          failed: 0,
          timedOut: 0,
          cancelled: 0,
          notRun: 0,
        });
        expect(err).not.toHaveBeenCalled();
      } finally {
        out.mockRestore();
        err.mockRestore();
      }
      await exited(pidFile);
    } finally {
      await cleanup(pidFile);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
