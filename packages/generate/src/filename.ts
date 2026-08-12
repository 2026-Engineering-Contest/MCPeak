const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** MCP 도구 이름을 경로 구분자가 없는 결정론적인 파일 기본 이름으로 바꾼다. */
export function safeBaseName(name: string, index: number): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");

  return slug.length === 0 || WINDOWS_RESERVED_NAMES.test(slug) ? `tool-${index + 1}` : slug;
}
