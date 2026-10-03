import { describe, expect, it } from "vitest";
import { parseServerInput } from "../src/precheck/parse-server-input.js";

/** 계획서 §5.2 표의 첫 줄. env 값 `v` 가 들어 있다. */
const MCP_SERVERS_JSON =
  '{"mcpServers":{"a":{"command":"npx","args":["-y","pkg"],"env":{"KEY":"v"}}}}';
/** 표의 둘째 줄. 헤더 값 `t` 가 들어 있다. */
const TWO_SERVERS_JSON =
  '{"a":{"command":"node","args":["s.mjs"]},"b":{"url":"https://x.test/mcp","headers":{"Authorization":"t"}}}';
/** 표의 다섯째 줄. env 값 `secret` 이 들어 있다. */
const ENV_PREFIXED_LINE = "API_KEY=secret node server.mjs";

describe("parseServerInput", () => {
  describe("입력과 결과의 대응 (계획서 §5.2 표)", () => {
    it("mcpServers JSON 은 이름과 env 이름을 가진 stdio 하나다", () => {
      expect(parseServerInput(MCP_SERVERS_JSON)).toEqual({
        ok: true,
        servers: [
          {
            name: "a",
            transport: "stdio",
            command: "npx",
            args: ["-y", "pkg"],
            envNames: ["KEY"],
            url: "",
            headerNames: [],
          },
        ],
      });
    });

    it("서버가 둘이면 적힌 순서로 내고 둘째는 헤더 이름을 가진 http 다", () => {
      expect(parseServerInput(TWO_SERVERS_JSON)).toEqual({
        ok: true,
        servers: [
          {
            name: "a",
            transport: "stdio",
            command: "node",
            args: ["s.mjs"],
            envNames: [],
            url: "",
            headerNames: [],
          },
          {
            name: "b",
            transport: "http",
            command: "",
            args: [],
            envNames: [],
            url: "https://x.test/mcp",
            headerNames: ["Authorization"],
          },
        ],
      });
    });

    it("한 서버의 설정만 붙여 넣으면 이름 없는 stdio 하나다", () => {
      expect(parseServerInput('{"command":"node","args":["s.mjs"]}')).toEqual({
        ok: true,
        servers: [
          {
            name: null,
            transport: "stdio",
            command: "node",
            args: ["s.mjs"],
            envNames: [],
            url: "",
            headerNames: [],
          },
        ],
      });
    });

    it("명령 한 줄은 첫 토큰이 command 이고 나머지가 args 다", () => {
      expect(parseServerInput('npx -y @scope/pkg --flag "a b"')).toEqual({
        ok: true,
        servers: [
          {
            name: null,
            transport: "stdio",
            command: "npx",
            args: ["-y", "@scope/pkg", "--flag", "a b"],
            envNames: [],
            url: "",
            headerNames: [],
          },
        ],
      });
    });

    it("명령 앞의 KEY=value 는 env 이름만 남긴다", () => {
      expect(parseServerInput(ENV_PREFIXED_LINE)).toEqual({
        ok: true,
        servers: [
          {
            name: null,
            transport: "stdio",
            command: "node",
            args: ["server.mjs"],
            envNames: ["API_KEY"],
            url: "",
            headerNames: [],
          },
        ],
      });
    });

    it("URL 은 http 하나다", () => {
      expect(parseServerInput("https://x.test/mcp")).toEqual({
        ok: true,
        servers: [
          {
            name: null,
            transport: "http",
            command: "",
            args: [],
            envNames: [],
            url: "https://x.test/mcp",
            headerNames: [],
          },
        ],
      });
    });
  });

  it("env 값은 결과 어디에도 없다", () => {
    expect(JSON.stringify(parseServerInput(MCP_SERVERS_JSON))).not.toContain('":"v"');
    expect(JSON.stringify(parseServerInput(ENV_PREFIXED_LINE))).not.toContain("secret");
  });

  it("헤더 값은 결과 어디에도 없다", () => {
    const result = parseServerInput(TWO_SERVERS_JSON);

    expect(JSON.stringify(result)).not.toContain('"t"');
    expect(result.ok && result.servers[1]?.headerNames).toEqual(["Authorization"]);
  });

  it("mcpServers 안쪽만 붙여 넣어도 읽는다", () => {
    expect(parseServerInput('{"a":{"command":"node"}}')).toEqual({
      ok: true,
      servers: [
        {
          name: "a",
          transport: "stdio",
          command: "node",
          args: [],
          envNames: [],
          url: "",
          headerNames: [],
        },
      ],
    });
  });

  it("따옴표 안의 공백은 나누지 않는다", () => {
    const result = parseServerInput("node \"my server.mjs\" 'x y'");

    expect(result.ok && result.servers[0]?.command).toBe("node");
    expect(result.ok && result.servers[0]?.args).toEqual(["my server.mjs", "x y"]);
  });

  it("줄 잇기 역슬래시를 버린다", () => {
    const result = parseServerInput("npx -y pkg \\\n  --port 3000");

    expect(result.ok && result.servers[0]?.command).toBe("npx");
    expect(result.ok && result.servers[0]?.args).toEqual(["-y", "pkg", "--port", "3000"]);
  });

  it("앞뒤 공백과 개행을 무시한다", () => {
    const result = parseServerInput("\n  node s.mjs \n");

    expect(result.ok && result.servers[0]?.command).toBe("node");
    expect(result.ok && result.servers[0]?.args).toEqual(["s.mjs"]);
  });

  describe("실패 문장", () => {
    it.each([
      ["", "서버 설정이나 실행 명령을 붙여 넣으세요."],
      ["   ", "서버 설정이나 실행 명령을 붙여 넣으세요."],
      ['{"mcpServers":', "JSON 으로 읽지 못했습니다. 중괄호와 따옴표, 쉼표를 확인하세요."],
      ['{"mcpServers":{}}', "설정에 서버가 없습니다."],
      ['{"a":{"args":["x"]}}', "'a' 항목에 command 도 http(s) url 도 없습니다."],
      ['{"a":"node"}', "'a' 항목이 객체가 아닙니다."],
      ['{"a":{"command":"node","args":"s.mjs"}}', "'a' 항목의 args 는 문자열 배열이어야 합니다."],
      ['{"command":"","args":[]}', "설정에 command 도 http(s) url 도 없습니다."],
      ['node "s.mjs', "따옴표가 닫히지 않았습니다."],
      ["https://x.test/mcp extra", "URL 에 공백이 있습니다. 주소 하나만 붙여 넣으세요."],
      ["API_KEY=1", "실행 명령이 없습니다. 환경변수 뒤에 명령을 적으세요."],
    ])("%j 는 실패 문장을 낸다", (input, error) => {
      expect(parseServerInput(input)).toEqual({ ok: false, error });
    });
  });

  it("url 이 http(s) 가 아니면 거절한다", () => {
    expect(parseServerInput('{"a":{"url":"ftp://x"}}')).toEqual({
      ok: false,
      error: "'a' 항목에 command 도 http(s) url 도 없습니다.",
    });
  });

  it("같은 입력은 같은 결과다", () => {
    expect(JSON.stringify(parseServerInput(MCP_SERVERS_JSON))).toBe(
      JSON.stringify(parseServerInput(MCP_SERVERS_JSON)),
    );
  });
});
