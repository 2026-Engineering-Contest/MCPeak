/** 리포트·기준 파일·진단·오류 문장에 싣는 URL 모양. 스킴·userinfo·fragment 를 지우고 쿼리 값을 가린다. */
export function displayUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "[URL]";
  }
  const names = [...parsed.searchParams.keys()];
  const query = names.length === 0 ? "" : `?${names.map((name) => `${name}=…`).join("&")}`;
  return `${parsed.host}${parsed.pathname}${query}`;
}
