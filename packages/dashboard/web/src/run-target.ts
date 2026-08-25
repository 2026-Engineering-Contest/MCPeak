/**
 * run 하나가 **무엇을 무엇으로** 돌렸는지. `RunSummary.argv` 에서 읽는다.
 *
 * **argv 말고는 근거가 없다.** 서버는 실행 이력을 메모리에 담을 뿐 대상 서버를 따로 기록하지
 * 않고(`run-registry.ts`), 폼 상태는 브라우저에만 있다. 그래서 목록에 대상을 적으려면 시작할
 * 때 보낸 argv 를 되읽는 수밖에 없다 — `repairBundlePathOf` 가 `--repair-bundle` 을 되읽는 것과
 * 같은 자리다(ADR-0080).
 *
 * 모르면 `null` 이다. 빈 문자열이나 "알 수 없음" 을 만들지 않는다. 화면이 그 칸을 비우는 것과
 * 아는 척하는 것은 사용자에게 다른 말이다(#295).
 */

import type { StartRunRequest } from "../../src/api-types.js";

export interface RunTarget {
  /** 실행 명령 전문(`node server.mjs --port 3000`) 또는 HTTP URL. 모르면 null. */
  readonly server: string | null;
  /** test 는 스위트 경로, generate 는 `--out` 저장 위치, repair 는 번들 경로. 모르면 null. */
  readonly suite: string | null;
}

/** `--name value` 와 `--name=value` 를 함께 본다. 없으면 null. */
function optionValue(argv: readonly string[], name: string): string | null {
  const prefix = `${name}=`;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === name) {
      return argv[index + 1] ?? null;
    }
    if (token?.startsWith(prefix)) {
      return token.slice(prefix.length);
    }
  }
  return null;
}

/** `--command` 뒤의 실행 파일과 이어지는 `--arg` 값들. CLI 계약상 순서가 곧 argv 순서다. */
function commandLine(argv: readonly string[]): string | null {
  const command = optionValue(argv, "--command");
  if (command === null) {
    return null;
  }
  const args: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--arg") {
      const value = argv[index + 1];
      if (value !== undefined) {
        args.push(value);
      }
      index += 1;
      continue;
    }
    if (token?.startsWith("--arg=")) {
      args.push(token.slice("--arg=".length));
    }
  }
  return [command, ...args].join(" ");
}

/**
 * 첫 위치 인자. 옵션으로 시작하면 없는 것으로 본다 — `test`·`repair` 는 첫 토큰이 위치
 * 인자라는 것이 CLI 계약이다(`parseTestCommand`·`parseRepairCommand`).
 */
function firstPositional(argv: readonly string[]): string | null {
  const first = argv[0];
  return first === undefined || first.startsWith("-") ? null : first;
}

/** 플로우별로 대상 서버와 스위트를 뽑는다. argv 를 못 읽으면 두 값 다 null 이다. */
export function describeRun(
  flow: StartRunRequest["flow"],
  argv: readonly string[] | undefined,
): RunTarget {
  if (!Array.isArray(argv) || argv.length === 0) {
    return { server: null, suite: null };
  }
  // HTTP 대상이면 `--command` 가 아예 없다(둘은 CLI 가 함께 못 쓰게 막는다).
  const server = optionValue(argv, "--url") ?? commandLine(argv);
  const suite = flow === "generate" ? optionValue(argv, "--out") : firstPositional(argv);
  return { server, suite };
}
