import { describe, expect, it } from "vitest";
import {
  RELAY_SKIPPED_HEAD_LINES,
  RELAY_SKIPPED_TAIL_LINES,
  RelayLineReader,
} from "../src/server/relay-lines.js";

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

  it("상한을 넘으면 첫 줄과 마지막 줄이 둘 다 남고 가운데를 생략한다", () => {
    // 꼬리만 남기던 때 가장 흔한 실패에서 진단이 오도했다: node 크래시는 **첫 줄이
    // 원인**이고 뒤는 스택 프레임이라, 마지막 N 줄만 남기면 원인이 밀려 나간다.
    const reader = new RelayLineReader();
    const total = RELAY_SKIPPED_HEAD_LINES + RELAY_SKIPPED_TAIL_LINES + 4;
    for (let i = 0; i < total; i += 1) reader.push(`그냥 로그 ${i}\n`);
    expect(reader.skipped).toBe(total);

    const { head, tail, omitted } = reader.skippedLines;
    // 머리: 가장 먼저 온 줄들. 원인이 여기 있다.
    expect(head).toEqual(
      Array.from({ length: RELAY_SKIPPED_HEAD_LINES }, (_, i) => `그냥 로그 ${i}`),
    );
    // 꼬리: 마지막 줄들. 수다스러운 서버에서는 원인이 이쪽에 있다.
    expect(tail).toEqual(
      Array.from(
        { length: RELAY_SKIPPED_TAIL_LINES },
        (_, i) => `그냥 로그 ${total - RELAY_SKIPPED_TAIL_LINES + i}`,
      ),
    );
    // 생략한 건수를 세어 둬야 화면에 「생략했다」고 적을 수 있다. 조용한 생략은 안 된다.
    expect(omitted).toBe(total - RELAY_SKIPPED_HEAD_LINES - RELAY_SKIPPED_TAIL_LINES);
  });

  it("상한을 안 넘으면 생략이 없다", () => {
    const reader = new RelayLineReader();
    for (let i = 0; i < RELAY_SKIPPED_HEAD_LINES + RELAY_SKIPPED_TAIL_LINES; i += 1) {
      reader.push(`그냥 로그 ${i}\n`);
    }
    const { head, tail, omitted } = reader.skippedLines;
    expect(omitted).toBe(0);
    expect([...head, ...tail]).toHaveLength(RELAY_SKIPPED_HEAD_LINES + RELAY_SKIPPED_TAIL_LINES);
  });
});
