import { resolve, sep } from "node:path";

/**
 * 프로젝트 루트 밖 접근 차단. 절대경로·`..` 탈출 전부 거부.
 * 반환값은 절대경로, 거부는 null이다. 예외를 던지지 않는 이유는 호출부가
 * 404가 아니라 400으로 구분 응답해야 하기 때문이다.
 */
export function resolveProjectPath(root: string, relative: string): string | null {
  if (relative.startsWith("/") || relative.includes("\0")) return null;
  const absolute = resolve(root, relative);
  const rootAbs = resolve(root);
  if (absolute !== rootAbs && !absolute.startsWith(rootAbs + sep)) return null;
  return absolute;
}
