/**
 * 사용자가 준 서버 명령에서 격리 이미지가 실행할 이름만 남긴다.
 *
 * 두 가지를 뗀다.
 *
 * 1. **디렉터리.** 호스트의 절대 경로(`/opt/homebrew/bin/node`,
 *    `C:\Program Files\nodejs\node.exe`)는 컨테이너에 없다. 이름만 남겨 이미지의 PATH 에서 찾게
 *    한다. `/` 와 `\` 둘 다로 자른다.
 * 2. **윈도우 실행 파일 확장자.** 윈도우에서 node 는 `node.exe` 이고 npm·npx 는 `npm.cmd`·`npx.cmd`
 *    다. 런처나 IDE, `process.execPath` 가 흔히 그렇게 넘긴다. 떼지 않으면 허용 목록을 통과하지
 *    못하고(#540), 통과시켜도 리눅스 이미지 안에 `node.exe` 라는 파일은 없다.
 *
 * `process.platform` 을 보지 않고 글자로만 판정한다. 플랫폼으로 갈리면 같은 입력이 머신마다 다른
 * 결과를 내 결정론이 깨진다. 리눅스에 `node.exe` 라는 실행 파일을 두는 일은 없으므로 글자 규칙으로
 * 잃는 것이 없다.
 *
 * **격리의 네 판정이 모두 이 함수를 쓴다** — 허용 목록(`audit.ts`), 컨테이너에 실제로 넘길 명령과
 * npm 캐시 tmpfs 를 열지 여부(`sandbox/docker.ts`), 잡음 표의 실행기 판정(`sandbox/noise.ts`).
 * 규칙이 갈리면 tmpfs 는 열렸는데 잡음 행은 걸리지 않는 식으로 조용히 어긋난다.
 */

/**
 * 뗄 확장자. 윈도우에서 명령으로 직접 실행되는 것만 둔다.
 *
 * `.com` 은 넣지 않는다. 지금 윈도우에서 `.com` 실행 파일은 사실상 없고, 넣으면 `mcp-server.com`
 * 처럼 도메인 꼴 이름을 가진 명령에서 엉뚱하게 잘린다. `.ps1` 도 넣지 않는다 — 명령 자리에 그대로
 * 둘 수 없고 `powershell -File` 로 불러야 하므로 여기 올 수 없다.
 */
const EXECUTABLE_EXTENSIONS = [".exe", ".cmd", ".bat"] as const;

export function commandName(command: string): string {
  const base = command.split(/[\\/]/).pop() || command;
  const lowered = base.toLowerCase();
  const extension = EXECUTABLE_EXTENSIONS.find((candidate) => lowered.endsWith(candidate));
  // 확장자가 이름 전체인 경우(`.exe`)는 떼지 않는다. 빈 이름은 어떤 허용 목록에도 들지 못하면서
  // 실패 문장에서는 무엇을 준 것인지조차 보이지 않게 만든다.
  if (extension === undefined || lowered === extension) return base;
  return base.slice(0, -extension.length);
}
