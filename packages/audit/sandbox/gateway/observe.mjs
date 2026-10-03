// @ts-check
import { promisify } from "node:util";
import { brotliDecompress, gunzip, inflate } from "node:zlib";

/**
 * @typedef {import("../../src/types.js").ObservedRequest} ObservedRequest
 * @typedef {import("../../src/types.js").SandboxPhase} SandboxPhase
 */

/** 요청 본문을 기록에 싣는 상한(§3.7). 전달은 이 값과 무관하게 전부 한다. */
export const BODY_RECORD_LIMIT = 1_048_576;

/**
 * 압축을 풀 때의 출력 상한. 작은 압축본이 기가바이트로 부푸는 것을 막는다. 넘으면 풀기 실패로 보고
 * 받은 그대로 기록한다.
 */
const DECODE_OUTPUT_LIMIT = 64 * 1024 * 1024;

const decoders =
  /** @type {Readonly<Record<string, (input: Buffer, options: { maxOutputLength: number }) => Promise<Buffer>>>} */ ({
    gzip: promisify(gunzip),
    "x-gzip": promisify(gunzip),
    deflate: promisify(inflate),
    br: promisify(brotliDecompress),
  });

/**
 * `content-encoding` 이 gzip·deflate·br 이면 푼다. 실패하면 받은 그대로다.
 * @param {Buffer} raw
 * @param {string | undefined} contentEncoding
 * @returns {Promise<Buffer>}
 */
export async function decodeBody(raw, contentEncoding) {
  const decode = decoders[(contentEncoding ?? "").trim().toLowerCase()];
  if (decode === undefined || raw.length === 0) return raw;
  try {
    return await decode(raw, { maxOutputLength: DECODE_OUTPUT_LIMIT });
  } catch {
    return raw;
  }
}

/**
 * 헤더 이름을 소문자로 바꾸고 (이름, 값) 순으로 정렬한다. 비교는 코드 단위다.
 * @param {ReadonlyArray<string>} rawHeaders `IncomingMessage.rawHeaders` (이름, 값이 번갈아 온다)
 * @returns {Array<[string, string]>}
 */
export function normalizeHeaders(rawHeaders) {
  /** @type {Array<[string, string]>} */
  const pairs = [];
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    pairs.push([(rawHeaders[index] ?? "").toLowerCase(), rawHeaders[index + 1] ?? ""]);
  }
  return pairs.sort(([aName, aValue], [bName, bValue]) =>
    aName < bName ? -1 : aName > bName ? 1 : aValue < bValue ? -1 : aValue > bValue ? 1 : 0,
  );
}

/**
 * 요청 하나의 기록을 만든다. 키 순서는 `ObservedRequest` 의 선언 순서다.
 * @param {{
 *   phase: SandboxPhase,
 *   scheme: "http" | "https",
 *   host: string,
 *   port: number,
 *   method: string,
 *   path: string,
 *   rawHeaders: ReadonlyArray<string>,
 *   body: Buffer,
 *   served: ObservedRequest["served"],
 * }} input `body` 는 `decodeBody` 를 거친 본문 전체
 * @returns {ObservedRequest}
 */
export function observeRequest(input) {
  const truncated = input.body.length > BODY_RECORD_LIMIT;
  return {
    phase: input.phase,
    scheme: input.scheme,
    host: input.host,
    port: input.port,
    method: input.method,
    path: input.path,
    headers: normalizeHeaders(input.rawHeaders),
    bodyBase64: (truncated ? input.body.subarray(0, BODY_RECORD_LIMIT) : input.body).toString(
      "base64",
    ),
    bodyTruncated: truncated,
    served: input.served,
  };
}
