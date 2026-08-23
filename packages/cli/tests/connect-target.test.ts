import type { McpClient } from "@mcpeak/core";
import { describe, expect, it, vi } from "vitest";
import {
  type ConnectTarget,
  ConnectTargetError,
  describeTarget,
  openConnection,
  parseHeaderEnvOption,
  parseUrlOption,
} from "../src/connect-target.js";

const client = {} as McpClient;

const stdioTarget: ConnectTarget = {
  transport: "stdio",
  command: "node",
  args: ["server.mjs"],
};

const httpTarget = (headerEnv: Record<string, string> = {}): ConnectTarget => ({
  transport: "http",
  url: "https://mcp.example.com/v1",
  headerEnv,
});

const stdioConnection = () => ({
  client,
  getDiagnostics: () => ({ stderr: "", stderrTruncated: false, exitCode: null, signal: null }),
  close: vi.fn(async () => undefined),
  forceClose: vi.fn(async () => undefined),
});

const httpConnection = () => ({
  client,
  getDiagnostics: () => ({ url: "u", status: null, statusText: null, sessionId: null }),
  close: vi.fn(async () => undefined),
});

describe("parseUrlOption", () => {
  it("http·https 를 통과시키고 정규화한다", () => {
    expect(parseUrlOption("https://mcp.example.com/v1")).toEqual({
      ok: true,
      value: "https://mcp.example.com/v1",
    });
    expect(parseUrlOption("http://127.0.0.1:8080/mcp")).toMatchObject({ ok: true });
  });

  it("URL 이 아니면 예시를 담아 거절한다", () => {
    const result = parseUrlOption("mcp.example.com");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("올바른 URL 이 아닙니다");
    expect(result.message).toContain("https://mcp.example.com/v1");
  });

  it("http·https 가 아닌 스킴은 받은 스킴을 말하며 거절한다", () => {
    const result = parseUrlOption("ws://mcp.example.com/v1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("받은 스킴: 'ws'");
  });

  /**
   * `https://user:token@host` 는 `--header-env` 를 우회해 토큰을 argv 에 싣는 가장 쉬운 길이다.
   * 막지 않으면 이 옵션의 안전 근거가 통째로 무너진다.
   */
  it("URL 에 넣은 자격증명을 거절하고 --header-env 로 안내한다", () => {
    const result = parseUrlOption("https://user:secret@mcp.example.com/v1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("자격증명을 넣지 마세요");
    expect(result.message).toContain("--header-env");
    // 안내 문장이 우리가 막으려던 값을 되풀이하면 막은 뜻이 없다.
    expect(result.message).not.toContain("secret");
  });
});

describe("parseHeaderEnvOption", () => {
  it("헤더 이름과 환경변수 이름을 나눈다", () => {
    expect(parseHeaderEnvOption("Authorization=MCP_TOKEN")).toEqual({
      ok: true,
      value: { header: "Authorization", envName: "MCP_TOKEN" },
    });
  });

  it.each(["Authorization", "=MCP_TOKEN"])("'=' 로 나뉘지 않는 '%s' 를 거절한다", (raw) => {
    const result = parseHeaderEnvOption(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("<헤더이름>=<환경변수이름>");
  });

  it("헤더 이름이 RFC 9110 토큰이 아니면 거절한다", () => {
    const result = parseHeaderEnvOption("Auth orization=MCP_TOKEN");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("쓸 수 없는 문자");
  });

  /**
   * **이 옵션의 안전 근거를 지키는 단언이다.** 사용자가 이름 대신 값을 바로 넣으려 하면
   * 공백·따옴표 때문에 환경변수 이름 문자셋에서 걸린다. 걸리지 않으면 우리가 막으려던 노출
   * (`ps` 목록·셸 히스토리)이 이 옵션을 통해 그대로 일어난다.
   */
  it("환경변수 이름 자리에 값을 직접 넣으면 이유를 말하며 거절한다", () => {
    const result = parseHeaderEnvOption("Authorization=Bearer abc123");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("환경변수 **이름**이 아닌 값");
    expect(result.message).toContain("`ps` 목록과 셸 히스토리");
  });
});

describe("describeTarget", () => {
  it("stdio 는 명령줄로, http 는 URL 로 말한다", () => {
    expect(describeTarget(stdioTarget)).toBe("node server.mjs");
    expect(describeTarget(httpTarget())).toBe("https://mcp.example.com/v1");
  });
});

describe("openConnection", () => {
  it("stdio 대상은 connectStdio 만 부른다", async () => {
    const connectStdio = vi.fn(async () => stdioConnection());
    const connectHttp = vi.fn(async () => httpConnection());

    await openConnection(stdioTarget, { connectStdio, connectHttp });

    expect(connectStdio).toHaveBeenCalledWith({ command: "node", args: ["server.mjs"] });
    expect(connectHttp).not.toHaveBeenCalled();
  });

  it("stdio 대상에 External 배선의 env 를 넘긴다", async () => {
    const connectStdio = vi.fn(async () => stdioConnection());

    await openConnection(stdioTarget, { connectStdio }, { env: { BOOTSTRAP: "1" } });

    expect(connectStdio).toHaveBeenCalledWith({
      command: "node",
      args: ["server.mjs"],
      env: { BOOTSTRAP: "1" },
    });
  });

  it("http 대상은 connectHttp 만 부른다", async () => {
    const connectStdio = vi.fn(async () => stdioConnection());
    const connectHttp = vi.fn(async () => httpConnection());

    await openConnection(httpTarget(), { connectStdio, connectHttp });

    expect(connectHttp).toHaveBeenCalledWith({ url: "https://mcp.example.com/v1" });
    expect(connectStdio).not.toHaveBeenCalled();
  });

  it("헤더 값을 환경변수에서 읽어 채운다", async () => {
    const connectHttp = vi.fn(async () => httpConnection());
    const readEnv = vi.fn((name: string) => (name === "MCP_TOKEN" ? "Bearer abc" : undefined));

    await openConnection(httpTarget({ Authorization: "MCP_TOKEN" }), {
      connectStdio: vi.fn(async () => stdioConnection()),
      connectHttp,
      readEnv,
    });

    expect(readEnv).toHaveBeenCalledWith("MCP_TOKEN");
    expect(connectHttp).toHaveBeenCalledWith({
      url: "https://mcp.example.com/v1",
      headers: { Authorization: "Bearer abc" },
    });
  });

  /**
   * 값이 비었다는 사실은 알리되 값 자체는 화면에 싣지 않는다. 실패 문장으로 비밀이 새면
   * 이 옵션이 존재하는 이유가 없어진다.
   */
  it("환경변수가 비면 이름만 말하고 연결하지 않는다", async () => {
    const connectHttp = vi.fn(async () => httpConnection());

    await expect(
      openConnection(httpTarget({ Authorization: "MCP_TOKEN" }), {
        connectStdio: vi.fn(async () => stdioConnection()),
        connectHttp,
        readEnv: () => undefined,
      }),
    ).rejects.toThrow(ConnectTargetError);
    expect(connectHttp).not.toHaveBeenCalled();
  });

  it("환경변수 값에 개행이 있으면 어느 변수인지 말하며 멈춘다", async () => {
    const error = await openConnection(httpTarget({ Authorization: "MCP_TOKEN" }), {
      connectStdio: vi.fn(async () => stdioConnection()),
      connectHttp: vi.fn(async () => httpConnection()),
      readEnv: () => "Bearer abc\n",
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ConnectTargetError);
    expect((error as Error).message).toContain("MCP_TOKEN");
    expect((error as Error).message).toContain("개행");
  });

  /**
   * 조용히 stdio 로 떨어지면 사용자가 지정하지 않은 대상에 붙는다. 무엇이 없는지 말하고 멈춘다.
   */
  it("connectHttp 주입이 없으면 무엇이 안 되는지 말하고 멈춘다", async () => {
    const error = await openConnection(httpTarget(), {
      connectStdio: vi.fn(async () => stdioConnection()),
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ConnectTargetError);
    expect((error as Error).message).toContain("원격(Streamable HTTP) 서버를 지원하지 않습니다");
  });

  it("readEnv 주입이 없으면 --header-env 를 쓸 수 없다고 말한다", async () => {
    const error = await openConnection(httpTarget({ Authorization: "MCP_TOKEN" }), {
      connectStdio: vi.fn(async () => stdioConnection()),
      connectHttp: vi.fn(async () => httpConnection()),
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ConnectTargetError);
    expect((error as Error).message).toContain("`--header-env` 를 지원하지 않습니다");
  });

  /**
   * `McpHttpConnection` 에는 `forceClose` 가 없다(ADR-0020 설계 §9 — 죽일 프로세스가 없다).
   * 호출부의 타임아웃·강제 종료 경로가 transport 를 되묻지 않도록 여기서 흡수한다.
   */
  it("http 연결의 forceClose 는 close 를 부른다", async () => {
    const connection = httpConnection();
    const opened = await openConnection(httpTarget(), {
      connectStdio: vi.fn(async () => stdioConnection()),
      connectHttp: async () => connection,
    });

    await opened.forceClose();

    expect(connection.close).toHaveBeenCalledTimes(1);
  });
});
