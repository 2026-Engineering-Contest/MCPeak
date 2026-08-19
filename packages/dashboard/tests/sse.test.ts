import { describe, expect, it } from "vitest";
import { formatSseEvent } from "../src/server/sse.js";

describe("formatSseEvent", () => {
  it("재연결 cursor를 SSE id와 data 양쪽에 보낸다", () => {
    expect(formatSseEvent({ kind: "stdout", html: "첫 줄", id: 3 })).toBe(
      'id: 3\ndata: {"kind":"stdout","html":"첫 줄","id":3}\n\n',
    );
  });
});
