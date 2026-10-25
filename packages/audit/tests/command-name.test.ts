import { describe, expect, it } from "vitest";
import { commandName } from "../src/sandbox/command-name.js";

/**
 * 격리가 "이 명령을 이미지가 실행할 수 있나" 를 판정하는 글자 규칙. 플랫폼을 보지 않으므로 이
 * 스펙은 어느 OS 에서도 같은 값을 단언한다(#540, #539 의 교훈).
 */
describe("commandName", () => {
  it("이름만 온 명령은 그대로다", () => {
    for (const name of ["node", "npx", "npm", "python3", "deno"])
      expect(commandName(name)).toBe(name);
  });

  it("POSIX 절대 경로는 이름만 남는다", () => {
    expect(commandName("/opt/homebrew/bin/node")).toBe("node");
    expect(commandName("/usr/local/bin/npx")).toBe("npx");
    expect(commandName("./server/node")).toBe("node");
  });

  it("윈도우 경로는 역슬래시로도 잘린다", () => {
    expect(commandName("C:\\Program Files\\nodejs\\node.exe")).toBe("node");
    expect(commandName("C:\\nodejs\\npx.cmd")).toBe("npx");
    // 두 구분자가 섞여 와도 마지막 조각이 이름이다.
    expect(commandName("C:/Program Files/nodejs/node.exe")).toBe("node");
  });

  it("윈도우 실행 파일 확장자를 뗀다 — 허용 목록이 node·npx·npm 이기 때문이다", () => {
    expect(commandName("node.exe")).toBe("node");
    expect(commandName("npx.cmd")).toBe("npx");
    expect(commandName("npm.cmd")).toBe("npm");
    expect(commandName("npm.bat")).toBe("npm");
  });

  it("확장자 판정은 대소문자를 가리지 않는다 — 윈도우 파일 이름이 그렇다", () => {
    expect(commandName("NODE.EXE")).toBe("NODE");
    expect(commandName("C:\\WINDOWS\\SYSTEM32\\Node.Exe")).toBe("Node");
    expect(commandName("npx.CMD")).toBe("npx");
  });

  it("뗀 뒤 이름이 비는 경우는 떼지 않는다", () => {
    // 무엇을 받았는지가 실패 문장에 보여야 한다. 빈 문자열은 그것을 지운다.
    expect(commandName(".exe")).toBe(".exe");
    expect(commandName("C:\\tools\\.cmd")).toBe(".cmd");
  });

  it("윈도우 실행 파일 확장자가 아닌 꼬리는 남긴다", () => {
    // 이것들은 node 가 인자로 받는 파일이거나, 명령 자리에 그대로 올 수 없는 것이다.
    expect(commandName("server.js")).toBe("server.js");
    expect(commandName("/srv/app/server.mjs")).toBe("server.mjs");
    expect(commandName("start.ps1")).toBe("start.ps1");
    // `.com` 은 떼지 않는다 — 도메인 꼴 이름을 가진 명령이 엉뚱하게 잘린다.
    expect(commandName("mcp-server.com")).toBe("mcp-server.com");
  });

  it("빈 명령과 구분자로 끝나는 명령은 글자 그대로 돌려준다", () => {
    expect(commandName("")).toBe("");
    // 뗄 이름이 없으면 받은 것을 그대로 보여 준다. 어느 허용 목록에도 들지 않는다.
    expect(commandName("/usr/local/bin/")).toBe("/usr/local/bin/");
  });
});
