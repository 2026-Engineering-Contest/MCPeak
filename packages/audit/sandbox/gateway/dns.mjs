// @ts-check
import { isIPv4 } from "node:net";

const TYPE_A = 1;
const CLASS_IN = 1;
const RCODE_NOERROR = 0;
const RCODE_SERVFAIL = 2;
const RCODE_NXDOMAIN = 3;

/**
 * RFC 6761 의 예약 이름. 이 이름들은 밖으로 나갈 곳이 없다. 단계 1 의 자리값 `example.invalid` 가
 * 요청을 만들지 않게 한다.
 * @param {string} name 소문자 이름
 */
function isReserved(name) {
  return (
    name === "localhost" ||
    name.endsWith(".invalid") ||
    name.endsWith(".localhost") ||
    name.endsWith(".local")
  );
}

/**
 * 질문 절 하나를 읽는다. 질문에는 압축 포인터가 올 수 없으므로 길이 바이트의 위 두 비트가 서 있으면 깨진 것이다.
 * @param {Buffer} packet
 * @returns {{ name: string, type: number, qclass: number, end: number } | null}
 */
function readQuestion(packet) {
  let offset = 12;
  /** @type {string[]} */
  const labels = [];
  let total = 0;
  for (;;) {
    if (offset >= packet.length) return null;
    const length = packet.readUInt8(offset);
    offset += 1;
    if (length === 0) break;
    if (length > 63 || offset + length > packet.length) return null;
    total += length + 1;
    if (total > 255) return null;
    labels.push(packet.subarray(offset, offset + length).toString("latin1"));
    offset += length;
  }
  if (offset + 4 > packet.length) return null;
  return {
    name: labels.join("."),
    type: packet.readUInt16BE(offset),
    qclass: packet.readUInt16BE(offset + 2),
    end: offset + 4,
  };
}

/**
 * DNS 질의 하나에 답을 만든다. 순수 함수다. 소켓도 기록도 건드리지 않는다.
 *
 * - `A` 질의에는 `address` 하나를 TTL 0 으로 준다. 어떤 이름이든 게이트웨이로 오게 하는 것이 목적이다.
 * - `AAAA` 와 그 밖의 유형은 답이 0개인 NOERROR 다. IPv6 로 게이트웨이를 비켜 가지 못하게 한다.
 * - 예약 이름은 NXDOMAIN 이다.
 * - 질문 절은 받은 바이트 그대로 되돌린다(대소문자를 섞어 응답을 검증하는 리졸버가 있다).
 * - 깨진 패킷에는 답하지 않는다(null). 던지지 않는다.
 *
 * @param {Buffer} packet
 * @param {string | null} address 줄 IPv4 주소. 모르면 null 이고 그때 `A` 질의는 SERVFAIL 이다
 * @returns {{ name: string, response: Buffer } | null} `name` 은 소문자다
 */
export function answerDnsQuery(packet, address) {
  if (packet.length < 12) return null;
  const flags = packet.readUInt16BE(2);
  const isResponse = (flags & 0x8000) !== 0;
  const opcode = (flags >> 11) & 0x0f;
  if (isResponse || opcode !== 0 || packet.readUInt16BE(4) !== 1) return null;
  const question = readQuestion(packet);
  if (question === null) return null;

  const name = question.name.toLowerCase();
  let rcode = RCODE_NOERROR;
  /** @type {Buffer | null} */
  let answer = null;
  if (isReserved(name)) {
    rcode = RCODE_NXDOMAIN;
  } else if (question.type === TYPE_A && question.qclass === CLASS_IN) {
    if (address !== null && isIPv4(address)) {
      answer = Buffer.alloc(16);
      answer.writeUInt16BE(0xc00c, 0); // 이름: 질문 절을 가리키는 포인터
      answer.writeUInt16BE(TYPE_A, 2);
      answer.writeUInt16BE(CLASS_IN, 4);
      answer.writeUInt32BE(0, 6); // TTL 0
      answer.writeUInt16BE(4, 10);
      Buffer.from(address.split(".").map(Number)).copy(answer, 12);
    } else {
      rcode = RCODE_SERVFAIL;
    }
  }

  const header = Buffer.alloc(12);
  packet.copy(header, 0, 0, 2);
  // QR=1, AA=1, RD 는 받은 대로, RA=1. RA 를 세우지 않으면 재귀 불가로 보고 다른 서버를 찾는 리졸버가 있다.
  header.writeUInt16BE(0x8000 | 0x0400 | (flags & 0x0100) | 0x0080 | rcode, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(answer === null ? 0 : 1, 6);
  const parts = [header, packet.subarray(12, question.end)];
  if (answer !== null) parts.push(answer);
  return { name, response: Buffer.concat(parts) };
}
