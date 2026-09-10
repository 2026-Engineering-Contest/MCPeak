import { describe, expect, it } from "vitest";
import type { PendingQuestion, RunEvent } from "../../src/api-types.js";
import { countOutputLines } from "../src/output-lines.js";

let nextId = 1;

function stdout(html: string): RunEvent {
  return { kind: "stdout", html, id: nextId++ };
}

function stderr(html: string): RunEvent {
  return { kind: "stderr", html, id: nextId++ };
}

function question(message: string): RunEvent {
  const pending: PendingQuestion = { id: "q1", kind: "input", message };
  return { kind: "question", question: pending, id: nextId++ };
}

function done(exitCode: number): RunEvent {
  return { kind: "done", exitCode, id: nextId++ };
}

describe("countOutputLines", () => {
  it("이벤트가 없으면 0", () => {
    expect(countOutputLines([])).toBe(0);
  });

  it("출력이 빈 문자열이면 0", () => {
    expect(countOutputLines([stdout("")])).toBe(0);
  });

  it("끝이 개행이면 개행 수가 곧 줄 수다", () => {
    expect(countOutputLines([stdout("a\nb\n")])).toBe(2);
  });

  it("끝이 개행이 아니면 마지막 줄을 하나 더 센다", () => {
    expect(countOutputLines([stdout("a\nb")])).toBe(2);
  });

  it("한 줄짜리도 개행 없이 1이다", () => {
    expect(countOutputLines([stdout("a")])).toBe(1);
  });

  it("빈 줄도 센다 — 화면에 빈 행으로 보인다", () => {
    expect(countOutputLines([stdout("a\n\nb\n")])).toBe(3);
  });

  it("한 줄이 두 이벤트로 갈려도 두 번 세지 않는다", () => {
    // 이벤트별로 세어 더하면 1+1=2 가 되지만 화면에는 "abcd" 한 줄이다.
    expect(countOutputLines([stdout("ab"), stdout("cd\n")])).toBe(1);
  });

  it("이벤트 경계에서 줄이 이어져도 모자라지 않는다", () => {
    // 이벤트별 개행 합계는 1 이지만 화면에는 "a" 와 "b" 두 줄이다.
    expect(countOutputLines([stdout("a\n"), stdout("b")])).toBe(2);
  });

  it("html 태그는 줄 수에 영향을 주지 않는다", () => {
    expect(countOutputLines([stdout('<span class="ansi-32">✓</span> ok\n')])).toBe(1);
  });

  it("stdout 과 stderr 을 함께 센다", () => {
    expect(countOutputLines([stdout("a\n"), stderr("b\n")])).toBe(2);
  });

  it("question·done 은 줄이 아니다", () => {
    expect(countOutputLines([question("계속할까요?"), done(0)])).toBe(0);
    expect(countOutputLines([stdout("a\n"), question("계속?"), done(0)])).toBe(1);
  });

  it("회귀: 여러 줄이 든 이벤트 하나를 1줄이라고 하지 않는다", () => {
    // 이 함수가 생긴 이유다. `mcpeak test` 는 출력을 모았다가 끝에 한 번 쓰므로 stdout
    // 이벤트가 1개이고, 이벤트를 세면 화면에 13줄이 보여도 "1줄" 이 된다.
    const output = ["테스트  (8 cases)", "", "✓ get-weather-success", "", "8 passed"].join("\n");
    expect(countOutputLines([stdout(`${output}\n`)])).toBe(5);
  });
});
