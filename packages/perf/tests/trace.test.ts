import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readTrace } from "../src/trace.js";

const T = 1_700_000_000_000;

const dirs: string[] = [];

async function traceDir(files: Readonly<Record<string, string>>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mcpeak-perf-trace-"));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("readTrace", () => {
  it("파일 이름 사전순으로 읽고 깨진 줄을 센다", async () => {
    const dir = await traceDir({
      "200.jsonl": [
        JSON.stringify({ kind: "hello", pid: 200, ppid: 1, node: "v24.0.0", t: T + 10 }),
        "{not json",
        JSON.stringify({
          kind: "start",
          pid: 200,
          seq: 1,
          via: "fetch",
          method: "GET",
          url: "https://h.example/a",
          t0: T + 20,
        }),
        "",
      ].join("\n"),
      "100.jsonl": [
        JSON.stringify({ kind: "hello", pid: 100, ppid: 1, node: "v24.0.0", t: T }),
        JSON.stringify({ kind: "end", pid: 100, seq: 1, tEnd: T + 5, bodyEnd: true }),
      ].join("\n"),
      "notes.txt": `${JSON.stringify({ kind: "hello", pid: 999, ppid: 1, node: "v0", t: T })}\n`,
    });

    const { entries, skippedLines } = await readTrace(dir);

    expect(skippedLines).toBe(1);
    expect(entries.map((entry) => [entry.kind, entry.pid])).toEqual([
      ["hello", 100],
      ["end", 100],
      ["hello", 200],
      ["start", 200],
    ]);
    expect(entries.some((entry) => entry.pid === 999)).toBe(false);
  });

  it("빈 줄은 세지 않고, 객체가 아니거나 kind 를 모르는 줄은 센다", async () => {
    const dir = await traceDir({
      "1.jsonl": [
        "",
        "42",
        '"text"',
        "null",
        "[1,2]",
        JSON.stringify({ kind: "unknown", pid: 1 }),
        JSON.stringify({ pid: 1 }),
        "",
        JSON.stringify({ kind: "hello", pid: 1, ppid: 0, node: "v24.0.0", t: T }),
        "",
      ].join("\n"),
    });

    const { entries, skippedLines } = await readTrace(dir);

    expect(skippedLines).toBe(6);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("hello");
  });

  it("jsonl 파일이 없으면 빈 결과", async () => {
    const dir = await traceDir({ "notes.txt": "x\n" });
    await expect(readTrace(dir)).resolves.toEqual({ entries: [], skippedLines: 0 });
  });

  it("그 밖의 필드는 검증하지 않고 그대로 싣는다", async () => {
    const line = { kind: "end", pid: 7, seq: 3, extra: "kept" };
    const dir = await traceDir({ "7.jsonl": `${JSON.stringify(line)}\n` });
    const { entries, skippedLines } = await readTrace(dir);
    expect(skippedLines).toBe(0);
    expect(entries).toEqual([line]);
  });
});
