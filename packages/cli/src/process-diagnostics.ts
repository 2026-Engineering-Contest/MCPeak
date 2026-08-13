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
 * 프로세스가 비정상 종료했는지 판정한다.
 * signal 이 있거나, exitCode 가 0 이 아닌 값으로 확정된 경우다.
 * exitCode 가 null 이면 아직 종료하지 않았다는 뜻이므로 비정상이 아니다.
 */
export function isAbnormalExit(diagnostics: ProcessDiagnosticsInput): boolean {
  return (
    diagnostics.signal !== null || (diagnostics.exitCode !== null && diagnostics.exitCode !== 0)
  );
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

  const notes = [dropped === 0 ? "전체" : `마지막 ${options.maxLines}줄`];
  if (dropped > 0) notes.push(`위로 ${dropped}줄 더 있음`);
  if (diagnostics.stderrTruncated) notes.push("앞부분이 수집 상한으로 잘렸습니다");

  // 이스케이프는 줄을 나눈 뒤 각 줄에 적용한다. 개행이 이스케이프되면 줄 구조가 뭉개진다.
  const body = shown.map((line) => `    ${escapeTerminalText(line)}\n`).join("");
  return `${head}  stderr (${notes.join(", ")}):\n${body}`;
}
