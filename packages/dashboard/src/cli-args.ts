/**
 * `mcpeak-dashboard` 의 인자 해석과 화면 문안. `dashboard-cli.ts` 는 맨 아래에서 `main()` 을
 * 실행하므로 import 만 해도 서버가 뜬다 — 그래서 그 파일에 있던 `parsePort` 는 export 인데도
 * 테스트가 한 건도 없었다. 부수효과 없는 자리로 옮겨 검증할 수 있게 한다.
 */

export const DEFAULT_PORT = 7357;

/**
 * `--port <번호>` 만 받는다. 값이 없거나 포트 범위를 벗어나면 그 자리에서 끊는다.
 * 브라우저 자동 오픈은 하지 않는다. URL 을 찍고 사용자가 연다.
 */
export function parsePort(argv: readonly string[]): number | { readonly error: string } {
  const index = argv.indexOf("--port");
  if (index === -1) return DEFAULT_PORT;
  const raw = argv[index + 1];
  if (raw === undefined) {
    return {
      error: "`--port` 뒤에 포트 번호가 없습니다.\n해결: `--port 7357` 처럼 번호를 붙이세요.",
    };
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return {
      error: `\`--port\` 값이 포트 번호가 아닙니다: ${raw}\n해결: 0 이상 65535 이하의 정수를 주세요(0 이면 빈 포트를 자동으로 고릅니다).`,
    };
  }
  return port;
}

/**
 * 값을 받지 않으므로 `--port` 와 달리 위치를 따지지 않는다. argv 어디에 있든 도움말이 이긴다.
 * `--port` 값이 잘못된 채로 `--help` 를 준 경우에도 도움말이 나가야 한다 — 그 값을 어떻게
 * 고치는지가 도움말에 적혀 있기 때문이다.
 */
export function wantsHelp(argv: readonly string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

/**
 * `--help` 가 없던 동안 사용자가 `--port` 의 존재를 알 방법이 없었다(#296).
 * 탐색 루트를 여기에도 적는다 — 첫 화면이 비는 이유가 거의 언제나 그 경로다.
 */
export const USAGE = `사용법: mcpeak-dashboard [--port <번호>]

테스트 스위트를 브라우저에서 보고 실행하는 로컬 대시보드를 띄웁니다.

  --port <번호>   대시보드가 쓸 포트. 기본 ${DEFAULT_PORT} 입니다.
                  0 이면 빈 포트를 자동으로 고릅니다.
  --help, -h      이 도움말을 보여주고 끝냅니다.

스위트는 명령을 실행한 디렉터리 아래에서 찾습니다. 목록이 비어 있으면 먼저 그 경로를
확인하세요 — 기동할 때 함께 찍습니다.
`;

/**
 * 기동 줄에 탐색 루트를 함께 싣는다. 도구는 이 값을 이미 쥐고 있는데(`startDashboardServer`
 * 의 `root`) 지금까지 URL 만 찍고 버렸다. 첫 화면이 비는 이유가 100% 이 경로였는데도
 * 사용자가 그것을 알 자리가 없었다(#296).
 */
export function startupLine(port: number, root: string): string {
  return `대시보드: http://localhost:${port}  (스위트 탐색 루트: ${root})\n`;
}
