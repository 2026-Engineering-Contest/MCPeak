import { isIP } from "node:net";
import type { CollectedString, SandboxOptions } from "../types.js";

/** `npx` 가 패키지를 받는 곳이라 언제나 선언으로 본다. */
const ALWAYS_DECLARED = "registry.npmjs.org";

/** 문자열 안의 URL. 전역 플래그라 `matchAll` 로만 쓴다(`lastIndex` 공유 방지). */
const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]]+/g;
/** 문장 끝에 붙은 구두점. URL 의 일부가 아니다. */
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;
/** 게이트웨이가 SNI 에 요구하는 것과 같은 호스트 이름 문법. */
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
/** 바깥에 실재하지 않는 이름이라 선언으로 받지 않는 최상위 레이블. */
const RESERVED_TOP_LABELS = new Set(["invalid", "localhost", "local", "example"]);

/** 선언으로 받을 수 있는 호스트면 소문자 이름, 아니면 undefined. */
function declarableHost(hostname: string): string | undefined {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.length > 253 || !HOSTNAME.test(host)) return undefined;
  if (isIP(host) !== 0) return undefined;
  if (RESERVED_TOP_LABELS.has(host.slice(host.lastIndexOf(".") + 1))) return undefined;
  return host;
}

/** 문자열 안의 `http://`·`https://` URL 의 호스트들. 풀리지 않는 것은 버린다. */
function hostsInText(text: string): string[] {
  const hosts: string[] = [];
  for (const [match] of text.matchAll(URL_PATTERN)) {
    let hostname: string;
    try {
      hostname = new URL(match.replace(TRAILING_PUNCTUATION, "")).hostname;
    } catch {
      continue;
    }
    const host = declarableHost(hostname);
    if (host !== undefined) hosts.push(host);
  }
  return hosts;
}

/** `package.json` 의 `homepage`, `repository`(문자열 또는 `.url`), `bugs`(문자열 또는 `.url`). */
function hostsInPackageJson(text: string): string[] {
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof manifest !== "object" || manifest === null) return [];
  const fields = manifest as Record<string, unknown>;
  const urlOf = (value: unknown): unknown =>
    typeof value === "object" && value !== null ? (value as Record<string, unknown>).url : value;
  return [fields.homepage, urlOf(fields.repository), urlOf(fields.bugs)].flatMap((value) =>
    typeof value === "string" ? hostsInText(value) : [],
  );
}

/** 사용자가 등록 전에 읽는 자리인가. 도구·프롬프트·리소스의 설명과 `instructions` 다. */
function isDeclaringString(item: CollectedString): boolean {
  if (item.isKey) return false;
  const { kind, path } = item.location;
  if (kind === "instructions") return true;
  if (kind !== "tool" && kind !== "prompt" && kind !== "resource") return false;
  return path === "description" || path.endsWith(".description");
}

/**
 * 선언된 목적지 목록. 소문자, 중복 제거, 정렬. `--allow-host` 만 하위 도메인까지 덮는 `*.` 항목을
 * 함께 낸다. 서버가 쓴 글(설명·README·package.json)에서 온 호스트는 정확히 그 이름만 선언이다.
 */
export function extractDeclaredHosts(input: {
  readonly allowHosts: readonly string[];
  readonly surfaceStrings: readonly CollectedString[];
  readonly declarationTexts: SandboxOptions["declarationTexts"];
}): readonly string[] {
  const hosts = new Set<string>([ALWAYS_DECLARED]);
  for (const value of input.allowHosts) {
    const host = value.trim().toLowerCase();
    if (host === "") continue;
    hosts.add(host);
    if (!host.startsWith("*.")) hosts.add(`*.${host}`);
  }
  for (const item of input.surfaceStrings) {
    if (!isDeclaringString(item)) continue;
    for (const host of hostsInText(item.raw)) hosts.add(host);
  }
  for (const { source, text } of input.declarationTexts) {
    const found = source === "package.json" ? hostsInPackageJson(text) : hostsInText(text);
    for (const host of found) hosts.add(host);
  }
  return [...hosts].sort();
}
