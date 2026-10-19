import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TraceEntry } from "./types.js";

const KNOWN_KINDS: ReadonlySet<string> = new Set(["hello", "start", "end"]);

/**
 * 디렉터리의 `*.jsonl` 을 파일 이름 사전순(기본 `sort()`)으로 읽는다(설계 §8.2, 계획 §4.2).
 *
 * 줄은 `\n` 으로 나누고 빈 줄은 세지 않는다. `JSON.parse` 가 던지거나, 결과가 객체가 아니거나,
 * `kind` 가 `hello`·`start`·`end` 가 아니면 `skippedLines` 를 하나 올리고 건너뛴다. 그 밖의 필드는
 * 검증하지 않는다. 프리로드가 쓰다 만 마지막 줄(프로세스가 도중에 끝난 경우)이 전체 추적을 버리게
 * 하지 않으려는 규칙이다.
 */
export async function readTrace(
  dir: string,
): Promise<{ readonly entries: readonly TraceEntry[]; readonly skippedLines: number }> {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".jsonl")).sort();
  const entries: TraceEntry[] = [];
  let skippedLines = 0;
  for (const name of names) {
    const text = await readFile(join(dir, name), "utf8");
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        skippedLines += 1;
        continue;
      }
      if (!isTraceEntry(parsed)) {
        skippedLines += 1;
        continue;
      }
      entries.push(parsed);
    }
  }
  return { entries, skippedLines };
}

function isTraceEntry(value: unknown): value is TraceEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === "string" && KNOWN_KINDS.has(kind);
}
