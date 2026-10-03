import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runOptimizeCommand } from "@mcpeak/cli/commands";
import { connectHttp, connectStdio } from "@mcpeak/core";
import { optimize, parseOverlay, renderReport } from "@mcpeak/optimize";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import optimizeMetadata from "../../optimize/package.json";
import type {
  AnalyzeTokensRequest,
  AnalyzeTokensResponse,
  ApiError,
  PutFileRequest,
  PutFileResponse,
} from "../src/api-types.js";
import { type DashboardServer, startDashboardServer } from "../src/index.js";

/**
 * 토큰 탭의 서버 통로(`POST /api/analyze/tokens`, `PUT /api/overlays/<path>`)를 실제 예제 서버에
 * 붙여 HTTP 만으로 관통한다(계획서 §1.3, §7.4). 판정 기준은 `mcpeak optimize` 의 커맨드 함수를
 * 직접 돌린 결과다. 파일명이 `*-e2e.test.ts` 라 러너가 직렬 갈래로 수집한다.
 */
const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const repoRoot = resolve(here, "../../..");
const weatherServer = join(repoRoot, "examples/weather-server/server.mjs");

/** 실서버 기동·tools/list 왕복이 들어가 기본 5초로는 모자랄 수 있다. */
const REAL_SERVER_TIMEOUT_MS = 60_000;

const argv = ["--command", process.execPath, "--arg", weatherServer];

let root: string;
let server: DashboardServer;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "mcpeak-analyze-e2e-"));
  server = await startDashboardServer({ port: 0, root });
});

afterAll(async () => {
  await server?.close();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

async function postAnalyze(body: AnalyzeTokensRequest): Promise<Response> {
  return fetch(`http://127.0.0.1:${server.port}/api/analyze/tokens`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function analyzeOk(): Promise<AnalyzeTokensResponse> {
  const response = await postAnalyze({ argv });
  const text = await response.text();
  expect(response.status, text).toBe(200);
  return JSON.parse(text) as AnalyzeTokensResponse;
}

describe.sequential("analyze tokens e2e (weather-server)", () => {
  it(
    "응답의 overlayText 가 runOptimizeCommand 를 직접 돌린 바이트와 같다",
    async () => {
      const body = await analyzeOk();

      let capturedText: string | undefined;
      let capturedStdout = "";
      let capturedStderr = "";
      const exitCode = await runOptimizeCommand(["--out", "x.json", ...argv], {
        connectStdio,
        connectHttp,
        readEnv: (name) => process.env[name],
        optimize,
        renderReport,
        generatorVersion: optimizeMetadata.version,
        writeFile: async (_path, text) => {
          capturedText = text;
        },
        writeStdout: (text) => {
          capturedStdout += text;
        },
        writeStderr: (text) => {
          capturedStderr += text;
        },
      });
      expect(exitCode, capturedStderr).toBe(0);
      expect(body.overlayText).toBe(capturedText);
      expect(body.report).toBe(capturedStdout);
    },
    REAL_SERVER_TIMEOUT_MS,
  );

  it(
    "같은 요청 두 번의 응답 본문이 바이트 단위로 같다",
    async () => {
      const first = await postAnalyze({ argv });
      const second = await postAnalyze({ argv });
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(await second.text()).toBe(await first.text());
    },
    REAL_SERVER_TIMEOUT_MS,
  );

  it(
    "report 는 renderReport(overlay) 와 같다",
    async () => {
      const body = await analyzeOk();
      expect(body.report).toBe(renderReport(body.overlay));
    },
    REAL_SERVER_TIMEOUT_MS,
  );

  it(
    "저장한 오버레이는 바이트가 같고 parseOverlay 를 통과한다",
    async () => {
      const body = await analyzeOk();
      const request: PutFileRequest = { content: body.overlayText, baseMtimeMs: 0 };
      const response = await fetch(
        `http://127.0.0.1:${server.port}/api/overlays/weather.optimize.json`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        },
      );
      const text = await response.text();
      expect(response.status, text).toBe(200);
      const saved = JSON.parse(text) as PutFileResponse;
      expect(saved.saved).toBe(true);

      const written = await readFile(join(root, "weather.optimize.json"), "utf8");
      expect(written).toBe(body.overlayText);
      expect(() => parseOverlay(JSON.parse(written), "weather.optimize.json")).not.toThrow();
    },
    REAL_SERVER_TIMEOUT_MS,
  );

  it(
    "없는 명령이면 400 이고 CLI 의 연결 실패 문장이 그대로 온다",
    async () => {
      const response = await postAnalyze({ argv: ["--command", "mcpeak-no-such-binary-xyz"] });
      expect(response.status).toBe(400);
      const body = (await response.json()) as ApiError;
      expect(body.error).toMatch(/^오류 \[MCP_CONNECTION_FAILED/);
      expect(body.error).toContain("해결:");
    },
    REAL_SERVER_TIMEOUT_MS,
  );
});
