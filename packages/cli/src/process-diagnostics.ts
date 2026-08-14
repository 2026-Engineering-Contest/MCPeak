/**
 * 서버 프로세스 진단 블록 렌더러. 설계 문서 §5.
 * 순수 함수만 둔다. process, Date, 파일 시스템을 읽지 않는다(ADR-0013).
 */

/** core 의 McpProcessDiagnostics 와 구조가 같다. core 를 import 하지 않는다. */
export interface ProcessDiagnosticsInput {
  readonly stderr: string;
  readonly stderrTruncated: boolean;
  readonly exitCode: number | null;
  readonly signal: string | null;
}

export interface RenderProcessDiagnosticsOptions {
  /** 표시할 stderr 마지막 줄 수. 0 이면 빈 문자열을 반환한다. */
  readonly maxLines: number;
}

/** TAB. 이 모듈만 이스케이프 대상에서 빼는 문자다. 아래 escapeTokens 주석에 근거가 있다. */
const TAB = 0x09;

/**
 * 터미널 제어 문자를 무해한 문자열로 바꾼다. 문자 하나가 토큰 하나가 된다. 설계 문서 §5.5.
 *
 * `packages/runner/src/reporter.ts` 의 `escapeTerminalText`,
 * `packages/cli/src/test-command.ts` 의 `escapeTerminalText` 와 같은 계열이다. 그 함수들을
 * import 하지 않고 사본을 두는 근거는 ADR-0013 과 같다. (줄 번호로 가리키면 금방 낡으므로
 * 심볼 이름으로 가리킨다.)
 *
 * **다만 이 사본만 TAB(0x09)을 이스케이프하지 않는다.** 다른 두 사본은 우리가 만든 메시지
 * 문자열만 다루므로 TAB 이 들어올 일이 없다. 이 모듈은 서버 stderr 를 그대로 그리는데, Java 의
 * `\tat com.example.Foo.bar(Foo.java:42)` 나 Go 패닉 트레이스의 파일·줄 행이 전부 TAB
 * 들여쓰기다. 그것을 `	` 로 바꾸면 이 기능이 보여주려던 스택 트레이스가 도리어 읽기
 * 어려워진다. TAB 은 커서를 옮길 뿐이라 터미널 주입 벡터가 아니다.
 *
 * 문자열이 아니라 토큰 배열을 돌려주는 이유는 자를 때 이스케이프 시퀀스 중간을 끊지 않기
 * 위해서다. `clampTokens` 를 봐라.
 */
function escapeTokens(value: string): readonly string[] {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint === TAB) return character;
    // 0x7f..0x9f 는 DEL 과 C1 제어 문자다. U+009B 를 8비트 CSI 로 해석하는 터미널이 있다.
    return codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
      ? `\\u${codePoint.toString(16).padStart(4, "0")}`
      : character;
  });
}

/**
 * 우리 종료 절차가 보내는 시그널. `packages/core/src/lifecycle.ts` 가 stdin EOF 뒤
 * `STDIN_CLOSE_GRACE_MS` 가 지나면 SIGTERM 을, 다시 `SIGTERM_GRACE_MS` 뒤에 SIGKILL 을 보낸다.
 * 타이머나 소켓 핸들을 들고 있어 유예 안에 못 끝나는 멀쩡한 서버가 여기 걸린다.
 */
const SHUTDOWN_SIGNALS: ReadonlySet<string> = new Set(["SIGTERM", "SIGKILL"]);

/**
 * 프로세스가 비정상 종료했는지 판정한다.
 * 우리가 보내는 종료 시그널(SIGTERM·SIGKILL)은 그 자체로 비정상이 아니다. 정상 실행에서도
 * 나오므로 그것으로 경보를 울리면 거짓 경보가 된다. SIGSEGV·SIGABRT·SIGBUS 처럼 우리가 보내지
 * 않는 시그널은 그대로 비정상이다.
 * exitCode 가 null 이면 아직 종료하지 않았다는 뜻이므로 비정상이 아니다.
 *
 * 알려진 한계: OOM killer 가 보낸 SIGKILL 을 우리가 보낸 것과 구분하지 못해 놓친다.
 * core 진단에 "우리가 보냈다" 표식이 없어 지금은 구분할 방법이 없다. 거짓 경보를 매 실행마다
 * 내는 쪽보다 이 한 경우를 놓치는 쪽이 낫다고 보고 받아들인다. 설계 문서 §4.3.
 */
export function isAbnormalExit(diagnostics: ProcessDiagnosticsInput): boolean {
  if (diagnostics.signal !== null) return !SHUTDOWN_SIGNALS.has(diagnostics.signal);
  return diagnostics.exitCode !== null && diagnostics.exitCode !== 0;
}

