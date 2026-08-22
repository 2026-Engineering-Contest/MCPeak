/**
 * 민감 키 판정 — **legacy Tool 카세트와 External 이 함께 쓰는 단 하나의 구현**이다.
 *
 * 한때 양쪽이 같은 알고리즘을 각자 들고 있었다. 알고리즘은 ADR-0039·0045 가 정의하는데
 * 그 규칙이 바뀌면 두 곳을 고쳐야 하고, 한쪽만 고치면 조용히 갈라진다. 갈라진 것을
 * 알아차리는 방법도 없다 — 양쪽 테스트가 각자의 사본을 보고 각자 통과하기 때문이다.
 *
 * `.mjs` 인 이유는 자식 프로세스가 `--import` 로 이 코드를 로드하기 때문이다. 자식
 * 진입점은 TypeScript 가 아니라 순수 ESM 이어야 한다(Node 22.18 은 type stripping 이
 * 기본이 아니다). 타입은 `sensitive-keys.d.mts` 가 붙인다.
 *
 * 목록은 **version 별 불변 스냅샷**으로 준다. legacy 는 최신을 쓰고 external 은 자기
 * interaction schema version 의 스냅샷을 쓴다. 목록에 단어를 추가해도 기존 스냅샷은
 * 그대로이므로, 이미 저장된 카세트의 matchKey 가 바뀌지 않는다. 이 분리가 없으면 목록
 * 추가가 곧 양쪽 version 동반 상향이 된다(계획서 B-0).
 */

/**
 * version 1 스냅샷. **이 배열은 절대 수정하지 않는다.** 단어를 추가하려면 version 2
 * 스냅샷을 새로 만든다. 여기를 고치면 이미 나간 세션의 matchKey 가 소리 없이 바뀐다.
 *
 * `key` 로 끝나는 것은 합성어만 넣는다. `key` 단독을 넣지 않는 이유는 ADR-0039 에 있고,
 * `auth`·`pwd`·`bearer` 를 뺀 이유는 ADR-0045 에 있다.
 */
const SNAPSHOT_V1 = Object.freeze([
  "authorization",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "token",
  "secret",
  "password",
  "cookie",
  // 아래부터 ADR-0045. `secretkey` 는 `secret` 이 목록에 있어도 접미 조합이 `key` ·
  // `secretkey` 라 어디에도 걸리지 않았다. `apikey` 와 같은 구멍이었다.
  "privatekey",
  "secretkey",
  "signingkey",
  "sessionkey",
  "credential",
  "passwd",
]);

/** version → 스냅샷. 새 version 을 추가할 때 기존 항목은 건드리지 않는다. */
const SNAPSHOTS = new Map([[1, SNAPSHOT_V1]]);

/** 최신 스냅샷의 version. legacy 는 항상 이것을 쓴다. */
export const LATEST_SENSITIVE_KEYS_VERSION = 1;

/**
 * 해당 version 의 민감 키 목록을 준다. 없는 version 은 던진다 — 조용히 최신으로
 * 넘어가면 옛 세션을 새 규칙으로 읽게 된다.
 */
export function sensitiveKeysOf(version) {
  const snapshot = SNAPSHOTS.get(version);
  if (snapshot === undefined)
    throw new Error(`민감 키 목록 version ${version}을 알지 못합니다. 알려진 version: 1`);
  return snapshot;
}

/**
 * 키를 단어열로 쪼갠다.
 *
 * 구분자를 **지워서** 이어 붙이면 경계 정보가 사라져 `tokenCount` 와 `accessToken` 을
 * 구분할 수 없다. 그래서 지우지 않고 쪼갠다.
 */
export const keyWords = (key) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    // 연속 대문자 뒤에 단어가 오는 경우. `APIKey` → `API Key`
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[-_ ]+/)
    // 꼬리 숫자는 떼어 낸다. `apiKey0` 은 여전히 API 키다. 머리 명사를 바꾸지 않으므로
    // `cookieCount2` 가 새로 걸리지도 않는다.
    .map((word) => word.toLowerCase().replace(/[0-9]+$/, ""))
    .filter((word) => word.length > 0);

/**
 * 키의 **접미 단어열**이 목록과 정확히 일치하면 민감으로 본다.
 *
 * 부분 문자열 포함이 아니다. 영어 합성명사는 마지막 단어가 머리라서 `accessToken` 은
 * 토큰의 일종이고 `tokenCount` 는 개수의 일종이다. 포함으로 보면 둘이 구분되지 않아
 * `tokenCount`·`passwordPolicy`·`secretariat` 이 전부 걸린다. 과잉 마스킹은 값을 지우므로
 * ADR-0041 이후에는 "그 필드를 테스트가 영영 못 본다" 가 된다.
 *
 * 접미로 보되 한 단어씩만 보지 않는 이유는 `X-Api-Key` 다. 마지막 단어 `key` 는 목록에
 * 없고 `apikey` 가 있다.
 *
 * 목록이 단수형만 담으므로 꼬리 `s` 를 뗀 형태도 함께 조회한다. 이 완화가 좁은 이유는,
 * 목록 단어에 `s` 를 붙여 만들어지는 영어 단어가 전부 그 비밀값의 복수형이기 때문이다
 * (`tokens`·`secrets`·`cookies`). 머리 명사는 건드리지 않으므로 `tokenCounts` ·
 * `secretariats` 는 계속 통과한다. 근거는 ADR-0045 이다.
 */
export function sensitiveKeyIn(keys, key) {
  const words = keyWords(key);
  for (let start = words.length - 1; start >= 0; start -= 1) {
    const joined = words.slice(start).join("");
    if (keys.includes(joined)) return true;
    if (joined.endsWith("s") && keys.includes(joined.slice(0, -1))) return true;
  }
  return false;
}
