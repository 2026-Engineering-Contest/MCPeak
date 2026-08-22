import { describe, expect, it } from "vitest";
import { splitCommand } from "../src/generate/steps/StepServer.js";

/**
 * `--command` 는 실행 파일 하나만 받는 계약이다. 이 함수가 그 경계를 지킨다.
 *
 * **어느 갈래도 공백으로 쪼개면 안 된다.** 쪼개는 순간 공백이 든 경로가 여러 인자로
 * 흩어지고, 그 사용자는 대시보드로 실행 자체를 못 한다(#223).
 */
describe("splitCommand", () => {
  it("프리셋은 실행 파일이 고정이고 입력 전체가 인자 하나로 간다", () => {
    expect(splitCommand("node", "server.js")).toEqual({
      command: "node",
      leadingArgs: ["server.js"],
    });
    expect(splitCommand("npx", "@scope/pkg")).toEqual({
      command: "npx",
      leadingArgs: ["@scope/pkg"],
    });
    expect(splitCommand("python", "main.py")).toEqual({
      command: "python",
      leadingArgs: ["main.py"],
    });
  });

  it("공백이 든 경로가 프리셋에서 인자 하나로 보존된다", () => {
    expect(splitCommand("node", "my server.js")).toEqual({
      command: "node",
      leadingArgs: ["my server.js"],
    });
  });

  it("custom 은 입력 전체가 실행 파일 하나다 — 쪼개지 않는다", () => {
    // 예전에는 공백으로 쪼개서 `node "my server.js"` 가
    // command "node" · leadingArgs ['"my', 'server.js"'] 로 깨졌다 (#254 리뷰).
    expect(splitCommand("custom", "my runner")).toEqual({
      command: "my runner",
      leadingArgs: [],
    });
    expect(splitCommand("custom", "./bin/serve")).toEqual({
      command: "./bin/serve",
      leadingArgs: [],
    });
  });

  it("빈 입력은 실행 파일이 빈 문자열이다 (제출 버튼 비활성 조건)", () => {
    for (const method of ["node", "npx", "python", "custom"] as const) {
      expect(splitCommand(method, "   ")).toEqual({ command: "", leadingArgs: [] });
    }
  });
});
