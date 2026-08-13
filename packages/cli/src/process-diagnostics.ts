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

/**
 * 터미널 제어 문자를 무해한 문자열로 바꾼다. 설계 문서 §5.5.
 * packages/runner/src/reporter.ts:38 및 packages/cli/src/test-command.ts:143 과 같은 값이다.
 * 그 함수들을 import 하지 않고 사본을 둔다. 근거는 ADR-0013 과 같다.
 */
const escapeTerminalText = (value: string): string =>
  Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    // 0x7f..0x9f 는 DEL 과 C1 제어 문자다. U+009B 를 8비트 CSI 로 해석하는 터미널이 있다.
    return codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
      ? `\\u${codePoint.toString(16).padStart(4, "0")}`
      : character;
  }).join("");

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
 * 줄 수만 제한하면 그 한 줄이 통째로 터미널에 쏟아지고, 이스케이프가 제어문자마다 6배로
 * 부풀린다. 1000자면 스택 프레임 한 줄과 긴 경로를 담고도 터미널 몇 줄에 들어간다.
 */
const MAX_LINE_CHARACTERS = 1000;

/** 상한을 넘는 줄을 자르고 생략한 문자 수를 알린다. 이스케이프 전 원문 기준이다. 설계 문서 §5.4. */
function clampLine(line: string): string {
  const characters = Array.from(line);
  if (characters.length <= MAX_LINE_CHARACTERS) return line;
  const omitted = characters.length - MAX_LINE_CHARACTERS;
  return `${characters.slice(0, MAX_LINE_CHARACTERS).join("")} …(${omitted}자 생략)`;
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
  const body = shown.map((line) => `    ${escapeTerminalText(clampLine(line))}\n`).join("");
  return `${head}  stderr (${notes.join(", ")}):\n${body}`;
}
