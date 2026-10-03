import { createHash } from "node:crypto";

/**
 * 이미지 태그의 내용 해시. 파일 목록을 경로 순으로 정렬해 "<path>\0<content>\0" 를 이어 붙인 것의
 * sha256 앞 12자다. 같은 Dockerfile 과 게이트웨이 소스면 어느 머신에서도 같은 태그가 나온다.
 */
export function sandboxImageTag(
  files: ReadonlyArray<{ readonly path: string; readonly content: string }>,
): string {
  // localeCompare 는 로케일에 따라 순서가 달라진다. 코드 단위로 비교한다.
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hash = createHash("sha256");
  for (const file of sorted) hash.update(`${file.path}\0${file.content}\0`);
  return hash.digest("hex").slice(0, 12);
}