/**
 * 블록에 담을 내용이 있는지 판정한다. 설계 문서 §4.3 의 "진단에 내용이 없으면 쓰지 않는다".
 * stderr 가 비고 비정상 종료도 아니면 남는 것은 `종료 코드: 0  시그널: 없음` 과
 * `stderr: (비어 있음)` 뿐이라 정보량이 0이다.
 *
 * 이 판정을 호출부마다 다시 쓰지 않고 여기 한 곳에 둔다. 억제 규칙이 갈라지면 진단이 가장
 * 필요한 경로에만 조용히 미적용되는 일이 생긴다.
 */
export function hasDiagnosticContent(diagnostics: ProcessDiagnosticsInput): boolean {
  return diagnostics.stderr !== "" || isAbnormalExit(diagnostics);
}

/**
 * stderr 를 줄로 나눈다. 설계 문서 §5.4.
 * 개행 하나로 끝나는 경우에 생기는 마지막 빈 줄만 하나 버린다. 그 외의 빈 줄은 정보다.
 */
function splitLines(stderr: string): readonly string[] {
  const lines = stderr.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * 한 줄에 표시할 문자 수 상한. 구조화 로거는 크래시마다 수십 KB JSON 을 한 줄로 뱉는다.
 * 줄 수만 제한하면 그 한 줄이 통째로 터미널에 쏟아진다. 1000자면 스택 프레임 한 줄과 긴 경로를
 * 담고도 터미널 몇 줄에 들어간다.
 */
const MAX_LINE_CHARACTERS = 1000;

/**
 * 상한을 넘는 줄을 자르고 생략한 문자 수를 알린다. 설계 문서 §5.4.
 *
 * **이스케이프 뒤에 자른다.** 이스케이프는 제어문자 하나를 `\uXXXX` 6자로 부풀리므로, 원문
 * 기준으로 자르면 상한이 상한 노릇을 못 한다. 제어문자로 채운 1000자가 6000자가 된다.
 * 그래서 세는 단위도 이스케이프된 문자다.
 *
 * 자르는 지점이 `	` 같은 시퀀스 중간이 되면 안 되므로 문자열이 아니라 토큰 배열을 받는다.
 * 토큰 하나는 원문 문자 하나에 대응하고 절대 쪼개지 않는다.
 */
function clampTokens(tokens: readonly string[]): string {
  let total = 0;
  for (const token of tokens) total += token.length;
  if (total <= MAX_LINE_CHARACTERS) return tokens.join("");
  let kept = 0;
  const head: string[] = [];
  for (const token of tokens) {
    if (kept + token.length > MAX_LINE_CHARACTERS) break;
    head.push(token);
    kept += token.length;
  }
  return `${head.join("")} …(${total - kept}자 생략)`;
}

/**
 * 진단 블록을 만든다. maxLines 가 0 이면 빈 문자열을 반환한다.
 * 빈 문자열이 아니면 항상 개행으로 끝난다.
 */
export function renderProcessDiagnostics(
  diagnostics: ProcessDiagnosticsInput,
  options: RenderProcessDiagnosticsOptions,
): string {
  // 이 판정이 다른 모든 판정보다 먼저다. 설계 문서 §4.3.
  if (options.maxLines === 0) return "";

  const exitCode = diagnostics.exitCode === null ? "없음" : String(diagnostics.exitCode);
  const signal = diagnostics.signal === null ? "없음" : diagnostics.signal;
  const head = `서버 프로세스 진단\n  종료 코드: ${exitCode}  시그널: ${signal}\n`;

  if (diagnostics.stderr === "") return `${head}  stderr: (비어 있음)\n`;

  const lines = splitLines(diagnostics.stderr);
  const shown = lines.slice(Math.max(0, lines.length - options.maxLines));
  const dropped = lines.length - shown.length;

  // 잘린 스트림을 "전체" 라고 부르면 모순이므로 수집 상한에 걸렸을 때는 "수집된 전체" 다.
  const whole = diagnostics.stderrTruncated ? "수집된 전체" : "전체";
  const notes = [dropped === 0 ? whole : `마지막 ${options.maxLines}줄`];
  if (dropped > 0) notes.push(`위로 ${dropped}줄 더 있음`);
  if (diagnostics.stderrTruncated) notes.push("앞부분이 수집 상한으로 잘렸습니다");

  // 이스케이프는 줄을 나눈 뒤 각 줄에 적용한다. 개행이 이스케이프되면 줄 구조가 뭉개진다.
  // 자르기는 이스케이프 다음이다. 근거는 clampTokens 주석에 있다.
  const body = shown.map((line) => `    ${clampTokens(escapeTokens(line))}\n`).join("");
  return `${head}  stderr (${notes.join(", ")}):\n${body}`;
}
