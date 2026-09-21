import { describe, expect, it } from "vitest";
import { RelayLineReader } from "../src/server/relay-lines.js";

const UP = '{"dir":"up","port":51234,"url":"http://127.0.0.1:51234/mcp"}';
const REQ =
  '{"dir":"req","id":3,"method":"tools/call","tool":"get_weather","args":{"city":"서울"},"case":"c1"}';
const RES =
  '{"dir":"res","id":3,"tool":"get_weather","ok":true,"bytes":97,"ms":2,"body":{"content":[]},"case":"c1"}';

describe("중계기 줄 파서", () => {
  it("기동 줄에서 URL 을 읽는다", () => {
    expect(new RelayLineReader().push(`${UP}\n`)).toEqual([
      { kind: "up", url: "http://127.0.0.1:51234/mcp" },
    ]);
  });

  it("요청·응답 줄을 꼬리표와 함께 낸다", () => {
    const reader = new RelayLineReader();
    expect(reader.push(`${REQ}\n${RES}\n`)).toEqual([
      {
        kind: "request",
        id: 3,
        method: "tools/call",
        tool: "get_weather",
        args: { city: "서울" },
        case: "c1",
      },
      {
        kind: "response",
        id: 3,
        ok: true,
        tool: "get_weather",
        bytes: 97,
        ms: 2,
        body: { content: [] },
        case: "c1",
      },
    ]);
  });

  it("JSON 이 아닌 줄을 건너뛰고 그 건수를 센다", () => {
    // 자식 서버의 stderr 가 같은 채널로 흐른다. 여기서 죽으면 관찰 채널이 통째로 끊긴다.
    const reader = new RelayLineReader();
    const lines = reader.push(`[server] listening on stdio\n${REQ}\n그냥 한국어 로그\n`);
    expect(lines).toHaveLength(1);
    expect(reader.skipped).toBe(2);
  });

  it("JSON 이지만 우리 모양이 아닌 줄도 건너뛴다", () => {
    const reader = new RelayLineReader();
    expect(reader.push('{"level":"info","msg":"ready"}\n')).toEqual([]);
    expect(reader.skipped).toBe(1);
  });

  it("청크가 줄 중간에서 잘려도 이어 붙인다", () => {
    const reader = new RelayLineReader();
    expect(reader.push(REQ.slice(0, 20))).toEqual([]);
    expect(reader.push(`${REQ.slice(20)}\n`)).toHaveLength(1);
    expect(reader.skipped).toBe(0);
  });

  it("꼬리표가 없으면 case 필드도 없다", () => {
    const reader = new RelayLineReader();
    const [line] = reader.push('{"dir":"req","id":1,"method":"initialize"}\n');
    // `toStrictEqual` 이어야 한다. `toEqual` 은 `{case: undefined}` 를 `{}` 와 같다고 보므로,
    // 구현이 없는 필드를 `undefined` 로 싣도록 바뀌어도 이 테스트가 통과한다 — 계약이
    // "필드 자체가 없다" 인 자리에서는 그 관대함이 회귀를 덮는다.
    expect(line).toStrictEqual({ kind: "request", id: 1, method: "initialize" });
  });

  it("프로토콜 오류 줄은 body 없이 코드와 메시지를 낸다", () => {
    const reader = new RelayLineReader();
    expect(
      reader.push('{"dir":"res","id":4,"ok":false,"code":-32602,"message":"bad","ms":1}\n'),
    ).toStrictEqual([{ kind: "response", id: 4, ok: false, ms: 1, code: -32602, message: "bad" }]);
  });

  it("버린 줄을 낸다", () => {
    const reader = new RelayLineReader();
    expect(
      reader.push('{"dir":"drop","kind":"request","method":"sampling/createMessage"}\n'),
    ).toEqual([{ kind: "drop", method: "sampling/createMessage" }]);
  });

  it("빈 줄은 건너뛴 것으로 세지 않는다", () => {
    const reader = new RelayLineReader();
    reader.push("\n\n");
    expect(reader.skipped).toBe(0);
  });
});
