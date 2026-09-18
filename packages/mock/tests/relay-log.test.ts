import { describe, expect, it } from "vitest";
import {
  formatSeconds,
  groupDigits,
  humanRequest,
  humanResponse,
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
