import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createRecorder,
  createReplayer,
  matchKey,
  parseSession,
  SessionFormatError,
  serializeSession,
} from "../sandbox/gateway/session.mjs";

interface Call {
  readonly method: string;
  readonly scheme: "http" | "https";
  readonly host: string;
  readonly port: number;
  readonly path: string;
  readonly body: Buffer;
}

interface Reply {
  readonly status: number;
  readonly headers: Array<[string, string]>;
  readonly body: Buffer;
}

interface Secret {
  readonly label: string;
  readonly value: string;
}

function call(overrides: Partial<Omit<Call, "body">> & { body?: string } = {}): Call {
  const { body, ...rest } = overrides;
  return {
    method: "GET",
    scheme: "https",
    host: "api.example.com",
    port: 443,
    path: "/v1/x?q=1",
    ...rest,
    body: Buffer.from(body ?? ""),
  };
}

function reply(body: string, headers: Array<[string, string]> = []): Reply {
  return { status: 200, headers, body: Buffer.from(body) };
}

/** (요청, 응답) 목록을 주어진 순서로 녹화해 직렬화한다. */
function record(
  pairs: ReadonlyArray<readonly [Call, Reply]>,
  secrets: readonly Secret[] = [],
): string {
  const recorder = createRecorder();
  for (const [request, response] of pairs) {
    recorder.record(matchKey(request, secrets), response, secrets);
  }
  return serializeSession(recorder.session());
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const CANARY: Secret = { label: "<canary:API_KEY>", value: "mcpeak-canary-7f3a9c2e41d0" };
const OTHER_RUN: Secret = { label: "<canary:API_KEY>", value: "mcpeak-canary-0b1d55e8a6c7" };

describe("세션 파일", () => {
  it("같은 요청 목록이면 직렬화 결과가 바이트 단위로 같다(도착 순서를 바꿔 넣어도)", () => {
    const a: [Call, Reply] = [call({ path: "/a" }), reply("A")];
    const b: [Call, Reply] = [call({ path: "/b", method: "POST", body: "{}" }), reply("B")];
    const c: [Call, Reply] = [
      call({ host: "cdn.example.com", scheme: "http", port: 80 }),
      reply("C"),
    ];

    const first = record([a, b, c]);
    expect(record([c, a, b])).toBe(first);
    expect(record([b, c, a])).toBe(first);
    expect(record([a, b, c])).toBe(first);
  });

  it("항목은 키의 여섯 필드 순으로 정렬되고 형식은 들여쓰기 2칸에 개행으로 끝난다", () => {
    const text = record([
      [call({ method: "POST", body: "x" }), reply("3")],
      [call({ method: "GET", host: "b.example.com" }), reply("2")],
      [call({ method: "GET", host: "a.example.com", path: "/z" }), reply("1")],
      [call({ method: "GET", host: "a.example.com", path: "/a" }), reply("0")],
    ]);

    const value = JSON.parse(text);
    expect(text).toBe(`${JSON.stringify(value, null, 2)}\n`);
    expect(
      value.entries.map(
        (entry: { key: Call }) => `${entry.key.method} ${entry.key.host}${entry.key.path}`,
      ),
    ).toEqual([
      "GET a.example.com/a",
      "GET a.example.com/z",
      "GET b.example.com/v1/x?q=1",
      "POST api.example.com/v1/x?q=1",
    ]);
  });

  it("직렬화 결과에 시각, 포트 번호, 토큰이 없다", () => {
    const text = record([
      [
        call({ method: "POST", body: '{"q":1}' }),
        reply("ok", [["Content-Type", "application/json"]]),
      ],
    ]);

    // 실어도 되는 필드가 이것뿐이다. 시각이나 접속 포트, 요청 헤더(토큰이 실리는 곳)를 둘 자리가 없다.
    const value = JSON.parse(text);
    expect(Object.keys(value)).toEqual(["schemaVersion", "entries"]);
    expect(value.schemaVersion).toBe(1);
    expect(Object.keys(value.entries[0])).toEqual(["key", "responses"]);
    expect(Object.keys(value.entries[0].key)).toEqual([
      "method",
      "scheme",
      "host",
      "port",
      "path",
      "bodySha256",
    ]);
    expect(Object.keys(value.entries[0].responses[0])).toEqual(["status", "headers", "bodyBase64"]);
    // port 는 스킴의 고정 포트(80·443)다. 접속에 쓰인 임시 포트가 아니다.
    expect(value.entries[0].key.port).toBe(443);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(text.toLowerCase()).not.toContain("authorization");
    expect(text.toLowerCase()).not.toContain("bearer");
  });

  it("본문이 없으면 bodySha256 은 빈 문자열의 해시다", () => {
    expect(matchKey(call(), []).bodySha256).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("응답 헤더는 받은 순서와 대소문자 그대로 싣는다", () => {
    const headers: Array<[string, string]> = [
      ["X-Zeta", "1"],
      ["Content-Type", "text/plain"],
      ["Date", "Sat, 03 Oct 2026 00:00:00 GMT"],
      ["x-alpha", "2"],
    ];
    const value = JSON.parse(record([[call(), reply("ok", headers)]]));

    expect(value.entries[0].responses[0].headers).toEqual(headers);
  });

  it("§3.7 의 매칭 키가 같은 두 요청은 같은 항목으로 재생된다", () => {
    const text = record([[call({ method: "POST", body: '{"q":1}' }), reply("first")]]);
    const replayer = createReplayer(parseSession(text));

    const answer = replayer.answer(matchKey(call({ method: "POST", body: '{"q":1}' }), []), []);

    expect(answer.served).toBe("replay-hit");
    expect(answer.response.status).toBe(200);
    expect(answer.response.body.toString()).toBe("first");
  });

  it("매칭 키가 다르면 replay-miss 로 기록하고 §3.7 이 정한 응답으로 답한다", () => {
    const text = record([[call(), reply("first")]]);
    const replayer = createReplayer(parseSession(text));

    for (const other of [
      call({ method: "POST" }),
      call({ scheme: "http" }),
      call({ host: "other.example.com" }),
      call({ port: 80 }),
      call({ path: "/v1/x?q=2" }),
      call({ body: "x" }),
    ]) {
      const answer = replayer.answer(matchKey(other, []), []);
      expect(answer.served).toBe("replay-miss");
      expect(answer.response.status).toBe(504);
      expect(answer.response.body.toString("utf8")).toBe("mcpeak: 녹화에 없는 요청입니다");
    }
  });

  it("형식이 깨진 세션 파일은 원인 한 줄과 함께 거절한다", () => {
    const good = JSON.parse(record([[call(), reply("ok", [["a", "b"]])]]));
    const mutate = (change: (value: typeof good) => void) => {
      const copy = structuredClone(good);
      change(copy);
      return JSON.stringify(copy);
    };

    const cases: Array<[string, string]> = [
      ["{ not json", "JSON 으로 읽을 수 없습니다."],
      ["[]", "최상위 값이 객체가 아닙니다."],
      [
        mutate((v) => {
          v.schemaVersion = 2;
        }),
        "schemaVersion 이 1 이 아닙니다(받은 값: 2).",
      ],
      [
        mutate((v) => {
          v.entries = {};
        }),
        "entries 가 배열이 아닙니다.",
      ],
      [
        mutate((v) => {
          v.entries[0].key.port = "443";
        }),
        "entries[0].key.port 가 1~65535 의 정수가 아닙니다.",
      ],
      [
        mutate((v) => {
          v.entries[0].key.scheme = "ftp";
        }),
        "entries[0].key.scheme 이 http 도 https 도 아닙니다.",
      ],
      [
        mutate((v) => {
          delete v.entries[0].key.bodySha256;
        }),
        "entries[0].key.bodySha256 이 sha256 hex(64자)가 아닙니다.",
      ],
      [
        mutate((v) => {
          v.entries[0].responses = [];
        }),
        "entries[0].responses 가 비어 있습니다. 응답이 하나 이상 있어야 합니다.",
      ],
      [
        mutate((v) => {
          v.entries[0].responses[0].status = 99;
        }),
        "entries[0].responses[0].status 가 100~599 의 정수가 아닙니다.",
      ],
      [
        mutate((v) => {
          v.entries[0].responses[0].headers = [["a"]];
        }),
        "entries[0].responses[0].headers[0] 이 [이름, 값] 문자열 쌍이 아닙니다.",
      ],
      [
        mutate((v) => {
          v.entries[0].responses[0].bodyBase64 = "@@@";
        }),
        "entries[0].responses[0].bodyBase64 가 base64 가 아닙니다.",
      ],
      [
        mutate((v) => {
          v.entries.push(structuredClone(v.entries[0]));
        }),
        "entries[1] 의 키가 entries[0] 과 같습니다. 같은 키는 한 항목의 responses 에 모아야 합니다.",
      ],
    ];
    for (const [text, reason] of cases) {
      let caught: unknown;
      try {
        parseSession(text);
      } catch (error) {
        caught = error;
      }
      expect(caught, reason).toBeInstanceOf(SessionFormatError);
      const message = (caught as Error).message;
      expect(message).toBe(reason);
      expect(message).not.toContain("\n");
    }
  });

  it("직렬화한 것을 읽어 다시 직렬화하면 바이트 단위로 같다", () => {
    const text = record([
      [call({ path: "/b" }), reply("B", [["X", "1"]])],
      [call({ path: "/a" }), reply("A")],
      [call({ path: "/a" }), reply("A2")],
    ]);

    expect(serializeSession(parseSession(text))).toBe(text);
  });

  it("세션에 쓸 때 비밀 값이 자리표로 바뀌고, 직렬화 결과 어디에도 값이 없다", () => {
    const text = record(
      [
        [
          call({
            method: "POST",
            path: `/collect?key=${CANARY.value}`,
            body: JSON.stringify({ token: CANARY.value }),
          }),
          reply(`echo ${CANARY.value}`, [["X-Echo", `v=${CANARY.value}`]]),
        ],
      ],
      [CANARY],
    );

    expect(text).not.toContain(CANARY.value);
    expect(text).not.toContain(Buffer.from(CANARY.value).toString("base64"));
    const value = JSON.parse(text);
    expect(value.entries[0].key.path).toBe("/collect?key=<canary:API_KEY>");
    expect(value.entries[0].key.bodySha256).toBe(sha256('{"token":"<canary:API_KEY>"}'));
    expect(value.entries[0].responses[0].headers).toEqual([["X-Echo", "v=<canary:API_KEY>"]]);
    expect(Buffer.from(value.entries[0].responses[0].bodyBase64, "base64").toString()).toBe(
      "echo <canary:API_KEY>",
    );
  });

  it("UTF-8 로 풀리지 않는 응답 본문은 건드리지 않는다", () => {
    const binary = Buffer.from([0xff, 0xfe, 0x00, 0x80, 0xc3]);
    const value = JSON.parse(
      record([[call(), { status: 200, headers: [], body: binary }]], [CANARY]),
    );

    expect(Buffer.from(value.entries[0].responses[0].bodyBase64, "base64")).toEqual(binary);
  });

  it("재생할 때 응답의 자리표가 그 실행의 값으로 되돌아간다", () => {
    const request = (secret: Secret) => call({ path: `/whoami?key=${secret.value}` });
    const text = record(
      [[request(CANARY), reply(`you are ${CANARY.value}`, [["X-Echo", CANARY.value]])]],
      [CANARY],
    );
    const replayer = createReplayer(parseSession(text));

    const answer = replayer.answer(matchKey(request(OTHER_RUN), [OTHER_RUN]), [OTHER_RUN]);

    expect(answer.served).toBe("replay-hit");
    expect(answer.response.body.toString()).toBe(`you are ${OTHER_RUN.value}`);
    expect(answer.response.headers).toEqual([["X-Echo", OTHER_RUN.value]]);
  });

  it("비밀 값만 다른 두 요청의 매칭 키가 같다", () => {
    const request = (secret: Secret) =>
      call({
        method: "POST",
        path: `/collect?key=${secret.value}`,
        body: `token=${secret.value}`,
      });

    expect(matchKey(request(CANARY), [CANARY])).toEqual(matchKey(request(OTHER_RUN), [OTHER_RUN]));
    // 가리지 않으면 달라야 한다. 위 단언이 가리기 덕분임을 고정한다.
    expect(matchKey(request(CANARY), [])).not.toEqual(matchKey(request(OTHER_RUN), []));
  });

  it("한 값이 다른 값을 품으면 긴 값부터 가린다", () => {
    const short: Secret = { label: "<env:SHORT>", value: "abc" };
    const long: Secret = { label: "<env:LONG>", value: "abcdef" };

    const key = matchKey(call({ path: "/x?a=abcdef&b=abc" }), [short, long]);

    expect(key.path).toBe("/x?a=<env:LONG>&b=<env:SHORT>");
    expect(matchKey(call({ path: "/x?a=abcdef&b=abc" }), [long, short])).toEqual(key);
  });

  it("빈 값은 가리지 않는다(모든 자리에 자리표가 끼는 것을 막는다)", () => {
    const key = matchKey(call({ path: "/x" }), [{ label: "<env:EMPTY>", value: "" }]);

    expect(key.path).toBe("/x");
  });

  it("헤더만 다른 두 요청의 매칭 키가 같고, 본문이 다르면 다르다", () => {
    // 키를 만드는 입력에 헤더 자리가 없다. 헤더가 달라도 같은 여섯 필드가 들어온다.
    const withAgentA = { ...call({ method: "POST", body: "a" }), headers: [["user-agent", "a/1"]] };
    const withAgentB = { ...call({ method: "POST", body: "a" }), headers: [["user-agent", "b/2"]] };

    expect(matchKey(withAgentA, [])).toEqual(matchKey(withAgentB, []));
    expect(Object.keys(matchKey(withAgentA, []))).not.toContain("headers");
    expect(matchKey(call({ method: "POST", body: "a" }), [])).not.toEqual(
      matchKey(call({ method: "POST", body: "b" }), []),
    );
  });

  it("같은 키의 요청이 여러 번 오면 온 순서대로 쌓이고 재생도 그 순서다", () => {
    const text = record([
      [call(), reply("1")],
      [call({ path: "/other" }), reply("x")],
      [call(), reply("2")],
    ]);
    const replayer = createReplayer(parseSession(text));
    const key = matchKey(call(), []);

    expect(replayer.answer(key, []).response.body.toString()).toBe("1");
    expect(
      replayer.answer(matchKey(call({ path: "/other" }), []), []).response.body.toString(),
    ).toBe("x");
    expect(replayer.answer(key, []).response.body.toString()).toBe("2");
  });

  it("같은 키의 요청이 녹화보다 많으면 마지막 응답을 다시 준다", () => {
    const text = record([
      [call(), reply("1")],
      [call(), reply("2")],
    ]);
    const replayer = createReplayer(parseSession(text));
    const key = matchKey(call(), []);

    const bodies = [1, 2, 3, 4].map(() => {
      const answer = replayer.answer(key, []);
      expect(answer.served).toBe("replay-hit");
      return answer.response.body.toString();
    });

    expect(bodies).toEqual(["1", "2", "2", "2"]);
  });
});
