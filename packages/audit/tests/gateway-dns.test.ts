import { describe, expect, it } from "vitest";
import {
  addressInSubnet,
  isHostname,
  isInternalAddress,
  splitHostHeader,
} from "../sandbox/gateway/address.mjs";
import { answerDnsQuery } from "../sandbox/gateway/dns.mjs";

const TYPE_A = 1;
const TYPE_AAAA = 28;
const TYPE_TXT = 16;
const GATEWAY = "172.28.0.2";

/** 질문 하나짜리 표준 질의를 만든다. RD 를 세운다(스텁 리졸버가 보내는 꼴). */
function query(name: string, type: number, id = 0x1234): Buffer {
  const labels = name === "" ? [] : name.split(".");
  const question = Buffer.concat([
    ...labels.map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)])),
    Buffer.from([0]),
    Buffer.from([type >> 8, type & 0xff, 0, 1]),
  ]);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x0100, 2);
  header.writeUInt16BE(1, 4);
  return Buffer.concat([header, question]);
}

interface Parsed {
  readonly id: number;
  readonly isResponse: boolean;
  readonly rcode: number;
  readonly questionCount: number;
  readonly answerCount: number;
  /** 질문 절의 이름을 받은 바이트 그대로 읽은 것. */
  readonly questionName: string;
  readonly answers: ReadonlyArray<{ type: number; ttl: number; data: number[] }>;
}

function parse(response: Buffer): Parsed {
  let offset = 12;
  const labels: string[] = [];
  for (;;) {
    const length = response.readUInt8(offset);
    offset += 1;
    if (length === 0) break;
    labels.push(response.subarray(offset, offset + length).toString("latin1"));
    offset += length;
  }
  offset += 4;
  const answerCount = response.readUInt16BE(6);
  const answers: Array<{ type: number; ttl: number; data: number[] }> = [];
  for (let index = 0; index < answerCount; index += 1) {
    // 답의 이름은 질문을 가리키는 압축 포인터(2바이트)다.
    expect(response.readUInt16BE(offset)).toBe(0xc00c);
    const type = response.readUInt16BE(offset + 2);
    const ttl = response.readUInt32BE(offset + 6);
    const length = response.readUInt16BE(offset + 10);
    answers.push({ type, ttl, data: [...response.subarray(offset + 12, offset + 12 + length)] });
    offset += 12 + length;
  }
  expect(offset).toBe(response.length);
  return {
    id: response.readUInt16BE(0),
    isResponse: (response.readUInt16BE(2) & 0x8000) !== 0,
    rcode: response.readUInt16BE(2) & 0x000f,
    questionCount: response.readUInt16BE(4),
    answerCount,
    questionName: labels.join("."),
    answers,
  };
}

function answer(packet: Buffer, address: string | null = GATEWAY) {
  const result = answerDnsQuery(packet, address);
  if (result === null) throw new Error("응답이 없습니다");
  return { name: result.name, parsed: parse(result.response) };
}

