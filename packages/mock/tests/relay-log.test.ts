import { describe, expect, it } from "vitest";
import {
  formatSeconds,
  groupDigits,
  humanDrop,
  humanRequest,
  humanResponse,
  jsonDrop,
  jsonRequest,
  jsonResponse,
} from "../src/relay-log.js";

describe("humanRequest", () => {
  it("인자 없는 호출은 메서드만 적는다", () => {
    expect(humanRequest({ id: 1, method: "tools/list" })).toBe("→ tools/list");
  });

  it("tools/call 은 툴 이름과 인자를 그대로 싣는다", () => {
    expect(
      humanRequest({ id: 3, method: "tools/call", tool: "get_forecast", args: { city: "부산" } }),
    ).toBe('→ tools/call  get_forecast {"city":"부산"}');
  });

  it("인자를 줄이지 않는다 — 긴 인자도 전문이 실린다", () => {
    const args = { note: "가".repeat(300) };
    const line = humanRequest({ id: 4, method: "tools/call", tool: "add_note", args });
    expect(line).toContain(JSON.stringify(args));
    expect(line).not.toContain("…");
  });
});

describe("humanResponse", () => {
  it("tools/list 는 툴 개수를 적는다", () => {
    expect(
      humanResponse({ id: 1, method: "tools/list", kind: "ok", bytes: 900, ms: 12, toolCount: 10 }),
    ).toBe("← tools/list  툴 10개");
  });

  it("성공한 tools/call 은 크기와 시간을 적는다", () => {
    expect(
      humanResponse({
        id: 3,
        method: "tools/call",
        tool: "get_forecast",
        kind: "ok",
        bytes: 1240,
        ms: 1834,
      }),
    ).toBe("← tools/call  get_forecast 성공 · 1,240바이트 · 1.8초");
  });

  it("isError 결과는 프로토콜 오류와 다른 문형으로 적는다", () => {
    expect(
      humanResponse({
        id: 5,
        method: "tools/call",
        tool: "boom",
        kind: "toolError",
        bytes: 84,
        ms: 120,
      }),
    ).toBe("← tools/call  boom 툴 오류 · 84바이트 · 0.1초");
  });

  it("프로토콜 오류는 서버가 준 코드와 메시지를 그대로 적는다", () => {
    expect(
      humanResponse({
        id: 6,
        method: "tools/call",
        tool: "convert_units",
        kind: "protocolError",
        code: -32602,
        message: "Structured content does not match the tool's output schema",
        ms: 30,
      }),
    ).toBe(
      "← tools/call  convert_units 오류 -32602 Structured content does not match the tool's output schema",
    );
  });
});

describe("jsonRequest · jsonResponse", () => {
  it("요청 줄이 파싱되고 필드가 맞다", () => {
    const line = jsonRequest({
      id: 3,
      method: "tools/call",
      tool: "get_forecast",
      args: { city: "부산" },
    });
    expect(JSON.parse(line)).toEqual({
      dir: "req",
      id: 3,
      method: "tools/call",
      tool: "get_forecast",
      args: { city: "부산" },
    });
  });

  it("인자·툴이 없으면 그 키를 내지 않는다", () => {
    expect(JSON.parse(jsonRequest({ id: 1, method: "tools/list" }))).toEqual({
      dir: "req",
      id: 1,
      method: "tools/list",
    });
  });

  it("성공 응답 줄이 파싱되고 필드가 맞다", () => {
    const line = jsonResponse({
      id: 3,
      method: "tools/call",
      tool: "get_forecast",
      kind: "ok",
      bytes: 1240,
      ms: 1834,
    });
    expect(JSON.parse(line)).toEqual({
      dir: "res",
      id: 3,
      tool: "get_forecast",
      ok: true,
      bytes: 1240,
      ms: 1834,
    });
  });

  it("툴 오류는 ok:false 와 isError:true 로 구분된다", () => {
    expect(
      JSON.parse(
        jsonResponse({
          id: 5,
          method: "tools/call",
          tool: "boom",
          kind: "toolError",
          bytes: 84,
          ms: 120,
        }),
      ),
    ).toEqual({ dir: "res", id: 5, tool: "boom", ok: false, isError: true, bytes: 84, ms: 120 });
  });

  it("프로토콜 오류는 코드와 메시지를 싣는다", () => {
    expect(
      JSON.parse(
        jsonResponse({
          id: 6,
          method: "tools/call",
          tool: "convert_units",
          kind: "protocolError",
          code: -32602,
          message: "boom",
          ms: 30,
        }),
      ),
    ).toEqual({
      dir: "res",
      id: 6,
      tool: "convert_units",
      ok: false,
      code: -32602,
      message: "boom",
      ms: 30,
    });
  });

  it("줄에 개행이 없다 — 한 호출이 한 줄이다", () => {
    const args = { text: "첫 줄\n둘째 줄" };
    expect(jsonRequest({ id: 1, method: "tools/call", tool: "echo", args })).not.toContain("\n");
    expect(humanRequest({ id: 1, method: "tools/call", tool: "echo", args })).not.toContain("\n");
  });
});

