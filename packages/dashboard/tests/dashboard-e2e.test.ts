import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  FileEntry,
  PendingQuestion,
  RunEvent,
  StartRunRequest,
  StartRunResponse,
} from "../src/api-types.js";
import { type DashboardServer, startDashboardServer } from "../src/index.js";

/**
 * 대시보드 서버 - `@mcpeak/cli/commands` - 실제 MCP 서버 통로를 HTTP 만으로 관통한다.
 * 브라우저는 띄우지 않는다. 프론트 로직은 `web/tests` 의 유닛이 검증하고, 여기서 보는 것은
 * 그 아래 통로다. 파일명이 `*-e2e.test.ts` 라 러너가 직렬 갈래로 수집한다.
 */
const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const root = resolve(here, "../../..");
const weatherServer = join(root, "examples/weather-server/server.mjs");
const approvedSuite = join(root, "packages/cli/tests/fixtures/weather-suite.json");

/** 실서버 기동·8케이스 실행·교정 재실행이 겹치는 구간이 있어 기본 5초로는 모자란다. */
const REAL_SERVER_TIMEOUT_MS = 60_000;

interface RunOutcome {
  /** `done` 까지 받은 이벤트 전량. 순서 그대로다. */
  readonly events: readonly RunEvent[];
  /** SSE 원문. 결정론 단언이 이 바이트를 비교한다. */
  readonly raw: string;
  readonly exitCode: number;
}

/** 질문 종류별 답. 없으면 choose 는 `cancel`, input 은 빈 문자열, confirm 은 `y` 다. */
interface AnswerScript {
  readonly choices?: string[];
  readonly inputs?: string[];
}

function answerFor(question: PendingQuestion, script: AnswerScript): string {
  switch (question.kind) {
    case "choose":
      return script.choices?.shift() ?? "cancel";
    case "input":
      return script.inputs?.shift() ?? "";
    case "confirm":
      return "y";
  }
}

async function startRun(server: DashboardServer, body: StartRunRequest): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${server.port}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  const started = (await response.json()) as StartRunResponse;
  return started.runId;
}

/**
 * SSE 를 끝까지 읽으면서 질문이 오면 `POST /answer` 로 답한다. `done` 을 받으면 끊는다.
 *
 * 과거 이벤트 재전송이 있으므로 POST 뒤에 구독해도 앞부분을 놓치지 않는다(§4-4).
 */
async function drainRun(
  server: DashboardServer,
  runId: string,
  script: AnswerScript = {},
): Promise<RunOutcome> {
  const response = await fetch(`http://127.0.0.1:${server.port}/api/runs/${runId}/events`);
  expect(response.status).toBe(200);
  const body = response.body;
  if (body === null) throw new Error("SSE 응답에 본문이 없습니다.");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const events: RunEvent[] = [];
  let raw = "";
  let buffer = "";
  let exitCode: number | null = null;

  try {
    while (exitCode === null) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error(`SSE 가 done 이벤트 없이 끊겼습니다. 수신: ${raw}`);
      const text = decoder.decode(chunk.value, { stream: true });
      raw += text;
      buffer += text;
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame.split("\n").find((line) => line.startsWith("data: "));
        if (data === undefined) throw new Error(`SSE data 프레임이 없습니다: ${frame}`);
        const event = JSON.parse(data.slice("data: ".length)) as RunEvent;
        events.push(event);
        if (event.kind === "question") {
          const value = answerFor(event.question, script);
          const answered = await fetch(`http://127.0.0.1:${server.port}/api/runs/${runId}/answer`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ questionId: event.question.id, value }),
          });
          expect(answered.status).toBe(204);
        }
        if (event.kind === "done") exitCode = event.exitCode;
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    await reader.cancel();
  }
  return { events, raw, exitCode };
}

/** 어떤 이벤트에도 나오면 안 되는 값(runId·시각)이 새지 않았는지 본다. */
function stdoutText(events: readonly RunEvent[]): string {
  return events
    .filter((event) => event.kind === "stdout" || event.kind === "stderr")
    .map((event) => (event.kind === "stdout" || event.kind === "stderr" ? event.html : ""))
    .join("");
}

