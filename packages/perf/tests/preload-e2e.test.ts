import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { childEnvironment, PERF_TRACE_DIR_ENV } from "../src/child-env.js";
import { mergeTrace } from "../src/decompose.js";
import { readTrace } from "../src/trace.js";
import type { TraceEntry } from "../src/types.js";

/** `/slow` 의 전체 본문. 앞부분은 즉시, 뒷부분은 150ms 뒤에 간다. */
const FULL = '{"part":"one","tail":"two"}';
const TAIL_DELAY_MS = 150;
/** `/big` 의 전체 크기. 서버가 안 읽으면 이것보다 훨씬 적게 나가야 한다(배압). */
const BIG_TOTAL = 50 * 1024 * 1024;
const BIG_CHUNK = 64 * 1024;

const FIXTURE = fileURLToPath(new URL("./fixtures/preload-child.mjs", import.meta.url));

type Start = Extract<TraceEntry, { kind: "start" }>;
type End = Extract<TraceEntry, { kind: "end" }>;

let server: Server;
let origin: string;
/** `/endless` 연결이 닫힌 횟수. */
let endlessClosed = 0;
/** `/big` 에 지금까지 쓴 바이트. */
let bigSent = 0;
const dirs: string[] = [];

async function freshTraceDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mcpeak-perf-preload-"));
  dirs.push(dir);
  return dir;
}

/** limitMs 안에 cond 가 참이 되면 true. */
async function waitFor(cond: () => boolean, limitMs: number): Promise<boolean> {
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return cond();
}

/** `process.env` 에서 `NODE_OPTIONS` 를 뺀 것에 `childEnvironment` 를 얹는다. */
function childEnv(traceDir: string): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key !== "NODE_OPTIONS" && value !== undefined) base[key] = value;
  }
  return { ...base, ...childEnvironment({ traceDir }) };
}

/** 프리로드 없이 띄울 환경. `NODE_OPTIONS` 와 추적 디렉터리 변수를 뺀다. */
function plainEnv(): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key !== "NODE_OPTIONS" && key !== PERF_TRACE_DIR_ENV && value !== undefined)
      base[key] = value;
  }
  return base;
}

function runChild(
  mode: "fetch" | "http" | "env" | "cancel" | "cancel-decoder" | "unread" | "worker" | "props",
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
    if (req.url === "/endless") {
      // 연결이 닫힐 때까지 20ms 마다 쓴다.
      res.writeHead(200, { "content-type": "text/plain" });
      const timer = setInterval(() => res.write("x".repeat(100)), 20);
      res.on("close", () => {
        clearInterval(timer);
        endlessClosed += 1;
      });
      return;
    }
    if (req.url === "/big") {
      // 배압을 지키며 쓴다. 받는 쪽이 안 읽으면 drain 이 오지 않아 멈춘다.
      res.writeHead(200, { "content-type": "application/octet-stream" });
      const chunk = Buffer.alloc(BIG_CHUNK, 120);
      const pump = () => {
        while (bigSent < BIG_TOTAL) {
          bigSent += BIG_CHUNK;
          if (!res.write(chunk)) {
            res.once("drain", pump);
            return;
          }
        }
        res.end();
      };
      pump();
      return;
    }
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/slow" });
      res.end("moved");
      return;
    }
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
      // 설계 §4.3 undici 절: headers 채널은 tHeaders 만 적고 status 는 적지 않는다(계획 E27).
      for (const undiciEnd of endOf(entries, undiciStart)) {
        expect(undiciEnd.status).toBeUndefined();
      }
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

  // cancel: 첫 청크 뒤 body.cancel(). cancel-decoder: pipeThrough(TextDecoderStream) 뒤 reader.cancel().
  it.each(["cancel", "cancel-decoder"] as const)(
    "끝없는 본문을 버리면(%s) 1초 안에 풀리고 원점 연결이 닫힌다",
    async (mode) => {
      const traceDir = await freshTraceDir();
      const closedBefore = endlessClosed;
      const result = await runChild(mode, childEnv(traceDir));
      expect(result.stderr).toBe("");
      expect(result.stdout).toMatch(/^resolved \d+ms$/);
      expect(await waitFor(() => endlessClosed > closedBefore, 1000)).toBe(true);

      const { entries } = await readTrace(traceDir);
      const start = starts(entries, "fetch")[0] as Start;
      const ends = endOf(entries, start);
      expect(ends).toHaveLength(1);
      expect((ends[0] as End).bodyEnd).toBe(false);
    },
  );

  it("서버가 안 읽은 큰 본문은 관측이 대신 당기지 않는다", async () => {
    const traceDir = await freshTraceDir();
    bigSent = 0;
    const result = await runChild("unread", childEnv(traceDir));
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("200");
    process.stderr.write(`[preload-e2e] /big 에 쓴 바이트: ${bigSent} / ${BIG_TOTAL}\n`);
    expect(bigSent).toBeLessThan(BIG_TOTAL / 4);

    // 서버가 읽지 않았으므로 fetch 의 끝 줄은 없다(설계 §4.3 fetch 3항, 하한 경로).
    const { entries } = await readTrace(traceDir);
    const start = starts(entries, "fetch")[0] as Start;
    expect(endOf(entries, start)).toEqual([]);
  });

  it("worker 와 메인의 fetch 는 seq 가 겹치지 않아 병합 뒤 둘 다 남는다", async () => {
    const traceDir = await freshTraceDir();
    const result = await runChild("worker", childEnv(traceDir));
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${FULL}|${FULL}`);

    const { entries } = await readTrace(traceDir);
    expect(entries.filter((entry) => entry.kind === "hello")).toHaveLength(2);
    const fetchStarts = starts(entries, "fetch");
    expect(fetchStarts).toHaveLength(2);
    expect(new Set(fetchStarts.map((s) => s.seq)).size).toBe(2);

    const merged = mergeTrace(entries).filter((request) => request.via === "fetch");
    expect(merged).toHaveLength(2);
    for (const request of merged) {
      expect(request.pid).toBe(result.pid);
      expect(request.bodyEnd).toBe(true);
      expect(request.responseBody).toBe(FULL);
    }
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

  it("감싼 응답은 clone·열거·headers 에서 프리로드 없는 응답과 같다", async () => {
    const traceDir = await freshTraceDir();
    const observed = await runChild("props", childEnv(traceDir));
    const plain = await runChild("props", plainEnv());
    expect(observed.stderr).toBe("");
    expect(plain.stderr).toBe("");
    expect(JSON.parse(observed.stdout)).toEqual(JSON.parse(plain.stdout));

    // 프리로드가 실제로 실려 fetch 를 감쌌는지 확인한다. 안 실렸다면 위 비교는 아무것도 보지 않는다.
    const { entries } = await readTrace(traceDir);
    expect(starts(entries, "fetch").length).toBeGreaterThan(0);
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
