import type { McpClient, ToolDef } from "@ohmymcp/core";
import type { Cassette } from "@ohmymcp/record";
import { cassetteClient } from "@ohmymcp/record";
import type {
  RunnerExecution,
  RunnerReport,
  RunSuiteOptions,
  TestSuiteSpec,
} from "@ohmymcp/runner";
import { describe, expect, it, vi } from "vitest";
import {
  parseReplayCommand,
  type ReplayCommandDependencies,
  runReplayCommand,
} from "../src/replay-command.js";

const TOOLS: ToolDef[] = [
  {
    name: "get_weather",
    inputSchema: { type: "object", properties: { city: { type: "string" } } },
  },
];
const suite: TestSuiteSpec = { schemaVersion: 1, id: "suite", name: "Suite", cases: [] };
/** 주입한 renderReport 가 돌려주는 값. 렌더링 문안은 runner 의 reporter.test.ts 가 고정한다. */
const RENDERED = "렌더링 결과\n";
const report = (status: RunnerReport["status"] = "passed"): RunnerReport => ({
  schemaVersion: 1,
  suite: { id: "suite", name: "Suite" },
  status,
  cases: [],
  summary: {
    total: 0,
    passed: 0,
    failed: 0,
    timedOut: 0,
    cancelled: 0,
    notRun: 0,
    rejectionUnverified: 0,
  },
});

/**
 * 파일시스템을 거치지 않고 카세트를 하나 만든다. `cassette-wiring.test.ts` 의 같은 이름 헬퍼와
 * 같은 방식이다. 저장 경로(`prepareCassetteForWrite`)를 실제로 태워야 마스킹이 일어나므로
 * 리터럴로 카세트를 짓지 않는다.
 */
async function recordedCassette(raw: unknown = { temp: 21 }): Promise<Cassette> {
  let saved: Cassette | undefined;
  const inner: McpClient = {
    listTools: async () => TOOLS,
    callTool: async () => ({
      content: [{ type: "text", text: JSON.stringify(raw) }],
      isError: false,
      raw,
    }),
    close: async () => {},
  };
  const client = cassetteClient(inner, {
    cassette: null,
    mode: "record",
    onFlush: async (value) => {
      saved = value;
    },
  });
  await client.listTools();
  await client.callTool("get_weather", { city: "Seoul" });
  await client.close();
  if (saved === undefined) throw new Error("카세트가 만들어지지 않았습니다.");
  return saved;
}

function deps(cassette: Cassette | null, overrides: Partial<ReplayCommandDependencies> = {}) {
  const writes = { out: [] as string[], err: [] as string[] };
  const started: RunSuiteOptions[] = [];
  const execution: RunnerExecution = {
    report: Promise.resolve(report()),
    drain: Promise.resolve({ status: "settled" }),
  };
  const value: ReplayCommandDependencies = {
    readFile: vi.fn(async () => new TextEncoder().encode(JSON.stringify(suite))),
    validateSuite: vi.fn(() => ({ valid: true as const, value: suite })),
    loadCassette: vi.fn(async () => cassette),
    startRunner: vi.fn((options: RunSuiteOptions) => {
      started.push(options);
      return execution;
    }),
    finalize: vi.fn(async () => report()),
    renderReport: vi.fn(() => RENDERED),
    colorEnabled: false,
    writeStdout: (text) => writes.out.push(text),
    writeStderr: (text) => writes.err.push(text),
    ...overrides,
  };
  return { value, writes, started };
}

describe("parseReplayCommand", () => {
  it("명세 경로와 카세트 경로를 파싱한다", () => {
    expect(parseReplayCommand(["suite.json", "--cassette", "c.json"])).toStrictEqual({
      suitePath: "suite.json",
      cassettePath: "c.json",
    });
  });

  it("--cassette=값 형태도 받는다", () => {
    expect(parseReplayCommand(["suite.json", "--cassette=c.json"]).cassettePath).toBe("c.json");
  });

  it("--cassette 를 빠뜨리면 무엇이 필요한지 알려준다", () => {
    expect(() => parseReplayCommand(["suite.json"])).toThrow("--cassette");
  });

  it("명세 경로가 없으면 거절한다", () => {
    expect(() => parseReplayCommand(["--cassette", "c.json"])).toThrow("명세");
  });

  /**
   * 조용히 무시하지 않는다. 받아 주면 사용자는 서버가 떴다고 믿는다. ADR-0028 H안.
   */
  it.each(["--command", "--arg", "--stderr-lines"])(
    "replay 에서 의미 없는 %s 를 거절한다",
    (option) => {
      expect(() =>
        parseReplayCommand(["suite.json", "--cassette", "c.json", option, "node"]),
      ).toThrow("서버를 띄우지 않습니다");
    },
  );

  it("모르는 옵션은 그대로 알려준다", () => {
    expect(() => parseReplayCommand(["suite.json", "--cassette", "c.json", "--nope"])).toThrow(
      "--nope",
    );
  });
});

