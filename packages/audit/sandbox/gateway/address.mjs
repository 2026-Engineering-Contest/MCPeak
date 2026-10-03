// @ts-check
import { isIP, isIPv4, isIPv6 } from "node:net";

/** §3.7 의 호스트 이름 문법. SNI 와 Host 를 파일 이름이나 명령 인자로 쓰기 전에 이것으로 거른다. */
export const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

const HOSTNAME_MAX_LENGTH = 253;

/**
 * 소문자 호스트 이름인가. IP 주소는 문법에는 맞아도(숫자 라벨) 이름이 아니다.
 * @param {string} value
 * @returns {boolean}
 */
export function isHostname(value) {
  return (
    value.length > 0 &&
    value.length <= HOSTNAME_MAX_LENGTH &&
    HOSTNAME_PATTERN.test(value) &&
    isIP(value) === 0
  );
}

/**
 * `Host` 헤더에서 포트를 떼고 이름을 소문자로 만든다. 목적지 포트는 받은 포트가 정하므로 버린다.
 * @param {string | undefined} value
 * @returns {{ host: string, isIp: boolean }}
 */
export function splitHostHeader(value) {
  const raw = (value ?? "").trim().toLowerCase();
  const bracketed = /^\[([^\]]*)\](?::\d*)?$/.exec(raw);
  if (bracketed) {
    const host = bracketed[1] ?? "";
    return { host, isIp: isIPv6(host) };
  }
  if (isIPv6(raw)) return { host: raw, isIp: true };
  const host = raw.replace(/:\d*$/, "");
  return { host, isIp: isIP(host) !== 0 };
}

/**
 * @param {string} address
 * @returns {number | null} 부호 없는 32비트 값
 */
function ipv4ToNumber(address) {
  if (!isIPv4(address)) return null;
  let value = 0;
  for (const part of address.split(".")) value = value * 256 + Number(part);
  return value;
}

/**
 * IPv6 문자열을 16비트 조각 여덟 개로 편다. 끝에 붙은 IPv4 표기(`::ffff:1.2.3.4`)도 받는다.
 * @param {string} address
 * @returns {number[] | null}
 */
function ipv6ToGroups(address) {
  if (!isIPv6(address)) return null;
  let text = address.split("%")[0] ?? "";
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = ipv4ToNumber(tail);
    if (v4 === null) return null;
    text = `${text.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const [head = "", rest] = text.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = rest === undefined || rest === "" ? [] : rest.split(":");
  const fill = rest === undefined ? 0 : 8 - left.length - right.length;
  if (fill < 0) return null;
  const groups = [...left, ...Array(fill).fill("0"), ...right].map((group) =>
    Number.parseInt(group, 16),
  );
  return groups.length === 8 && groups.every((group) => Number.isInteger(group)) ? groups : null;
}

/** §3.4 의 내부 주소 표 가운데 IPv4 대역. [시작 주소, 접두 길이]. 0.0.0.0/8 은 아래 주석을 본다. */
const INTERNAL_V4 = /** @type {ReadonlyArray<readonly [string, number]>} */ ([
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  // 표에는 없다. 리눅스에서 0.0.0.0 으로의 접속은 자기 자신에게 닿으므로 루프백과 같이 막는다.
  ["0.0.0.0", 8],
]);

/**
 * @param {number} value
 * @param {string} base
 * @param {number} prefix
 */
function inV4Range(value, base, prefix) {
  const start = ipv4ToNumber(base);
  if (start === null) return false;
  const size = 2 ** (32 - prefix);
  return value >= start && value < start + size;
}

/**
 * 게이트웨이가 전달하면 안 되는 주소인가(§3.4 의 내부 주소 표). 주소로 읽히지 않는 값도 true 다.
 * 모르는 것에는 접속하지 않는 쪽으로 틀린다.
 * @param {string} address
 * @returns {boolean}
 */
export function isInternalAddress(address) {
  const v4 = ipv4ToNumber(address);
  if (v4 !== null) return INTERNAL_V4.some(([base, prefix]) => inV4Range(v4, base, prefix));
  const groups = ipv6ToGroups(address);
  if (groups === null) return true;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  const leadingZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  // IPv4 를 감싼 주소(::ffff:a.b.c.d)는 안의 IPv4 로 판정한다. 감싸서 표를 비켜 가지 못하게 한다.
  if (leadingZero && g5 === 0xffff) {
    const mapped = g6 * 65536 + g7;
    return INTERNAL_V4.some(([base, prefix]) => inV4Range(mapped, base, prefix));
  }
  // :: (미지정)과 ::1.
  if (leadingZero && g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) return true;
  // fc00::/7
  if ((g0 & 0xfe00) === 0xfc00) return true;
  // fe80::/10
  if ((g0 & 0xffc0) === 0xfe80) return true;
  return false;
}

/**
 * 네트워크 인터페이스 가운데 주어진 IPv4 CIDR 에 든 주소 하나를 찾는다. 인터페이스 이름 순서
 * (eth0·eth1)가 실행마다 달라서 이름이 아니라 서브넷으로 고른다.
 * @param {Readonly<Record<string, ReadonlyArray<{ address: string, family: string | number }> | undefined>>} interfaces
 *   `os.networkInterfaces()` 의 결과
 * @param {string} cidr 예: `172.24.0.0/16`
 * @returns {string | null}
 */
export function addressInSubnet(interfaces, cidr) {
  const match = /^([^/]+)\/(\d{1,2})$/.exec(cidr);
  if (!match) return null;
  const base = ipv4ToNumber(match[1] ?? "");
  const prefix = Number(match[2]);
  if (base === null || prefix > 32) return null;
  const size = 2 ** (32 - prefix);
  const start = Math.floor(base / size) * size;
  const found = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      const value = ipv4ToNumber(entry.address);
      if (value !== null && value >= start && value < start + size) found.push(entry.address);
    }
  }
  // 둘 이상이면 문자열 순으로 첫째. 인터페이스 순서에 기대지 않는다.
  found.sort();
  return found[0] ?? null;
}