describe("서식 보조", () => {
  it("자리수를 세 자리마다 끊는다", () => {
    expect(groupDigits(0)).toBe("0");
    expect(groupDigits(999)).toBe("999");
    expect(groupDigits(1240)).toBe("1,240");
    expect(groupDigits(1234567)).toBe("1,234,567");
  });

  it("초는 소수 한 자리다", () => {
    expect(formatSeconds(0)).toBe("0.0초");
    expect(formatSeconds(120)).toBe("0.1초");
    expect(formatSeconds(1834)).toBe("1.8초");
  });
});

/**
 * 서버가 **먼저 건** 것을 버렸다는 기록. 계획서 표 I 가 "기록만 하고 버린다" 로 정한 줄이다.
 *
 * 문안이 곧 제품이라 전문을 고정한다 — 부분 일치로 두면 뒤에 무엇이 붙어도 통과한다.
 */
describe("humanDrop", () => {
  it("서버가 먼저 건 요청은 서버가 기다린다는 것까지 적는다", () => {
    expect(humanDrop({ method: "sampling/createMessage", kind: "request" })).toBe(
      "← sampling/createMessage  버림 · 서버가 먼저 거는 요청은 중계하지 않습니다 (서버는 응답을 기다립니다)",
    );
  });

  it("서버가 보낸 알림은 기다리는 쪽이 없으므로 괄호를 달지 않는다", () => {
    expect(humanDrop({ method: "notifications/message", kind: "notification" })).toBe(
      "← notifications/message  버림 · 서버가 보내는 알림은 중계하지 않습니다",
    );
  });

  it("서버에서 온 것이므로 화살표가 왼쪽이다", () => {
    for (const kind of ["request", "notification"] as const) {
      expect(humanDrop({ method: "roots/list", kind }).startsWith("← ")).toBe(true);
    }
  });
});

describe("jsonDrop", () => {
  it("요청 줄이 파싱되고 필드가 맞다", () => {
    expect(JSON.parse(jsonDrop({ method: "sampling/createMessage", kind: "request" }))).toEqual({
      dir: "drop",
      kind: "request",
      method: "sampling/createMessage",
    });
  });

  it("알림 줄이 파싱되고 필드가 맞다", () => {
    expect(JSON.parse(jsonDrop({ method: "notifications/message", kind: "notification" }))).toEqual(
      { dir: "drop", kind: "notification", method: "notifications/message" },
    );
  });

  /** 키 순서를 고정한다 — 4 단계의 스냅샷 비교가 이유 없이 깨지지 않게. */
  it("키 순서가 dir·kind·method 다", () => {
    expect(jsonDrop({ method: "sampling/createMessage", kind: "request" })).toBe(
      '{"dir":"drop","kind":"request","method":"sampling/createMessage"}',
    );
  });

  /** `dir` 이 세 번째 값이라 요청·응답 집계에 섞이지 않는다. */
  it("dir 이 req·res 와 겹치지 않는다", () => {
    const dir = (JSON.parse(jsonDrop({ method: "roots/list", kind: "request" })) as { dir: string })
      .dir;
    expect(dir).toBe("drop");
    expect(["req", "res"]).not.toContain(dir);
  });
});
