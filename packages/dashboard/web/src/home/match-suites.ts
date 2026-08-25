/**
 * 고른 서버에 딸린 스위트 고르기(홈 3단계 마법사 2단계).
 *
 * **generate 의 `suggestOutPathFor` 를 거꾸로 읽은 것이 이 파일이다.** 생성은 서버
 * 스크립트 옆에 `<이름>.suite.json` 을 제안한다. 그러니 실행은 같은 규칙으로 되짚으면
 * 그 서버가 만든 스위트를 찾아낸다. 두 규칙이 갈리면 방금 만든 스위트가 실행 화면에서
 * 안 보이므로, 확장자 표는 그쪽과 같은 값을 쓴다.
 */

import type { FileEntry } from "../../../src/api-types.js";

/** `suggest.ts` 와 같은 표. 여기가 갈리면 generate 가 만든 스위트를 홈이 못 찾는다. */
const SCRIPT_EXT = /\.(?:[cm]?js|ts|py)$/i;

/** `<접두사>.suite<무엇이든>.json` 또는 `<접두사>.json`. 경로 구분자는 넘지 않는다. */
const SUFFIX = /^(?:\.suite[^/\\]*)?\.json$/i;

export interface SuiteMatch {
  /** 고른 서버의 스크립트 이름에서 파생된 스위트. 목록 위쪽에 그대로 편다. */
  readonly matched: readonly FileEntry[];
  /** 나머지 전부. 접어 두고 「다른 스위트 보기」로 편다. */
  readonly others: readonly FileEntry[];
}

/**
 * 서버 인자에서 스크립트를 찾아 확장자를 벗긴 접두사. 스크립트 인자가 없으면(HTTP 대상,
 * npx 패키지, 실행 파일만 적은 직접 입력) null 이고, 그 경우 매칭은 0건이다.
 */
export function suitePrefix(args: readonly string[]): string | null {
  const script = args.find((arg) => SCRIPT_EXT.test(arg));
  return script === undefined ? null : script.replace(/\.[^./\\]+$/, "");
}

/**
 * 스위트 목록을 매칭과 나머지로 가른다. **원래 순서를 지킨다.** 목록은 서버가 정렬해 주는
 * 것이고, 여기서 다시 섞으면 같은 프로젝트에서 화면마다 순서가 달라진다.
 */
export function matchSuites(args: readonly string[], suites: readonly FileEntry[]): SuiteMatch {
  const prefix = suitePrefix(args);
  if (prefix === null) {
    return { matched: [], others: suites };
  }
  const matched: FileEntry[] = [];
  const others: FileEntry[] = [];
  for (const suite of suites) {
    const rest = suite.path.startsWith(prefix) ? suite.path.slice(prefix.length) : null;
    (rest !== null && SUFFIX.test(rest) ? matched : others).push(suite);
  }
  return { matched, others };
}
