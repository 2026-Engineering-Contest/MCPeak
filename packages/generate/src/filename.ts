import { createHash } from "node:crypto";

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function fallbackBaseName(name: string): string {
  const hash = createHash("sha256").update(name.normalize("NFC")).digest("hex").slice(0, 8);
  return `tool-${hash}`;
}

/** 정규화 결과가 같은 도구 이름을 원문 기준으로 구분하는 안정적인 식별자를 만든다. */
export function nameDiscriminator(name: string): string {
  return createHash("sha256").update(name).digest("hex").slice(0, 8);
}

/** MCP 도구 이름을 경로 구분자가 없는 결정론적인 파일 기본 이름으로 바꾼다. */
export function safeBaseName(name: string, _index: number): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");

  return slug.length === 0 || WINDOWS_RESERVED_NAMES.test(slug) ? fallbackBaseName(name) : slug;
}
