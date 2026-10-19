import type { PerfBaseline, PerfReport } from "./types.js";

/** baseline 과 exitCode 를 채운 새 리포트. 입력은 바꾸지 않는다. T4 가 구현한다. */
export function compareBaseline(
  _report: PerfReport,
  _baseline: PerfBaseline,
  _options: { readonly path: string; readonly thresholdPct: number; readonly thresholdMs: number },
): PerfReport {
  throw new Error("not implemented");
}

/** §7.1 기준 파일 내용. T4 가 구현한다. */
export function toBaseline(_report: PerfReport): PerfBaseline {
  throw new Error("not implemented");
}

/** 형식이 틀리면 PerfError("BASELINE_INVALID", 사유 한 줄). T4 가 구현한다. */
export function parseBaseline(_text: string): PerfBaseline {
  throw new Error("not implemented");
}
