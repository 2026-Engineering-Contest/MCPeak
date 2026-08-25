/**
 * 폼 → argv 계약(구현계획 §4-4). 이 표가 곧 사양이고 테스트가 전량 단언한다.
 * `parseGenerateCommand`(packages/cli/src/generate-command.ts)의 검증 규칙과
 * 어긋나면 대시보드만 다른 제품이 된다.
 */

import { isHeaderEnv } from "../header-env.js";

export interface GenerateForm {
  readonly transport: "stdio" | "http";
  /** transport 가 http 일 때만 쓴다. */
  readonly url: string;
  /** `<헤더이름>=<환경변수이름>`. transport 가 http 일 때만 쓴다. */
  readonly headerEnvs: readonly string[];
  readonly command: string; // 실행 파일 하나만("node" 등). CLI --command 계약이 실행 파일 단독이라 스크립트 경로는 args 선두로 간다.
  readonly args: readonly string[];
  readonly suiteId: string;
  readonly suiteName: string;
  readonly outPath: string;
  readonly force: boolean;
  readonly mode: "ai" | "baseline";
  readonly provider: "claude" | "codex";
  readonly model: string; // 빈 문자열 = 미지정
  readonly dryRun: boolean; // 기본 true
  readonly repair: boolean; // 기본 true
  readonly resetCmd: string; // 빈 문자열 = 미지정
}

/** 필수 필드의 사용자 표시 라벨(조사 포함, 오류 문구용). */
const REQUIRED_LABELS = [
  ["suiteId", "스위트 ID를"],
  ["suiteName", "스위트 이름을"],
  ["outPath", "저장 위치를"],
] as const;

/** 위반 시 한국어 메시지로 throw. UI는 이 함수를 단계 검증에도 재사용한다. */
export function buildGenerateArgv(form: GenerateForm): readonly string[] {
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
  }
  for (const [key, label] of REQUIRED_LABELS) {
    if (form[key] === "") {
      throw new Error(`${label} 입력하세요.`);
    }
  }
  if (!form.dryRun && !form.repair) {
    throw new Error("시험 실행과 자동 교정을 동시에 끌 수 없습니다.");
  }
  if (!form.dryRun && form.resetCmd !== "") {
    throw new Error("시험 실행을 끄면 초기화 명령을 쓸 수 없습니다.");
  }

  // argv 순서는 §4-4 표(1~14행)로 고정한다. 같은 폼이면 항상 같은 배열(결정론).
  const argv: string[] = [];
  if (http) {
    argv.push("--url", form.url.trim());
    for (const entry of form.headerEnvs) {
      argv.push("--header-env", entry);
    }
    // args 는 싣지 않는다. HTTP 로 바꿔도 직접 입력 값을 지우지 않으므로 여기서 걸러야
    // CLI 의 "`--arg` 는 `--url` 과 함께 쓸 수 없습니다" 에 닿지 않는다.
  } else {
    argv.push("--command", form.command);
    for (const arg of form.args) {
      argv.push("--arg", arg);
    }
  }
  argv.push("--suite-id", form.suiteId);
  argv.push("--name", form.suiteName);
  argv.push("--out", form.outPath);
  if (form.force) {
    argv.push("--force");
  }
  if (form.mode === "baseline") {
    argv.push("--baseline-only");
  }
  if (form.mode === "ai") {
    argv.push("--provider", form.provider);
    if (form.model !== "") {
      argv.push("--model", form.model);
    }
  }
  if (!form.dryRun) {
    argv.push("--no-dry-run");
  }
  if (!form.repair) {
    argv.push("--no-repair");
  }
  if (form.resetCmd !== "") {
    argv.push("--reset-cmd", form.resetCmd);
  }
  return argv;
}