describe("runReplayCommand", () => {
  it("카세트를 재생하고 보고서를 낸다", async () => {
    const { value, writes } = deps(await recordedCassette());
    await expect(runReplayCommand(["suite.json", "--cassette", "c.json"], value)).resolves.toBe(0);
    expect(writes.out.join("")).toContain(RENDERED);
  });

  /**
   * 이 커맨드의 존재 이유다. 오프라인 클라이언트는 listTools·callTool 에서 던지므로,
   * 정상 응답이 나온다는 것 자체가 서버로 안 나갔다는 증거다. ADR-0003 "외부 호출 0회".
   */
  it("서버를 부르지 않고 카세트에서 응답한다", async () => {
    const { value, started } = deps(await recordedCassette({ temp: 21 }));
    await runReplayCommand(["suite.json", "--cassette", "c.json"], value);

    const client = started[0]?.client;
    expect(client).toBeDefined();
    await expect(client?.listTools()).resolves.toStrictEqual(TOOLS);
    await expect(client?.callTool("get_weather", { city: "Seoul" })).resolves.toMatchObject({
      isError: false,
      raw: { temp: 21 },
    });
  });

  it("카세트에 없는 호출은 record 가 만든 문장을 그대로 전달한다", async () => {
    const { value, started } = deps(await recordedCassette());
    await runReplayCommand(["suite.json", "--cassette", "c.json"], value);

    await expect(started[0]?.client.callTool("get_weather", { city: "Busan" })).rejects.toThrow(
      "카세트에 없는 호출입니다",
    );
  });

  it("카세트 파일이 없으면 --record 로 만들라고 알려준다", async () => {
    const { value, writes } = deps(null);
    await expect(runReplayCommand(["suite.json", "--cassette", "c.json"], value)).resolves.toBe(1);
    const err = writes.err.join("");
    expect(err).toContain("CASSETTE_NOT_FOUND");
    expect(err).toContain("c.json");
    expect(err).toContain("--record");
  });

  it("카세트를 읽지 못하면 실패로 끝난다", async () => {
    const { value, writes } = deps(null, {
      loadCassette: vi.fn(async () => {
        throw new Error("→ cassette 이(가) 올바른 카세트가 아닙니다: version 이 1 이 아닙니다");
      }),
    });
    await expect(runReplayCommand(["suite.json", "--cassette", "c.json"], value)).resolves.toBe(1);
    const err = writes.err.join("");
    expect(err).toContain("CASSETTE_READ_FAILED");
    expect(err).toContain("version 이 1 이 아닙니다");
  });

  /**
   * 거부하지 않고 경고한다. ADR-0028 F안. 마스킹된 값이 판정을 바꿀 수 있다는 사실만 알린다.
   */
  it("마스킹된 값이 있으면 경고하되 실행은 계속한다", async () => {
    const { value, writes } = deps(await recordedCassette({ apiKey: "sk-live-abc", temp: 21 }));
    await expect(runReplayCommand(["suite.json", "--cassette", "c.json"], value)).resolves.toBe(0);

    const err = writes.err.join("");
    expect(err).toContain("마스킹된 값");
    expect(err).toContain("apiKey");
    expect(writes.out.join("")).toContain(RENDERED);
  });

  it("마스킹된 값이 없으면 경고하지 않는다", async () => {
    const { value, writes } = deps(await recordedCassette({ temp: 21 }));
    await runReplayCommand(["suite.json", "--cassette", "c.json"], value);
    expect(writes.err.join("")).not.toContain("마스킹된 값");
  });

  it("마스킹 경로가 많으면 총 개수와 표시 상한을 알려준다", async () => {
    const { value, writes } = deps(
      await recordedCassette({
        apiKey0: "a",
        apiKey1: "b",
        apiKey2: "c",
        apiKey3: "d",
        apiKey4: "e",
        apiKey5: "f",
      }),
    );
    await runReplayCommand(["suite.json", "--cassette", "c.json"], value);

    const err = writes.err.join("");
    expect(err).toContain("마스킹된 경로 6개 중 5개만 표시합니다");
    expect(err).not.toContain("apiKey5");
  });

  /**
   * 재생 중에 나는 미스는 runner 가 "MCP 서버 프로세스와 연결 상태를 확인하세요" 로 바꾼다.
   * replay 에는 서버가 없으므로 그 안내는 사용자를 없는 곳으로 보낸다. 시작 전에 잡는다.
   */
  it("명세의 호출이 카세트에 없으면 실행 전에 무엇이 없는지 알려준다", async () => {
    const missing: TestSuiteSpec = {
      ...suite,
      cases: [
        {
          id: "not-recorded",
          name: "녹화되지 않은 도시",
          operation: { type: "callTool", tool: "get_weather", input: { city: "부산" } },
          assertions: [{ type: "isError", expected: false }],
        },
      ],
    };
    const { value, writes, started } = deps(await recordedCassette(), {
      validateSuite: vi.fn(() => ({ valid: true as const, value: missing })),
    });

    await expect(runReplayCommand(["suite.json", "--cassette", "c.json"], value)).resolves.toBe(1);
    const err = writes.err.join("");
    expect(err).toContain("CASSETTE_INCOMPLETE");
    expect(err).toContain("not-recorded");
    expect(err).toContain("부산");
    // 시작 전에 잡으므로 실행 자체가 없다. 부분 실행 뒤의 혼란스러운 실패를 만들지 않는다.
    expect(started).toStrictEqual([]);
  });

  it("listTools 케이스가 있는데 카세트에 tools 가 없으면 실행 전에 잡는다", async () => {
    const listToolsSuite: TestSuiteSpec = {
      ...suite,
      cases: [
        {
          id: "tool-exists",
          name: "도구를 제공한다",
          operation: { type: "listTools" },
          assertions: [{ type: "toolExists", tool: "get_weather" }],
        },
      ],
    };
    const cassette = await recordedCassette();
    const { value, writes } = deps(
      { ...cassette, tools: undefined },
      { validateSuite: vi.fn(() => ({ valid: true as const, value: listToolsSuite })) },
    );

    await expect(runReplayCommand(["suite.json", "--cassette", "c.json"], value)).resolves.toBe(1);
    expect(writes.err.join("")).toContain("listTools 응답");
  });

  it("케이스가 실패하면 1 로 끝난다", async () => {
    const { value } = deps(await recordedCassette(), {
      finalize: vi.fn(async () => report("failed")),
    });
    await expect(runReplayCommand(["suite.json", "--cassette", "c.json"], value)).resolves.toBe(1);
  });

  it.each([
    {
      name: "지원하지 않는 명세 형식",
      argv: ["suite.yaml", "--cassette", "c.json"],
      overrides: {},
      code: "SUITE_FORMAT_UNSUPPORTED",
    },
    {
      name: "명세 읽기 실패",
      argv: ["suite.json", "--cassette", "c.json"],
      overrides: {
        readFile: vi.fn(async () => {
          throw new Error("read failed");
        }),
      },
      code: "SUITE_READ_FAILED",
    },
    {
      name: "잘못된 UTF-8",
      argv: ["suite.json", "--cassette", "c.json"],
      overrides: { readFile: vi.fn(async () => new Uint8Array([0xc3, 0x28])) },
      code: "SUITE_ENCODING_INVALID",
    },
    {
      name: "잘못된 JSON",
      argv: ["suite.json", "--cassette", "c.json"],
      overrides: { readFile: vi.fn(async () => new TextEncoder().encode("{")) },
      code: "SUITE_JSON_INVALID",
    },
    {
      name: "유효하지 않은 명세",
      argv: ["suite.json", "--cassette", "c.json"],
      overrides: { validateSuite: vi.fn(() => ({ valid: false as const, issues: [] })) },
      code: "SUITE_VALIDATION_FAILED",
    },
  ] satisfies {
    name: string;
    argv: string[];
    overrides: Partial<ReplayCommandDependencies>;
    code: string;
  }[])("$name 오류 계약을 지킨다", async ({ argv, overrides, code }) => {
    const { value, writes } = deps(null, overrides);
    await expect(runReplayCommand(argv, value)).resolves.toBe(1);
    const err = writes.err.join("");
    expect(err).toContain(`오류 [${code}]`);
    expect(err).toContain("해결:");
  });

  it("validateSuite 가 던지면 CLI_INTERNAL_ERROR 로 정규화한다", async () => {
    const { value, writes } = deps(null, {
      validateSuite: vi.fn(() => {
        throw new Error("runtime dependencies unavailable");
      }),
    });
    await expect(runReplayCommand(["suite.json", "--cassette", "c.json"], value)).resolves.toBe(1);
    expect(writes.err.join("")).toContain("CLI_INTERNAL_ERROR");
  });

  it("Runner 시작 실패를 구조화된 오류로 돌려준다", async () => {
    const { value, writes } = deps(await recordedCassette(), {
      startRunner: vi.fn(() => {
        throw new Error("start failed");
      }),
    });
    await expect(runReplayCommand(["suite.json", "--cassette", "c.json"], value)).resolves.toBe(1);
    expect(writes.err.join("")).toContain("RUNNER_EXECUTION_FAILED");
  });

  it("Runner 종료 실패에 원인 문장을 보존한다", async () => {
    const { value, writes } = deps(await recordedCassette(), {
      finalize: vi.fn(async () => {
        throw new Error("카세트에 없는 호출입니다: get_weather");
      }),
    });
    await expect(runReplayCommand(["suite.json", "--cassette", "c.json"], value)).resolves.toBe(1);
    const err = writes.err.join("");
    expect(err).toContain("RUNNER_FINALIZATION_FAILED");
    expect(err).toContain("카세트에 없는 호출입니다: get_weather");
  });

  it("사용 오류는 해결 안내와 함께 stderr 로 간다", async () => {
    const { value, writes } = deps(null);
    await expect(runReplayCommand(["suite.json"], value)).resolves.toBe(1);
    const err = writes.err.join("");
    expect(err).toContain("CLI_USAGE");
    expect(err).toContain("해결:");
  });
});
