/**
 * 이미지 태그의 내용 해시. 파일 목록을 경로 순으로 정렬해 "<path>\0<content>\0" 를 이어 붙인 것의
 * sha256 앞 12자다. 본문은 T1 이 채운다.
 */
export function sandboxImageTag(
  files: ReadonlyArray<{ readonly path: string; readonly content: string }>,
): string {
  throw new Error("not implemented");
}
