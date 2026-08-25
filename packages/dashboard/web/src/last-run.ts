/**
 * 홈 실행 폼의 지난 실행값. 스위트 경로를 키로 명령·인자·옵션을 기억한다(설계 §6-3).
 *
 * 세션 모드·경로는 **일부러 저장하지 않는다.** 녹화·재생은 그때그때 고르는 것이라
 * 기억해 두면 다음 실행이 조용히 세션에 묶인다.
 */

import type { TestOptions } from "./build-test-argv.js";
import { DEFAULT_TEST_OPTIONS } from "./build-test-argv.js";

export interface LastRun {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: TestOptions;
}

/** `Record<suitePath, LastRun>` 를 담는다. */
const KEY = "mcpeak-home-last-run";

/**
 * 저장·읽기의 예외는 삼킨다. `theme.ts` 와 같은 이유다 — `localStorage` 가 없거나 막힌
 * 환경에서, 지난 실행값을 못 기억하는 것은 불편이고 화면이 안 뜨는 것은 고장이다.
 */
function readAll(): Record<string, unknown> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * 저장된 `options` 를 키마다 형을 보고 옮긴다. 어긋난 키는 그 키만 기본값이다. 통째로 단언하면
 * `headerEnvs: null` 같은 값이 그대로 복원돼 옵션 패널이 `.length` 에서 죽는다.
 */
function sanitizeOptions(raw: Record<string, unknown>): TestOptions {
  const fallback = DEFAULT_TEST_OPTIONS;
  const text = (value: unknown, orElse: string): string =>
    typeof value === "string" ? value : orElse;
  return {
    transport:
      raw.transport === "http" || raw.transport === "stdio" ? raw.transport : fallback.transport,
    url: text(raw.url, fallback.url),
    headerEnvs: Array.isArray(raw.headerEnvs)
      ? raw.headerEnvs.filter((item): item is string => typeof item === "string")
      : fallback.headerEnvs,
    determinism: typeof raw.determinism === "boolean" ? raw.determinism : fallback.determinism,
    stderrLines: text(raw.stderrLines, fallback.stderrLines),
    junitPath: text(raw.junitPath, fallback.junitPath),
    repairBundlePath: text(raw.repairBundlePath, fallback.repairBundlePath),
    resetCmd: text(raw.resetCmd, fallback.resetCmd),
  };
}

/** 형이 어긋나면 `null`. `options` 는 키마다 검증해 빠지거나 어긋난 키를 기본값으로 메운다. */
export function readLastRun(suitePath: string): LastRun | null {
  const entry = readAll()[suitePath];
  if (typeof entry !== "object" || entry === null) {
    return null;
  }
  const { command, args, options } = entry as Partial<Record<keyof LastRun, unknown>>;
  if (typeof command !== "string") {
    return null;
  }
  if (!Array.isArray(args)) {
    return null;
  }
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    return null;
  }
  return {
    command,
    args: args.filter((item): item is string => typeof item === "string"),
    options: sanitizeOptions(options as Record<string, unknown>),
  };
}

/** 실행 시작 직후에 부른다. 같은 스위트 경로의 값은 덮어쓴다. */
export function saveLastRun(suitePath: string, run: LastRun): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [suitePath]: run }));
  } catch {
    // 지난 실행값은 편의 기능이라 실패를 표시하지 않는다. 실행은 이미 시작됐다.
  }
}
