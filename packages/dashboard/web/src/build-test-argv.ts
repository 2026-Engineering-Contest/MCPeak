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

/** 서버에 어떻게 붙을지. stdio 는 우리가 프로세스를 띄우고, http 는 떠 있는 것에 붙는다. */
export type Transport = "stdio" | "http";

export interface TestOptions {
  readonly transport: Transport;
  /** transport 가 http 일 때만 쓴다. */
  readonly url: string;
  /** `<헤더이름>=<환경변수이름>` 문자열. transport 가 http 일 때만 쓴다. */
  readonly headerEnvs: readonly string[];
  readonly determinism: boolean;
  /** 빈 문자열 = 미지정(CLI 기본 20). */
  readonly stderrLines: string;
  readonly junitPath: string;
  readonly repairBundlePath: string;
  readonly resetCmd: string;
}

export const DEFAULT_TEST_OPTIONS: TestOptions = {
  transport: "stdio",
  url: "",
  headerEnvs: [],
  determinism: false,
  stderrLines: "",
  junitPath: "",
  repairBundlePath: "",
  resetCmd: "",
};

export interface TestForm {
  readonly suitePath: string;
  /** 실행 파일 하나만. 스크립트 경로는 `args` 선두로 간다(`splitCommand` 계약). */
  readonly command: string;
  readonly args: readonly string[];
  readonly sessionMode: SessionMode;
  /** 빈 문자열 = 미지정. `sessionMode` 가 `off` 면 쓰이지 않는다. */
  readonly sessionPath: string;
  readonly options: TestOptions;
}

/** `sessionMode` → CLI 옵션 이름. `off` 는 옵션이 없으므로 이 표에 없다. */
const SESSION_OPTION = {
  record: "--record-session",
  replay: "--session",
} as const;

/**
 * `<헤더이름>=<환경변수이름>` 인지 본다. CLI 의 `parseHeaderEnvOption` 과 같은 자리에서
 * 거절해야 폼이 만든 조합이 서버에서 처음 깨지는 일이 없다. 문자 종류까지는 보지 않는다 —
 * 그 판정은 CLI 가 헤더 토큰·환경변수 이름 패턴으로 더 정확히 한다.
 */
function isHeaderEnv(entry: string): boolean {
  const separator = entry.indexOf("=");
  return separator > 0 && entry.slice(separator + 1) !== "";
}

/**
 * 위반 시 한국어 메시지로 throw. UI 는 이 함수를 실행 버튼 비활성 판정에도 재사용한다 —
 * 판정이 두 벌이 되면 버튼은 눌리는데 제출은 실패하는 상태가 생긴다.
 */
export function buildTestArgv(form: TestForm): readonly string[] {
  const options = form.options;
  const http = options.transport === "http";

  if (!http && form.command === "") {
    throw new Error("서버를 고르거나 실행 명령을 입력하세요.");
  }
  if (http) {
    if (options.url.trim() === "") {
      throw new Error("URL 을 입력하세요.");
    }
    for (const entry of options.headerEnvs) {
      if (!isHeaderEnv(entry)) {
        throw new Error(`헤더 환경변수는 <헤더이름>=<환경변수이름> 형식이어야 합니다: '${entry}'`);
      }
    }
    if (form.sessionMode !== "off") {
      throw new Error(
        "External 세션은 HTTP 대상과 함께 쓸 수 없습니다. 접속을 stdio 로 바꾸거나 세션을 끄세요.",
      );
    }
    if (options.stderrLines !== "") {
      throw new Error("서버 stderr 줄 수는 HTTP 대상에 쓸 수 없습니다. 비워 두세요.");
    }
  }
  if (form.sessionMode !== "off" && form.sessionPath === "") {
    throw new Error("세션 파일 경로를 입력하세요.");
  }
  if (options.determinism && form.sessionMode !== "off") {
    throw new Error("결정론 검사는 External 세션과 함께 쓸 수 없습니다. 둘 중 하나를 끄세요.");
  }
  if (options.stderrLines !== "" && !/^\d+$/.test(options.stderrLines)) {
    throw new Error("서버 stderr 줄 수는 0 이상의 정수여야 합니다.");
  }

  // 순서를 고정한다. 같은 폼이면 항상 같은 배열이다(결정론).
  const argv: string[] = [form.suitePath];
  if (http) {
    argv.push("--url", options.url.trim());
    for (const entry of options.headerEnvs) {
      argv.push("--header-env", entry);
    }
    // `args` 는 일부러 안 싣는다. 접속을 http 로 바꿔도 §5-3 이 서버 인자 값을 지우지 않기로
    // 했으므로, 여기서 걸러야 CLI 의 "`--arg` 는 `--url` 과 함께 쓸 수 없습니다" 에 걸리지 않는다.
  } else {
    argv.push("--command", form.command);
    for (const arg of form.args) {
      argv.push("--arg", arg);
    }
  }
  // 세션 옵션은 서버 인자 바로 뒤다. `--arg` 는 하이픈으로 시작하는 값을 의도적으로 받으므로
  // (`parseTestCommand`), 세션 옵션이 서버 인자 사이에 끼면 읽는 사람이 어디까지가 서버
  // 인자인지 알기 어렵다. 파서는 어느 위치든 같게 읽지만 사람은 그렇지 않다.
  if (form.sessionMode !== "off") {
    argv.push(SESSION_OPTION[form.sessionMode], form.sessionPath);
  }
  if (options.determinism) {
    argv.push("--determinism");
  }
  if (options.stderrLines !== "") {
    argv.push("--stderr-lines", options.stderrLines);
  }
  const junitPath = options.junitPath.trim();
  if (junitPath !== "") {
    argv.push("--junit", junitPath);
  }
  const repairBundlePath = options.repairBundlePath.trim();
  if (repairBundlePath !== "") {
    argv.push("--repair-bundle", repairBundlePath);
  }
  const resetCmd = options.resetCmd.trim();
  if (resetCmd !== "") {
    argv.push("--reset-cmd", resetCmd);
  }
  return argv;
}
