/**
 * `<헤더이름>=<환경변수이름>` 판정 한 벌. `build-test-argv.ts` 와 `generate/build-argv.ts` 가
 * 같은 문장으로 거절해야 폼이 만든 조합이 서버에서 처음 깨지는 일이 없다.
 */

/**
 * `<헤더이름>=<환경변수이름>` 인지 본다. CLI 의 `parseHeaderEnvOption` 과 같은 자리에서
 * 거절해야 폼이 만든 조합이 서버에서 처음 깨지는 일이 없다. 문자 종류까지는 보지 않는다 —
 * 그 판정은 CLI 가 헤더 토큰·환경변수 이름 패턴으로 더 정확히 한다.
 */
export function isHeaderEnv(entry: string): boolean {
  const separator = entry.indexOf("=");
  return separator > 0 && entry.slice(separator + 1) !== "";
}