describe("DNS 응답", () => {
  it("A 질의에 gateway 주소 하나를 TTL 0 으로 답한다", () => {
    const { name, parsed } = answer(query("api.example.com", TYPE_A, 0xbeef));

    expect(parsed.id).toBe(0xbeef);
    expect(parsed.isResponse).toBe(true);
    expect(parsed.rcode).toBe(0);
    expect(parsed.questionCount).toBe(1);
    expect(parsed.answers).toEqual([{ type: TYPE_A, ttl: 0, data: [172, 28, 0, 2] }]);
    expect(name).toBe("api.example.com");
  });

  it("AAAA 질의에는 답이 0개인 NOERROR 를 낸다(IPv6 로 빠져나가지 않게)", () => {
    const { name, parsed } = answer(query("api.example.com", TYPE_AAAA));

    expect(parsed.rcode).toBe(0);
    expect(parsed.answers).toEqual([]);
    expect(name).toBe("api.example.com");
  });

  it("A·AAAA 가 아닌 유형도 답이 0개인 NOERROR 다", () => {
    const { parsed } = answer(query("api.example.com", TYPE_TXT));

    expect(parsed.rcode).toBe(0);
    expect(parsed.answers).toEqual([]);
  });

  it("localhost 와 .invalid·.localhost·.local 이름은 NXDOMAIN 이고 dnsNames 에는 남는다", () => {
    for (const reserved of ["localhost", "example.invalid", "db.localhost", "printer.local"]) {
      for (const type of [TYPE_A, TYPE_AAAA]) {
        const { name, parsed } = answer(query(reserved, type));
        expect(parsed.rcode, reserved).toBe(3);
        expect(parsed.answers, reserved).toEqual([]);
        expect(name).toBe(reserved);
      }
    }
  });

  it("예약 이름으로 끝나기만 하고 점으로 나뉘지 않은 이름은 NXDOMAIN 이 아니다", () => {
    for (const ordinary of ["notlocalhost", "mylocal", "api.xinvalid", "local.example.com"]) {
      const { parsed } = answer(query(ordinary, TYPE_A));
      expect(parsed.rcode, ordinary).toBe(0);
      expect(parsed.answers.length, ordinary).toBe(1);
    }
  });

  it("질의 이름을 대소문자 그대로 되돌리고 기록에는 소문자로 남긴다", () => {
    const { name, parsed } = answer(query("ApI.ExAmPlE.CoM", TYPE_A));

    expect(parsed.questionName).toBe("ApI.ExAmPlE.CoM");
    expect(name).toBe("api.example.com");
  });

  it("대문자로 쓴 예약 이름도 NXDOMAIN 이다", () => {
    const { name, parsed } = answer(query("Example.INVALID", TYPE_A));

    expect(parsed.rcode).toBe(3);
    expect(name).toBe("example.invalid");
  });

  it("깨진 패킷은 던지지 않고 버린다", () => {
    const whole = query("api.example.com", TYPE_A);
    const pointer = Buffer.from(whole);
    pointer[12] = 0xc0;
    const asResponse = Buffer.from(whole);
    asResponse.writeUInt16BE(0x8100, 2);
    const noQuestion = Buffer.from(whole);
    noQuestion.writeUInt16BE(0, 4);
    const labelTooLong = Buffer.from(whole);
    labelTooLong[12] = 63;

    const broken: Buffer[] = [
      Buffer.alloc(0),
      Buffer.from([1, 2, 3]),
      whole.subarray(0, 12),
      whole.subarray(0, 20),
      whole.subarray(0, whole.length - 1),
      pointer,
      asResponse,
      noQuestion,
      labelTooLong,
    ];
    for (const packet of broken) {
      expect(() => answerDnsQuery(packet, GATEWAY)).not.toThrow();
      expect(answerDnsQuery(packet, GATEWAY)).toBeNull();
    }
  });

  it("줄 주소를 모르면 A 질의에 SERVFAIL 로 답한다(다른 주소를 지어내지 않는다)", () => {
    const { name, parsed } = answer(query("api.example.com", TYPE_A), null);

    expect(parsed.rcode).toBe(2);
    expect(parsed.answers).toEqual([]);
    expect(name).toBe("api.example.com");
  });
});