describe.sequential("대시보드 실서버 관통", () => {
  it(
    "test 플로우가 실서버로 통과한다",
    async () => {
      const server = await startDashboardServer({ port: 0, root });
      try {
        const runId = await startRun(server, {
          flow: "test",
          argv: ["test", approvedSuite, "--command", process.execPath, "--arg", weatherServer],
        });
        const outcome = await drainRun(server, runId);
        expect(outcome.exitCode).toBe(0);
        expect(stdoutText(outcome.events)).not.toBe("");
      } finally {
        await server.close();
      }
    },
    REAL_SERVER_TIMEOUT_MS,
  );

  it(
    "suites 목록에 weather-server 스위트가 보인다",
    async () => {
      const server = await startDashboardServer({ port: 0, root });
      try {
        const response = await fetch(`http://127.0.0.1:${server.port}/api/suites`);
        expect(response.status).toBe(200);
        const entries = (await response.json()) as FileEntry[];
        expect(entries.map((entry) => entry.path)).toContain(
          "packages/cli/tests/fixtures/weather-suite.json",
        );
      } finally {
        await server.close();
      }
    },
    REAL_SERVER_TIMEOUT_MS,
  );

  it(
    "generate 플로우가 dry-run 질문을 내고 승인까지 간다",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "mcpeak-dashboard-e2e-"));
      const server = await startDashboardServer({ port: 0, root });
      const outPath = join(directory, "generated.json");
      try {
        const runId = await startRun(server, {
          flow: "generate",
          argv: [
            "generate",
            "--suite-id",
            "weather",
            "--name",
            "Weather",
            "--out",
            outPath,
            "--command",
            process.execPath,
            "--arg",
            weatherServer,
          ],
        });
        // baseline 합성값 city "example" 을 weather-server 가 거절하므로 교정 질문이 온다.
        // `서울` 로 고치면 그 케이스만 다시 실행되고 승인까지 이어진다.
        const outcome = await drainRun(server, runId, {
          choices: ["save"],
          inputs: ["서울"],
        });
        expect(outcome.exitCode).toBe(0);
        expect(outcome.events.some((event) => event.kind === "question")).toBe(true);
        const saved = JSON.parse(await readFile(outPath, "utf8")) as {
          approval: { cases?: { status: string }[] };
        };
        expect(saved.approval.cases?.every((item) => item.status === "passed")).toBe(true);
      } finally {
        await server.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
    REAL_SERVER_TIMEOUT_MS,
  );

  it(
    "replay 플로우가 카세트로 서버 없이 통과한다",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "mcpeak-dashboard-e2e-"));
      const server = await startDashboardServer({ port: 0, root });
      const outPath = join(directory, "recorded-suite.json");
      const cassettePath = join(directory, "weather.cassette.json");
      try {
        const generateRunId = await startRun(server, {
          flow: "generate",
          argv: [
            "generate",
            "--suite-id",
            "weather",
            "--name",
            "Weather",
            "--out",
            outPath,
            "--command",
            process.execPath,
            "--arg",
            weatherServer,
            "--cassette",
            cassettePath,
            "--record",
          ],
        });
        const generated = await drainRun(server, generateRunId, {
          choices: ["save"],
          inputs: ["서울"],
        });
        expect(generated.exitCode).toBe(0);

        const replayArgv = ["replay", outPath, "--cassette", cassettePath];
        const first = await drainRun(
          server,
          await startRun(server, { flow: "replay", argv: replayArgv }),
        );
        expect(first.exitCode).toBe(0);

        // 같은 요청 2회의 SSE 원문이 바이트까지 같아야 한다. 이벤트에 runId·시각이 실리면
        // 여기서 깨진다. 재생 결정론과 이벤트 무상태성을 한 번에 잡는 단언이다.
        const second = await drainRun(
          server,
          await startRun(server, { flow: "replay", argv: replayArgv }),
        );
        expect(second.raw).toBe(first.raw);
      } finally {
        await server.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
    REAL_SERVER_TIMEOUT_MS,
  );

  /**
   * 아래 두 건은 프론트가 실제로 보내는 argv 형태다(§5 T4: 서브커맨드를 붙이지 않는다).
   * 위 케이스들은 cli 형태로 보내고 있어 T5까지 이 결함을 못 잡았다. 계획서 §5 T6.
   */
  it(
    "test 플로우가 프론트 argv 형태로도 통과한다",
    async () => {
      const server = await startDashboardServer({ port: 0, root });
      try {
        const runId = await startRun(server, {
          flow: "test",
          // 앞의 "test" 가 없다. 서버가 붙여야 `runCli` 가 스위트를 본다.
          argv: [approvedSuite, "--command", process.execPath, "--arg", weatherServer],
        });
        const outcome = await drainRun(server, runId);
        expect(outcome.exitCode).toBe(0);
        expect(stdoutText(outcome.events)).not.toBe("");
      } finally {
        await server.close();
      }
    },
    REAL_SERVER_TIMEOUT_MS,
  );

  it(
    "replay 플로우가 프론트 argv 형태로도 통과한다",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "mcpeak-dashboard-e2e-"));
      const server = await startDashboardServer({ port: 0, root });
      const outPath = join(directory, "recorded-suite.json");
      const cassettePath = join(directory, "weather.cassette.json");
      try {
        const generateRunId = await startRun(server, {
          flow: "generate",
          argv: [
            "generate",
            "--suite-id",
            "weather",
            "--name",
            "Weather",
            "--out",
            outPath,
            "--command",
            process.execPath,
            "--arg",
            weatherServer,
            "--cassette",
            cassettePath,
            "--record",
          ],
        });
        const generated = await drainRun(server, generateRunId, {
          choices: ["save"],
          inputs: ["서울"],
        });
        expect(generated.exitCode).toBe(0);

        // 앞의 "replay" 가 없다. 무조건 slice(1) 하면 여기서 스위트 경로가 사라진다.
        const outcome = await drainRun(
          server,
          await startRun(server, {
            flow: "replay",
            argv: [outPath, "--cassette", cassettePath],
          }),
        );
        expect(outcome.exitCode).toBe(0);
      } finally {
        await server.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
    REAL_SERVER_TIMEOUT_MS,
  );
});
