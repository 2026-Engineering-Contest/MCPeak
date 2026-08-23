import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockServer, type MockServer } from "@mcpeak/mock";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/index.js";

vi.mock("@mcpeak/core", async () => import("../../core/src/index.js"));
vi.mock("@mcpeak/runner", async () => import("../../runner/src/index.js"));
vi.mock("@mcpeak/generate", async () => import("../../generate/src/index.js"));

/**
 * `--url` 경로의 E2E. 이슈 #137 이 뚫으려던 것이 이 한 바퀴다 — 원격 서버에서 명세를 뽑고
 * 그 명세로 원격 서버를 검사한다.
 *
 * **네트워크에 나가지 않는다.** `@mcpeak/mock` 이 Streamable HTTP MCP 서버를 임의 포트로
 * 띄우므로 `uvx` E2E 와 달리 어디서나 돈다. 우리 목에 우리 클라이언트로 붙는 구성이라
 * "우리 도구로 우리를 검증한다"(CLAUDE.md)가 원격 transport 에서도 성립한다.
 */

const TOOLS = [
  {
    name: "add",
    description: "두 수를 더한다.",
    inputSchema: {
      type: "object" as const,
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
  },
];

const opened: MockServer[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const server of opened.splice(0)) await server.close().catch(() => undefined);
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  vi.restoreAllMocks();
});

async function startMock(): Promise<MockServer> {
  const server = await createMockServer({ tools: TOOLS });
  opened.push(server);
  return server;
}

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "mcpeak-http-e2e-"));
  directories.push(directory);
  return directory;
}

/** stdout·stderr 를 가로채 되돌려준다. `run` 은 진입점이라 실제 스트림에 쓴다. */
function captureOutput(): { out: () => string; err: () => string } {
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const join = (spy: typeof stdout): string =>
    spy.mock.calls.map(([text]) => String(text)).join("");
  return { out: () => join(stdout), err: () => join(stderr) };
}

describe.sequential("원격(Streamable HTTP) 서버 E2E", () => {
  it("--url 로 명세를 뽑고 같은 --url 로 검사한다", async () => {
    const server = await startMock();
    const suitePath = join(await tempDirectory(), "remote.suite.json");
    const output = captureOutput();

    const generated = await run([
      "generate",
      "--suite-id",
      "remote",
      "--name",
      "원격 서버",
      "--out",
      suitePath,
      "--url",
      server.url,
      "--baseline-only",
    ]);
    expect(generated, output.err()).toBe(0);

    const suite = JSON.parse(await readFile(suitePath, "utf8")) as {
      cases: { operation: { tool: string } }[];
    };
    expect(suite.cases.length).toBeGreaterThan(0);
    expect(suite.cases[0]?.operation.tool).toBe("add");

    // 목은 주입하지 않은 호출에 매칭 미스를 돌려주므로 성공 케이스의 응답을 먼저 넣는다.
    // 여기서 보는 것은 판정 내용이 아니라 **원격 대상으로 한 바퀴가 돈다**는 사실이다.
    server.on("add", { a: 1, b: 2 }, { sum: 3 });

    const tested = await run(["test", suitePath, "--url", server.url]);
    expect([0, 1]).toContain(tested);
    // 연결 자체가 실패하면 이 코드가 나온다. 그것이 이 이슈 전의 상태였다.
    expect(output.err()).not.toContain("MCP_CONNECTION_FAILED");
  });

  /**
   * 이 단언이 ADR-0020 이 만든 값을 CLI 가 실제로 쓰는지 본다. 진단 렌더러가 없으면 원격
   * 실패는 "연결하지 못했습니다" 한 줄로 끝나고, 어느 엔드포인트였는지조차 화면에 없다.
   */
  it("서버가 죽어 있으면 엔드포인트를 담은 원격 진단을 낸다", async () => {
    const server = await startMock();
    const suitePath = join(await tempDirectory(), "remote.suite.json");
    const url = server.url;

    let output = captureOutput();
    expect(
      await run([
        "generate",
        "--suite-id",
        "remote",
        "--name",
        "원격 서버",
        "--out",
        suitePath,
        "--url",
        url,
        "--baseline-only",
      ]),
      output.err(),
    ).toBe(0);

    await server.close();
    opened.splice(opened.indexOf(server), 1);

    output = captureOutput();
    expect(await run(["test", suitePath, "--url", url])).toBe(1);

    const stderr = output.err();
    expect(stderr).toContain("원격 서버 진단");
    expect(stderr).toContain(`엔드포인트: ${url}`);
    // stdio 전용 블록이 원격 실패에 붙으면 없는 프로세스의 종료 코드를 말하게 된다.
    expect(stderr).not.toContain("서버 프로세스 진단");
  });

  it("--url 과 --command 를 함께 주면 서버에 붙기 전에 거절한다", async () => {
    const output = captureOutput();

    expect(await run(["test", "suite.json", "--url", "https://x/v1", "--command", "node"])).toBe(1);
    expect(output.err()).toContain("함께 쓸 수 없습니다");
  });
});
