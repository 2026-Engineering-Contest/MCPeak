/**
 * 폼 → argv 계약(구현계획 §4-4). 이 표가 곧 사양이고 테스트가 전량 단언한다.
 * `parseGenerateCommand`(packages/cli/src/generate-command.ts)의 검증 규칙과
 * 어긋나면 대시보드만 다른 제품이 된다.
 */
export interface GenerateForm {
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
  readonly cassettePath: string; // 빈 문자열 = 녹화 없음
  readonly record: boolean;
  readonly resetCmd: string; // 빈 문자열 = 미지정
}

/** 필수 필드의 사용자 표시 라벨(조사 포함, 오류 문구용). */
const REQUIRED_LABELS = [
  ["command", "실행 명령을"],
  ["suiteId", "스위트 ID를"],
  ["suiteName", "스위트 이름을"],
  ["outPath", "저장 위치를"],
] as const;

/** 위반 시 한국어 메시지로 throw. UI는 이 함수를 단계 검증에도 재사용한다. */
export function buildGenerateArgv(form: GenerateForm): readonly string[] {
  for (const [key, label] of REQUIRED_LABELS) {
    if (form[key] === "") {
      throw new Error(`${label} 입력하세요.`);
    }
  }
  if (!form.dryRun && !form.repair) {
    throw new Error("시험 실행과 자동 교정을 동시에 끌 수 없습니다.");
  }
  if (!form.dryRun && form.cassettePath !== "") {
    throw new Error("시험 실행을 끄면 카세트를 녹화할 수 없습니다.");
  }
  if (!form.dryRun && form.resetCmd !== "") {
    throw new Error("시험 실행을 끄면 초기화 명령을 쓸 수 없습니다.");
  }
  if (form.record && form.cassettePath === "") {
    throw new Error("재녹화는 카세트 저장 위치가 있어야 합니다.");
  }

  // argv 순서는 §4-4 표(1~14행)로 고정한다. 같은 폼이면 항상 같은 배열(결정론).
  const argv: string[] = ["--command", form.command];
  for (const arg of form.args) {
    argv.push("--arg", arg);
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
  if (form.cassettePath !== "") {
    argv.push("--cassette", form.cassettePath);
  }
  if (form.record) {
    argv.push("--record");
  }
  if (form.resetCmd !== "") {
    argv.push("--reset-cmd", form.resetCmd);
  }
  return argv;
}
