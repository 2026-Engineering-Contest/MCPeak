/**
 * 폼 → `flow:"test"` argv 계약. `generate/build-argv.ts` 와 같은 자리다 — 이 파일이 사양이고
 * 테스트가 전량 단언한다. 서버는 이 배열을 가공 없이 `runCli` 에 넘기므로
 * (`src/server/wiring.ts`), 여기서 만든 것이 그대로 CLI 의 argv 가 된다.
 */

/**
 * External 세션을 쓸지, 쓴다면 어느 방향인지.
 *
 * **세 갈래 중 하나만 고를 수 있는 모양인 것이 이 타입의 요점이다.** CLI 는
 * `--session` 과 `--record-session` 의 동시 사용을 거절한다(`parseTestCommand`). 폼이 둘을
 * 따로 켜게 두면 사용자는 만들 수 있는 조합을 만들고, 서버가 그것을 거절하는 왕복을 한 번 더
 * 한다 — 막을 수 있는 조합은 애초에 만들 수 없게 두는 편이 낫다.
 */
export type SessionMode = "off" | "record" | "replay";

export interface TestForm {
  readonly suitePath: string;
  /** 실행 파일 하나만. 스크립트 경로는 `args` 선두로 간다(`splitCommand` 계약). */
  readonly command: string;
  readonly args: readonly string[];
  readonly sessionMode: SessionMode;
  /** 빈 문자열 = 미지정. `sessionMode` 가 `off` 면 쓰이지 않는다. */
  readonly sessionPath: string;
}

/** `sessionMode` → CLI 옵션 이름. `off` 는 옵션이 없으므로 이 표에 없다. */
const SESSION_OPTION = {
  record: "--record-session",
  replay: "--session",
} as const;

/**
 * 위반 시 한국어 메시지로 throw. UI 는 이 함수를 실행 버튼 비활성 판정에도 재사용한다 —
 * 판정이 두 벌이 되면 버튼은 눌리는데 제출은 실패하는 상태가 생긴다.
 */
export function buildTestArgv(form: TestForm): readonly string[] {
  if (form.command === "") {
    throw new Error("실행 명령을 입력하세요.");
  }
  if (form.sessionMode !== "off" && form.sessionPath === "") {
    throw new Error("세션 파일 경로를 입력하세요.");
  }

  // 순서를 고정한다. 같은 폼이면 항상 같은 배열이다(결정론).
  const argv: string[] = [form.suitePath, "--command", form.command];
  for (const arg of form.args) {
    argv.push("--arg", arg);
  }
  // 세션 옵션은 항상 맨 뒤다. `--arg` 는 하이픈으로 시작하는 값을 의도적으로 받으므로
  // (`parseTestCommand`), 세션 옵션이 서버 인자 사이에 끼면 읽는 사람이 어디까지가 서버
  // 인자인지 알기 어렵다. 파서는 어느 위치든 같게 읽지만 사람은 그렇지 않다.
  if (form.sessionMode !== "off") {
    argv.push(SESSION_OPTION[form.sessionMode], form.sessionPath);
  }
  return argv;
}
