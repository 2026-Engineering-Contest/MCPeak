import type { McpClient } from "@ohmymcp-hsu/core";
import type { Cassette, CassetteVerifyResult } from "@ohmymcp-hsu/record";
import { describe, expect, it } from "vitest";
import {
  parseVerifyCommand,
  runVerifyCommand,
  type VerifyCommandDependencies,
} from "../src/verify-command.js";

const emptyCassette: Cassette = { version: 1, interactions: [] };

const clean: CassetteVerifyResult = {
  matched: 3,
  mismatched: [],
  failed: [],
  skipped: [],
  toolsChanged: false,
};

const mismatch = (message: string): CassetteVerifyResult => ({
  matched: 1,
  mismatched: [{ key: "k", toolName: "get_weather", args: { city: "서울" }, message }],
  failed: [],
  skipped: [],
  toolsChanged: false,
});

interface Harness {
  readonly dependencies: VerifyCommandDependencies;
  readonly stdout: string[];
  readonly stderr: string[];
  readonly closed: () => number;
  readonly connected: () => number;
}

function harness(overrides: Partial<VerifyCommandDependencies> = {}): Harness {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let closes = 0;
  let connects = 0;
  const client: McpClient = {
    async listTools() {
      return [];
    },
    async callTool() {
      throw new Error("쓰이지 않습니다");
    },
    async close() {
      closes++;
    },
  };
  return {
    stdout,
    stderr,
    closed: () => closes,
    connected: () => connects,
    dependencies: {
      loadCassette: async () => emptyCassette,
      connect: async () => {
        connects++;
        return client;
      },
      verifyCassette: async () => clean,
      writeStdout: (text) => stdout.push(text),
      writeStderr: (text) => stderr.push(text),
      ...overrides,
    },
  };
}

describe("parseVerifyCommand", () => {
  it("카세트 경로와 --command 를 읽는다", () => {
    const input = parseVerifyCommand(["c.json", "--command", "node"]);
    expect(input.cassettePath).toBe("c.json");
    expect(input.command).toBe("node");
    expect(input.args).toStrictEqual([]);
  });

  it("--arg 를 여러 번 받는다", () => {
    const input = parseVerifyCommand([
      "c.json",
      "--command",
      "node",
      "--arg",
      "s.mjs",
      "--arg",
      "-v",
    ]);
    expect(input.args).toStrictEqual(["s.mjs", "-v"]);
  });

  it("--command=value 형태도 받는다", () => {
    expect(parseVerifyCommand(["c.json", "--command=node"]).command).toBe("node");
  });

  it("카세트 경로가 없으면 거절한다", () => {
    expect(() => parseVerifyCommand(["--command", "node"])).toThrow(
      "카세트 JSON 경로가 필요합니다",
    );
  });

  it("--command 가 없으면 거절한다", () => {
    expect(() => parseVerifyCommand(["c.json"])).toThrow("--command");
  });

  it("--record 는 조용히 무시하지 않고 무엇을 써야 하는지 알려준다", () => {
    // verify 는 카세트를 고치지 않는다. 무시하면 사용자는 갱신됐다고 믿는다.
    expect(() => parseVerifyCommand(["c.json", "--command", "node", "--record"])).toThrow(
      "verify 는 카세트를 고치지 않습니다",
    );
  });

  it("알 수 없는 옵션을 거절한다", () => {
    expect(() => parseVerifyCommand(["c.json", "--command", "node", "--nope"])).toThrow(
      "알 수 없는 옵션",
    );
  });

  it("카세트를 두 개 주면 거절한다", () => {
    expect(() => parseVerifyCommand(["a.json", "b.json", "--command", "node"])).toThrow(
      "카세트는 하나만",
    );
  });
});

describe("runVerifyCommand", () => {
  it("일치하면 0 을 주고 요약을 낸다", async () => {
    const { dependencies, stdout } = harness();
    const code = await runVerifyCommand(["c.json", "--command", "node"], dependencies);

    expect(code).toBe(0);
    expect(stdout.join("")).toContain("일치 3");
    expect(stdout.join("")).toContain("카세트가 실서버와 일치합니다");
  });

  it("불일치가 있으면 1 을 주고 record 가 만든 문장을 그대로 낸다", async () => {
    const message = '→ 카세트와 실서버 응답이 다릅니다: get_weather({"city":"서울"})';
    const { dependencies, stdout, stderr } = harness({
      verifyCassette: async () => mismatch(message),
    });
    const code = await runVerifyCommand(["c.json", "--command", "node"], dependencies);

    expect(code).toBe(1);
    // 문장을 cli 가 다시 쓰지 않는다. 두 곳이 갈리면 안 된다.
    expect(stdout.join("")).toContain(message);
    expect(stderr.join("")).toContain("CASSETTE_DRIFTED");
  });

  it("확인불가(skipped)만 있으면 실패가 아니다", async () => {
    const { dependencies, stdout } = harness({
      verifyCassette: async () => ({
        matched: 1,
        mismatched: [],
        failed: [],
        skipped: [{ key: "k", toolName: "login", args: {}, message: "→ 마스킹된 args" }],
        toolsChanged: false,
      }),
    });
    const code = await runVerifyCommand(["c.json", "--command", "node"], dependencies);

    expect(code).toBe(0);
    expect(stdout.join("")).toContain("확인불가 1");
  });

  it("카세트가 없으면 CASSETTE_NOT_FOUND 로 끝난다", async () => {
    const { dependencies, stderr } = harness({ loadCassette: async () => null });
    const code = await runVerifyCommand(["c.json", "--command", "node"], dependencies);

    expect(code).toBe(1);
    expect(stderr.join("")).toContain("CASSETTE_NOT_FOUND");
  });

  it("카세트 읽기가 던지면 CASSETTE_READ_FAILED 로 끝난다", async () => {
    const { dependencies, stderr } = harness({
      loadCassette: async () => {
        throw new Error("깨진 JSON");
      },
    });
    const code = await runVerifyCommand(["c.json", "--command", "node"], dependencies);

    expect(code).toBe(1);
    expect(stderr.join("")).toContain("CASSETTE_READ_FAILED");
  });

  it("연결에 실패하면 SERVER_CONNECT_FAILED 로 끝난다", async () => {
    const { dependencies, stderr } = harness({
      connect: async () => {
        throw new Error("서버를 띄우지 못했습니다");
      },
    });
    const code = await runVerifyCommand(["c.json", "--command", "node"], dependencies);

    expect(code).toBe(1);
    expect(stderr.join("")).toContain("SERVER_CONNECT_FAILED");
  });

  it("연결은 우리가 열었으므로 우리가 닫는다", async () => {
    const { dependencies, closed } = harness();
    await runVerifyCommand(["c.json", "--command", "node"], dependencies);

    expect(closed()).toBe(1);
  });

  it("verify 가 던져도 연결을 닫는다", async () => {
    const { dependencies, closed } = harness({
      verifyCassette: async () => {
        throw new Error("예상 못한 오류");
      },
    });

    await expect(runVerifyCommand(["c.json", "--command", "node"], dependencies)).rejects.toThrow(
      "예상 못한 오류",
    );
    expect(closed()).toBe(1);
  });

  it("사용 오류면 서버에 연결하지 않는다", async () => {
    const { dependencies, connected, stderr } = harness();
    const code = await runVerifyCommand(["c.json"], dependencies);

    expect(code).toBe(1);
    expect(connected()).toBe(0);
    expect(stderr.join("")).toContain("CLI_USAGE");
  });
});
