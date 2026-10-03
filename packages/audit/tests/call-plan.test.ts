import { describe, expect, it } from "vitest";
import { probeArguments } from "../src/probe-args.js";
import { planCalls } from "../src/sandbox/call-plan.js";
import type { RawTool } from "../src/types.js";

const TRAVERSAL = "../../../../../../../../home/node/.aws/credentials";
const ABSOLUTE = "/home/node/.ssh/id_ed25519";
const METADATA = "http://169.254.169.254/latest/meta-data/";
const LOOPBACK = "http://127.0.0.1:8080/";
const FILE_SCHEME = "file:///home/node/.git-credentials";
const SEPARATOR = "mcpeak; id";
const OPTION = "--output=/home/node/mcpeak-probe";

function tool(properties: Record<string, unknown>, required: string[] = []): RawTool {
  return { name: "t", inputSchema: { type: "object", properties, required } };
}

const ids = (input: RawTool) => planCalls(input).calls.map((call) => call.callId);

describe("planCalls", () => {
  it("첫 호출의 callId 는 placeholder 이고 args 는 probeArguments 결과와 같다", () => {
    const input = tool(
      {
        path: { type: "string" },
        depth: { type: "integer", minimum: 2 },
        note: { type: "string" },
      },
      ["path", "depth"],
    );
    const probe = probeArguments(input.inputSchema);
    expect(probe.ok).toBe(true);
    const first = planCalls(input).calls[0];
    expect(first?.callId).toBe("placeholder");
    expect(first?.args).toEqual(probe.ok ? probe.args : undefined);
    expect(first?.args).toEqual({ path: "mcpeak", depth: 2 });
  });

  it("같은 도구에 두 번 부르면 같은 결과다", () => {
    const input = tool({ path: { type: "string" }, url: { type: "string" } }, ["path"]);
    expect(JSON.stringify(planCalls(input))).toBe(JSON.stringify(planCalls(input)));
  });

  it("callId 가 도구 안에서 겹치지 않는다", () => {
    const input = tool({
      path: { type: "string" },
      file_path: { type: "string" },
      url: { type: "string" },
      placeholder: { type: "string", format: "uri" },
    });
    const all = ids(input);
    expect(new Set(all).size).toBe(all.length);
    expect(all[0]).toBe("placeholder");
  });

  it("probeArguments 가 실패하면 calls 는 [] 이고 skipped 가 그 reason 이다", () => {
    const input: RawTool = {
      name: "t",
      inputSchema: { type: "object", properties: {}, required: ["missing"] },
    };
    const probe = probeArguments(input.inputSchema);
    expect(probe.ok).toBe(false);
    expect(planCalls(input)).toEqual({
      calls: [],
      skipped: probe.ok ? undefined : probe.reason,
    });
    expect(planCalls(input).skipped).toBe("필수 속성 'missing' 의 스키마가 properties 에 없습니다");
  });

  it("문자열 인자가 하나도 없는 도구는 placeholder 호출 하나뿐이다", () => {
    expect(planCalls(tool({ a: { type: "number" }, b: { type: "boolean" } }, ["a", "b"]))).toEqual({
      calls: [{ callId: "placeholder", args: { a: 0, b: false } }],
    });
    expect(planCalls({ name: "t" })).toEqual({ calls: [{ callId: "placeholder", args: {} }] });
    expect(planCalls({ name: "t", inputSchema: { type: "object" } })).toEqual({
      calls: [{ callId: "placeholder", args: {} }],
    });
    // 문자열이지만 어느 분류에도 들지 않는 이름이면 페이로드가 없다.
    expect(ids(tool({ city: { type: "string" }, query: { type: "string" } }, ["city"]))).toEqual([
      "placeholder",
    ]);
  });

  it("path 속성에는 path:traversal, path:absolute 가 이 순서로 온다", () => {
    expect(planCalls(tool({ path: { type: "string" } }, ["path"])).calls).toEqual([
      { callId: "placeholder", args: { path: "mcpeak" } },
      { callId: "path:traversal", args: { path: TRAVERSAL } },
      { callId: "path:absolute", args: { path: ABSOLUTE } },
    ]);
  });

  it("url 속성에는 url:metadata, url:loopback, url:file-scheme 이 이 순서로 온다", () => {
    expect(planCalls(tool({ url: { type: "string" } }, ["url"])).calls).toEqual([
      { callId: "placeholder", args: { url: "mcpeak" } },
      { callId: "url:metadata", args: { url: METADATA } },
      { callId: "url:loopback", args: { url: LOOPBACK } },
      { callId: "url:file-scheme", args: { url: FILE_SCHEME } },
    ]);
  });

  it("command 속성에는 command:separator, command:option 이 이 순서로 온다", () => {
    expect(planCalls(tool({ command: { type: "string" } }, ["command"])).calls).toEqual([
      { callId: "placeholder", args: { command: "mcpeak" } },
      { callId: "command:separator", args: { command: SEPARATOR } },
      { callId: "command:option", args: { command: OPTION } },
    ]);
  });

  it("filePath, file_path, FILE-PATH 가 전부 경로로 분류된다", () => {
    for (const name of ["filePath", "file_path", "FILE-PATH"]) {
      expect(ids(tool({ [name]: { type: "string" } }))).toEqual([
        "placeholder",
        `${name}:traversal`,
        `${name}:absolute`,
      ]);
    }
  });

  it.each([
    "path",
    "file",
    "filename",
    "filepath",
    "dir",
    "directory",
    "folder",
    "outputDir",
    "target_folder",
  ])("경로 행: 마지막 토큰이 표에 있는 '%s' 는 경로 페이로드를 받는다", (name) => {
    expect(ids(tool({ [name]: { type: "string" } }))).toEqual([
      "placeholder",
      `${name}:traversal`,
      `${name}:absolute`,
    ]);
  });

  it.each([
    "url",
    "uri",
    "endpoint",
    "link",
    "href",
    "webhook",
    "imageUrl",
    "callbackURL",
    "api-endpoint",
  ])("URL 행: 마지막 토큰이 표에 있는 '%s' 는 URL 페이로드를 받는다", (name) => {
    expect(ids(tool({ [name]: { type: "string" } }))).toEqual([
      "placeholder",
      `${name}:metadata`,
      `${name}:loopback`,
      `${name}:file-scheme`,
    ]);
  });

  it.each([
    "command",
    "cmd",
    "exec",
    "script",
    "shell",
    "args",
    "argv",
    "options",
    "flags",
    "gitArgs",
    "extra_flags",
  ])("명령 행: 마지막 토큰이 표에 있는 '%s' 는 명령 페이로드를 받는다", (name) => {
    expect(ids(tool({ [name]: { type: "string" } }))).toEqual([
      "placeholder",
      `${name}:separator`,
      `${name}:option`,
    ]);
  });

  it.each([
    "pathname_hint",
    "pathPrefix",
    "profile",
    "urlencoded",
    "commander",
    "city",
    "files",
    "paths",
  ])("반례: 마지막 토큰이 표에 없는 '%s' 는 페이로드를 받지 않는다", (name) => {
    expect(ids(tool({ [name]: { type: "string" } }))).toEqual(["placeholder"]);
  });

  it("format 이 uri 인 속성은 이름과 무관하게 URL 로 분류된다", () => {
    expect(ids(tool({ target: { type: "string", format: "uri" } }))).toEqual([
      "placeholder",
      "target:metadata",
      "target:loopback",
      "target:file-scheme",
    ]);
    expect(ids(tool({ target: { type: "string", format: "url" } }))).toEqual([
      "placeholder",
      "target:metadata",
      "target:loopback",
      "target:file-scheme",
    ]);
    // 이름이 경로여도 format 이 이긴다.
    expect(ids(tool({ path: { type: "string", format: "uri" } }))).toEqual([
      "placeholder",
      "path:metadata",
      "path:loopback",
      "path:file-scheme",
    ]);
    // 다른 format 은 분류를 바꾸지 않는다.
    expect(ids(tool({ target: { type: "string", format: "email" } }))).toEqual(["placeholder"]);
  });

  it("문자열 타입이 아닌 속성은 이름이 맞아도 건너뛴다", () => {
    expect(
      ids(tool({ path: { type: "number" }, args: { type: "array", items: { type: "string" } } })),
    ).toEqual(["placeholder"]);
    expect(ids(tool({ path: {} }))).toEqual(["placeholder"]);
  });

  it("enum 이나 const 가 있는 속성은 건너뛴다", () => {
    expect(
      ids(
        tool({
          path: { type: "string", enum: ["a", "b"] },
          url: { type: "string", const: "https://example.invalid/" },
          file: { type: "string" },
        }),
      ),
    ).toEqual(["placeholder", "file:traversal", "file:absolute"]);
  });

  it("페이로드 호출은 속성 하나만 바꾸고 나머지는 placeholder 값이다", () => {
    const input = tool(
      { path: { type: "string" }, url: { type: "string" }, count: { type: "integer" } },
      ["path", "url", "count"],
    );
    const { calls } = planCalls(input);
    const base = calls[0]?.args;
    expect(base).toEqual({ path: "mcpeak", url: "mcpeak", count: 0 });
    for (const call of calls.slice(1)) {
      const [property] = call.callId.split(":");
      const changed = Object.keys(call.args).filter((key) => call.args[key] !== base?.[key]);
      expect(changed).toEqual([property]);
      expect(Object.keys(call.args).sort()).toEqual(["count", "path", "url"]);
    }
    // 속성은 선언 순서로 돈다.
    expect(calls.map((call) => call.callId)).toEqual([
      "placeholder",
      "path:traversal",
      "path:absolute",
      "url:metadata",
      "url:loopback",
      "url:file-scheme",
    ]);
  });

  it("선택 속성의 페이로드 호출은 그 속성만 더한다", () => {
    const input = tool({ query: { type: "string" }, path: { type: "string" } }, ["query"]);
    expect(planCalls(input).calls).toEqual([
      { callId: "placeholder", args: { query: "mcpeak" } },
      { callId: "path:traversal", args: { query: "mcpeak", path: TRAVERSAL } },
      { callId: "path:absolute", args: { query: "mcpeak", path: ABSOLUTE } },
    ]);
  });

  it("페이로드가 8개를 넘으면 앞 8개만 오고 skipped 가 버린 수를 말한다", () => {
    const input: RawTool = {
      name: "copy_all",
      inputSchema: {
        type: "object",
        properties: {
          src_path: { type: "string" },
          dst_path: { type: "string" },
          url: { type: "string" },
          webhook: { type: "string" },
          cmd: { type: "string" },
        },
      },
    };
    const plan = planCalls(input);
    // 2 + 2 + 3 + 3 + 2 = 12 개 중 앞 8개.
    expect(plan.calls.map((call) => call.callId)).toEqual([
      "placeholder",
      "src_path:traversal",
      "src_path:absolute",
      "dst_path:traversal",
      "dst_path:absolute",
      "url:metadata",
      "url:loopback",
      "url:file-scheme",
      "webhook:metadata",
    ]);
    expect(plan.skipped).toBe(
      "도구 'copy_all' 의 페이로드 호출 4개를 상한(8개) 때문에 보내지 않았습니다.",
    );

    // 정확히 8개면 skipped 가 없다.
    const exact = planCalls(
      tool({
        a_path: { type: "string" },
        b_path: { type: "string" },
        c_path: { type: "string" },
        d_path: { type: "string" },
      }),
    );
    expect(exact.calls).toHaveLength(9);
    expect(exact.skipped).toBeUndefined();
  });

  it("중첩 객체 안의 path 는 보지 않는다", () => {
    const input = tool(
      {
        options: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
        files: { type: "array", items: { type: "string" } },
      },
      ["options"],
    );
    expect(planCalls(input).calls).toEqual([
      { callId: "placeholder", args: { options: { path: "mcpeak" } } },
    ]);
  });

  it("모든 페이로드 값이 /home/node, 169.254.169.254, 127.0.0.1, 고정 문자열 밖을 가리키지 않는다", () => {
    const input = tool({
      path: { type: "string" },
      url: { type: "string" },
      command: { type: "string" },
    });
    const values = planCalls(input)
      .calls.slice(1)
      .map((call) => {
        const [property] = call.callId.split(":");
        return call.args[property as string];
      });
    expect(values).toEqual([
      TRAVERSAL,
      ABSOLUTE,
      METADATA,
      LOOPBACK,
      FILE_SCHEME,
      SEPARATOR,
      OPTION,
    ]);
    for (const value of values) {
      expect(typeof value).toBe("string");
      const text = value as string;
      // 경로를 담은 값은 전부 격리 홈 아래를 가리킨다.
      for (const match of text.matchAll(/\/[A-Za-z][^\s;]*/g)) {
        const path = match[0];
        if (path.startsWith("//")) continue; // URL 의 authority 는 아래에서 본다.
        if (/^\/(latest|meta-data)/.test(path)) continue; // 메타데이터 URL 의 경로 조각.
        expect(path.startsWith("/home/node")).toBe(true);
      }
      // 주소를 담은 값은 링크 로컬 메타데이터와 루프백뿐이다.
      for (const match of text.matchAll(/\d+\.\d+\.\d+\.\d+/g)) {
        expect(["169.254.169.254", "127.0.0.1"]).toContain(match[0]);
      }
      expect(text).not.toMatch(/https:/);
    }
  });
});
