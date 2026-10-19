import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { childEnvironment, PERF_TRACE_DIR_ENV } from "../src/child-env.js";
import { readTrace } from "../src/trace.js";
import type { TraceEntry } from "../src/types.js";

/** `/slow` 의 전체 본문. 앞부분은 즉시, 뒷부분은 150ms 뒤에 간다. */
const FULL = '{"part":"one","tail":"two"}';
const TAIL_DELAY_MS = 150;

const FIXTURE = fileURLToPath(new URL("./fixtures/preload-child.mjs", import.meta.url));

type Start = Extract<TraceEntry, { kind: "start" }>;
type End = Extract<TraceEntry, { kind: "end" }>;

let server: Server;
let origin: string;
const dirs: string[] = [];

async function freshTraceDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mcpeak-perf-preload-"));
  dirs.push(dir);
  return dir;
}

/** `process.env` 에서 `NODE_OPTIONS` 를 뺀 것에 `childEnvironment` 를 얹는다. */
function childEnv(traceDir: string): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key !== "NODE_OPTIONS" && value !== undefined) base[key] = value;
  }
  return { ...base, ...childEnvironment({ traceDir }) };
}

function runChild(
  mode: "fetch" | "http" | "env",
  env: Record<string, string>,
): Promise<{ stdout: string; stderr: string; code: number | null; pid: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [FIXTURE, mode, origin], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const pid = child.pid;
    if (pid === undefined) {
      reject(new Error("자식을 띄우지 못했습니다"));
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code, pid }));
  });
}

function starts(entries: readonly TraceEntry[], via: Start["via"]): Start[] {
  return entries.filter((entry): entry is Start => entry.kind === "start" && entry.via === via);
}

function endOf(entries: readonly TraceEntry[], start: Start): End[] {
  return entries.filter(
    (entry): entry is End =>
      entry.kind === "end" && entry.pid === start.pid && entry.seq === start.seq,
  );
}

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/slow") {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"part":"one",');
      setTimeout(() => res.end('"tail":"two"}'), TAIL_DELAY_MS);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("루프백 주소가 없습니다");
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe.sequential("preload", () => {
  it("fetch 의 끝 시각은 헤더가 아니라 본문 끝이다", async () => {
    const traceDir = await freshTraceDir();
    const result = await runChild("fetch", childEnv(traceDir));
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(FULL);

    const { entries, skippedLines } = await readTrace(traceDir);
    expect(skippedLines).toBe(0);
    expect(entries.filter((entry) => entry.kind === "hello")).toHaveLength(1);

    const fetchStarts = starts(entries, "fetch");
    expect(fetchStarts).toHaveLength(1);
    const start = fetchStarts[0] as Start;
    expect(start.method).toBe("GET");
    expect(start.url).toBe(`${origin}/slow`);
    expect(start.pid).toBe(result.pid);

    const ends = endOf(entries, start);
    expect(ends).toHaveLength(1);
    const end = ends[0] as End;
    expect(end.bodyEnd).toBe(true);
    expect(end.status).toBe(200);
    expect(end.responseBody).toBe(FULL);
    expect(end.responseBodyTruncated).toBeUndefined();
    expect(end.error).toBeUndefined();
    expect(end.tHeaders).toBeTypeOf("number");
    expect(end.tEnd - (end.tHeaders as number)).toBeGreaterThanOrEqual(100);
    expect(start.t0).toBeLessThanOrEqual(end.tHeaders as number);
  });

  it("fetch 안에서 생긴 undici 항목은 parentFetch 를 갖는다", async () => {
    const traceDir = await freshTraceDir();
    const result = await runChild("fetch", childEnv(traceDir));
    expect(result.stdout).toBe(FULL);

    const { entries } = await readTrace(traceDir);
    const fetchStart = starts(entries, "fetch")[0] as Start;
    const undiciStarts = starts(entries, "undici");
    // 0줄이면 통과한다. Node 22 에서는 채널이 없을 수 있다. 개수는 보고서에 적는다.
    process.stderr.write(`[preload-e2e] undici start 줄 수: ${undiciStarts.length}\n`);
    for (const undiciStart of undiciStarts) {
      expect(undiciStart.parentFetch).toBe(fetchStart.seq);
      expect(undiciStart.url).toBe(`${origin}/slow`);
    }
  });

  it("요청 헤더는 인증·쿠키·x- 만 담는다", async () => {
    const traceDir = await freshTraceDir();
    await runChild("fetch", childEnv(traceDir));
    const { entries } = await readTrace(traceDir);
    const start = starts(entries, "fetch")[0] as Start;
    expect(start.requestHeaders).toEqual({ authorization: "Bearer t", "x-trace": "1" });
    expect(start.requestBody).toBeUndefined();
    expect(start.requestBodyUnknown).toBeUndefined();
  });

  it("node:http 는 늦게 단 data 리스너가 본문 전체를 받는다", async () => {
    const traceDir = await freshTraceDir();
    const result = await runChild("http", childEnv(traceDir));
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(FULL);

    const { entries } = await readTrace(traceDir);
    const httpStarts = starts(entries, "node:http");
    expect(httpStarts).toHaveLength(1);
    const start = httpStarts[0] as Start;
    expect(start.method).toBe("GET");
    expect(start.url).toBe(`${origin}/slow`);

    const ends = endOf(entries, start);
    expect(ends).toHaveLength(1);
    const end = ends[0] as End;
    expect(end.bodyEnd).toBe(true);
    expect(end.status).toBe(200);
    expect(end.tHeaders).toBeTypeOf("number");
    expect(end.tEnd - (end.tHeaders as number)).toBeGreaterThanOrEqual(100);
    expect("responseBody" in end).toBe(false);
  });

  it("변수가 없으면 아무것도 쓰지 않는다", async () => {
    const traceDir = await freshTraceDir();
    const env = childEnv(traceDir);
    delete env[PERF_TRACE_DIR_ENV];
    expect(env.NODE_OPTIONS).toContain("--import=");

    const result = await runChild("fetch", env);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(FULL);
    expect(await readdir(traceDir)).toEqual([]);
  });

  it("변수를 지우지 않는다", async () => {
    const traceDir = await freshTraceDir();
    const result = await runChild("env", childEnv(traceDir));
    expect(result.stdout).toBe(traceDir);
  });

  it("파일 이름은 pid.jsonl 하나다", async () => {
    const traceDir = await freshTraceDir();
    const result = await runChild("fetch", childEnv(traceDir));
    expect(await readdir(traceDir)).toEqual([`${result.pid}.jsonl`]);
  });
});