describe("내부 주소 표", () => {
  it("§3.4 의 대역은 전부 내부 주소다", () => {
    for (const address of [
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "127.0.0.1",
      "127.8.8.8",
      "169.254.169.254",
      "::1",
      "fc00::1",
      "fdff::1",
      "fe80::1",
      "febf::1",
    ]) {
      expect(isInternalAddress(address), address).toBe(true);
    }
  });

  it("대역 바로 바깥은 내부 주소가 아니다", () => {
    for (const address of [
      "9.255.255.255",
      "11.0.0.1",
      "172.15.255.255",
      "172.32.0.1",
      "192.167.1.1",
      "192.169.1.1",
      "169.253.0.1",
      "169.255.0.1",
      "203.0.113.10",
      "2001:db8::1",
      "fec0::1",
    ]) {
      expect(isInternalAddress(address), address).toBe(false);
    }
  });

  it("IPv4 를 IPv6 로 감싼 주소는 안의 IPv4 로 판정한다", () => {
    expect(isInternalAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isInternalAddress("::ffff:10.1.2.3")).toBe(true);
    expect(isInternalAddress("::ffff:7f00:1")).toBe(true);
    expect(isInternalAddress("::ffff:203.0.113.10")).toBe(false);
  });

  it("미지정 주소와 주소가 아닌 문자열은 내부로 본다(접속하지 않는 쪽으로 틀린다)", () => {
    for (const address of ["0.0.0.0", "0.1.2.3", "::", "", "example.com"]) {
      expect(isInternalAddress(address), address).toBe(true);
    }
  });
});

describe("호스트 이름 문법", () => {
  it("§3.7 의 문법에 맞는 이름만 받는다", () => {
    for (const host of ["api.example.com", "a", "a-b.c", "xn--9t4b11yi5a.kr", "0x.example.com"]) {
      expect(isHostname(host), host).toBe(true);
    }
    for (const host of [
      "",
      "Api.example.com",
      "-a.com",
      "a-.com",
      "a..b",
      ".a",
      "a.",
      "a_b.com",
      "a b",
      "a/../b",
      "a;id",
      "$(id).com",
      `${"a".repeat(250)}.com`,
    ]) {
      expect(isHostname(host), host).toBe(false);
    }
  });

  it("IP 주소는 호스트 이름이 아니다", () => {
    for (const host of ["127.0.0.1", "169.254.169.254", "::1"]) {
      expect(isHostname(host), host).toBe(false);
    }
  });

  it("Host 헤더에서 포트를 떼고 이름을 소문자로 만든다", () => {
    expect(splitHostHeader("API.Example.com")).toEqual({ host: "api.example.com", isIp: false });
    expect(splitHostHeader("api.example.com:8080")).toEqual({
      host: "api.example.com",
      isIp: false,
    });
    expect(splitHostHeader("127.0.0.1:80")).toEqual({ host: "127.0.0.1", isIp: true });
    expect(splitHostHeader("[::1]:443")).toEqual({ host: "::1", isIp: true });
    expect(splitHostHeader("[fe80::1]")).toEqual({ host: "fe80::1", isIp: true });
    expect(splitHostHeader(undefined)).toEqual({ host: "", isIp: false });
  });
});

describe("internal 네트워크 쪽 주소 찾기", () => {
  const interfaces = {
    lo: [{ address: "127.0.0.1", family: "IPv4" }],
    eth0: [
      { address: "172.17.0.3", family: "IPv4" },
      { address: "fe80::42:acff:fe11:3", family: "IPv6" },
    ],
    eth1: [{ address: "172.24.0.2", family: "IPv4" }],
  };

  it("서브넷에 든 IPv4 를 인터페이스 순서와 무관하게 찾는다", () => {
    expect(addressInSubnet(interfaces, "172.24.0.0/16")).toBe("172.24.0.2");
    expect(addressInSubnet({ eth1: interfaces.eth1, eth0: interfaces.eth0 }, "172.24.0.0/16")).toBe(
      "172.24.0.2",
    );
    expect(addressInSubnet(interfaces, "172.17.0.0/24")).toBe("172.17.0.3");
  });

  it("서브넷에 든 주소가 없거나 CIDR 꼴이 아니면 null 이다", () => {
    expect(addressInSubnet(interfaces, "10.9.0.0/16")).toBeNull();
    expect(addressInSubnet(interfaces, "172.24.0.0")).toBeNull();
    expect(addressInSubnet(interfaces, "172.24.0.0/33")).toBeNull();
    expect(addressInSubnet(interfaces, "nope/16")).toBeNull();
    expect(addressInSubnet(interfaces, "")).toBeNull();
    expect(addressInSubnet({ eth0: undefined }, "172.24.0.0/16")).toBeNull();
  });
});
