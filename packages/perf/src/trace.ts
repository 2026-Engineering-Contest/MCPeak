import type { TraceEntry } from "./types.js";

/** 디렉터리의 *.jsonl 을 파일 이름 사전순으로 읽는다. JSON 이 아니거나 kind 를 모르는 줄은 건너뛰고 센다. T1 이 구현한다. */
export function readTrace(
  _dir: string,
): Promise<{ readonly entries: readonly TraceEntry[]; readonly skippedLines: number }> {
  throw new Error("not implemented");
}
