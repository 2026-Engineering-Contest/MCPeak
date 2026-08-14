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

/** 슬러그 규칙 본체. safeBaseName 과 fieldSlug 가 공유한다. 규칙이 갈리면 id 가 갈린다. */
function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/** MCP 도구 이름을 경로 구분자가 없는 결정론적인 파일 기본 이름으로 바꾼다. */
export function safeBaseName(name: string, _index: number): string {
  const slug = slugify(name);

  return slug.length === 0 || WINDOWS_RESERVED_NAMES.test(slug) ? fallbackBaseName(name) : slug;
}

/**
 * 필드 이름을 케이스 id 조각으로 바꾼다.
 *
 * safeBaseName 과 fallback 이 다르다. 그쪽은 파일 기본 이름이라 `tool-<hash>` 로 떨어지고
 * Windows 예약어를 피해야 한다. 케이스 id 는 파일 이름이 아니므로 예약어를 피할 이유가 없고,
 * fallback 이 `tool-` 이면 이름이 거짓이 된다.
 */
export function fieldSlug(name: string): string {
  const slug = slugify(name);
  return slug.length === 0
    ? `field-${createHash("sha256").update(name.normalize("NFC")).digest("hex").slice(0, 8)}`
    : slug;
}
