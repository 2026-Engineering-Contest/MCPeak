/**
 * 폼 → `POST /api/analyze/tokens` 의 argv 계약. `build-test-argv.ts` 와 같은 자리다. 이 파일이
 * 사양이고 테스트가 전량 단언한다. 서버는 이 배열을 `mcpeak optimize` 의 대상 옵션으로 그대로
 * 넘긴다. `--out`·`--json` 은 싣지 않는다(api-types.ts `AnalyzeTokensRequest`).
 */

import type { Transport } from "../build-test-argv.js";
import { isHeaderEnv } from "../header-env.js";

export interface AnalyzeForm {
  /** 실행 파일 하나. 스크립트 경로는 `args` 선두다(`splitCommand` 계약). */
  readonly command: string;
  readonly args: readonly string[];
  /** 후보의 env 이름. 값은 오지 않는다(설계 §4.3). */
  readonly envNames: readonly string[];
  readonly transport: Transport;
  readonly url: string;
  readonly headerEnvs: readonly string[];
}

/**
 * 위반 시 한국어 메시지로 throw. 버튼 비활성 판정과 제출이 같은 함수를 부른다(buildTestArgv 와
 * 같은 규율). 문장 세 개는 `buildTestArgv` 의 것과 글자 단위로 같다. 같은 폼이 다른 화면에서
 * 다른 말을 하면 안 된다.
 */
export function buildAnalyzeArgv(form: AnalyzeForm): readonly string[] {
  const http = form.transport === "http";
  if (!http && form.command === "") {
    throw new Error("서버를 고르거나 실행 명령을 입력하세요.");
  }
  if (http) {
    if (form.url.trim() === "") {
      throw new Error("URL 을 입력하세요.");
    }
    for (const entry of form.headerEnvs) {
      if (!isHeaderEnv(entry)) {
        throw new Error(`헤더 환경변수는 <헤더이름>=<환경변수이름> 형식이어야 합니다: '${entry}'`);
      }
    }
    const argv: string[] = ["--url", form.url.trim()];
    for (const entry of form.headerEnvs) {
      argv.push("--header-env", entry);
    }
    // `args`·`envNames` 는 싣지 않는다. CLI 가 `--url` 과의 병용을 거절한다.
    return argv;
  }
  // 순서를 고정한다. 같은 폼이면 항상 같은 배열이다(결정론).
  const argv: string[] = ["--command", form.command];
  for (const arg of form.args) {
    argv.push("--arg", arg);
  }
  for (const name of form.envNames) {
    argv.push("--env", name);
  }
  return argv;
}
