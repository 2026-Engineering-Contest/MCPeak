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
import { validateMcpSuite } from "@ohmymcp/runner";
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

async function exited(pidFile: string): Promise<void> {
  const pid = Number((await readFile(pidFile, "utf8")).trim());
  expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
  const deadline = Date.now() + 1_000;
  while (true) {
    try {
      process.kill(pid, 0);
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return;
      throw error;
    }
    if (Date.now() >= deadline)
      throw new Error("weather-server PID가 1초 안에 종료되지 않았습니다.");
    await new Promise((done) => setTimeout(done, 20));
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
      expect(suite.cases).toHaveLength(2);
      expect(suite.cases.map((item: { operation: unknown }) => item.operation)).toEqual([
        { type: "callTool", tool: "get_weather", input: { city: "example" } },
        { type: "callTool", tool: "add", input: { a: 0, b: 0 } },
      ]);
      await exited(pidFile);
    } finally {
      await cleanup(pidFile);
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
        ]),
      ).toBe(1);
      const report = JSON.parse(out.mock.calls.map(([value]) => String(value)).join(""));
      expect(report.summary).toEqual({
        total: 2,
        passed: 1,
        failed: 1,
        timedOut: 0,
        cancelled: 0,
        notRun: 0,
      });
      expect(report.cases.map((item: { status: string }) => item.status)).toEqual([
        "failed",
        "passed",
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
          cases: request.candidate.cases.map((item) =>
            item.operation &&
            typeof item.operation === "object" &&
            (item.operation as { tool?: string }).tool === "get_weather"
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
      expect(io.confirm).toHaveBeenCalledTimes(3);
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
          ]),
        ).toBe(0);
        expect(JSON.parse(outputs.join("")).summary).toEqual({
          total: 2,
          passed: 2,
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
