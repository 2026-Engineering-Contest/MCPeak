/**
 * 2단계 기본값 제안 규칙(설계 §6-3, §6-4). 저장 위치는 고른 서버에서, 스위트 ID·이름은
 * 저장 위치 파일명에서 뽑는다. 제안일 뿐이라 사용자가 고친 값은 부르는 쪽이 지킨다.
 */

/** 실행 파일 뒤의 첫 인자가 스크립트 파일이면 그 옆에 `.suite.json` 을 제안한다. */
const SCRIPT_EXT = /\.(?:[cm]?js|ts|py)$/i;

export function suggestOutPathFor(input: {
  readonly transport: "stdio" | "http";
  readonly args: readonly string[];
  /** 후보를 읽은 파일의 루트 상대경로(`ServerCandidate.path`). manual 이면 null. */
  readonly sourcePath: string | null;
  readonly candidateName: string | null;
}): string {
  if (input.transport === "http") return "";
  const script = input.args.find((arg) => SCRIPT_EXT.test(arg));
  if (script !== undefined) return `${script.replace(/\.[^./\\]+$/, "")}.suite.json`;
  if (input.sourcePath !== null && input.candidateName !== null) {
    const dir = input.sourcePath.includes("/")
      ? input.sourcePath.slice(0, input.sourcePath.lastIndexOf("/"))
      : "";
    return `${dir === "" ? "" : `${dir}/`}${input.candidateName}.suite.json`;
  }
  return "";
}

/**
 * `--out` 파일명에서 `.suite.json` / `.json` 을 대소문자 무관하게 벗긴 것. 빈 문자열이면 제안 없음.
 *
 * CLI 의 `deriveSuiteName`(`packages/cli/src/generate-command.ts:364`)과 같은 규칙이다.
 * 그 함수는 export 되지 않았고 web 은 `src` 를 import 하지 않으므로 복제했다. 두 벌이 갈리는
 * 것은 `suggest-out-path.test.ts` 의 입력·출력 표가 막는다.
 */
export function deriveSuiteName(outPath: string): string {
  const base = outPath.split(/[/\\]/).pop() ?? "";
  const strip = (v: string, suffix: string) =>
    v.toLowerCase().endsWith(suffix) ? v.slice(0, -suffix.length) : v;
  return strip(strip(base, ".json"), ".suite");
}
