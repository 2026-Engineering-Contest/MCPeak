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

  it("JSON 의 command 에 환경변수 할당이 있으면 거절하고 값을 싣지 않는다", () => {
    const result = parseServerInput('{"a":{"command":"API_KEY=s3cr3t-value node s.mjs"}}');
    expect(result).toEqual({
      ok: false,
      error:
        "'a' 항목의 command 에 환경변수 할당이 있습니다. 값은 env 칸으로 옮기고 command 에는 실행 파일만 적으세요.",
    });
    expect(JSON.stringify(result)).not.toContain("s3cr3t-value");
  });

  it("이름 없는 한 서버 설정의 command 도 같은 이유로 거절한다", () => {
    expect(parseServerInput('{"command":"TOKEN=x npx -y pkg"}')).toEqual({
      ok: false,
      error:
        "설정의 command 에 환경변수 할당이 있습니다. 값은 env 칸으로 옮기고 command 에는 실행 파일만 적으세요.",
    });
  });

  it("JSON 의 command 가 env 로 값을 넘겨도 거절한다", () => {
    const result = parseServerInput('{"a":{"command":"env API_KEY=s3cr3t-value node s.mjs"}}');
    expect(result).toEqual({
      ok: false,
      error:
        "'a' 항목의 command 에 환경변수 할당이 있습니다. 값은 env 칸으로 옮기고 command 에는 실행 파일만 적으세요.",
    });
    expect(JSON.stringify(result)).not.toContain("s3cr3t-value");
  });

  it("JSON 의 command 가 env 이고 args 가 값을 넘기면 이름만 남기고 실행 파일을 찾는다", () => {
    const result = parseServerInput(
      '{"a":{"command":"env","args":["API_KEY=s3cr3t-value","node","s.mjs"],"env":{"TOKEN":"t0k"}}}',
    );
    expect(result).toEqual({
      ok: true,
      servers: [
        {
          name: "a",
          transport: "stdio",
          command: "node",
          args: ["s.mjs"],
          envNames: ["TOKEN", "API_KEY"],
          url: "",
          headerNames: [],
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("s3cr3t-value");
    expect(JSON.stringify(result)).not.toContain("t0k");
  });

  it("JSON 의 command 가 env 뿐이면 실행 명령이 없다고 말한다", () => {
    expect(parseServerInput('{"a":{"command":"env","args":["API_KEY=x"]}}')).toEqual({
      ok: false,
      error: "'a' 항목에 실행 명령이 없습니다. 환경변수 뒤에 명령을 적으세요.",
    });
  });

  it("명령 한 줄의 env KEY=value 는 이름만 남기고 값을 싣지 않는다", () => {
    const result = parseServerInput("env -i API_KEY=s3cr3t-value TOKEN=t0k npx -y pkg");
    expect(result).toEqual({
      ok: true,
      servers: [
        {
          name: null,
          transport: "stdio",
          command: "npx",
          args: ["-y", "pkg"],
          envNames: ["API_KEY", "TOKEN"],
          url: "",
          headerNames: [],
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("s3cr3t-value");
  });

  it("실행 파일 뒤의 KEY=value 꼴 인자는 건드리지 않는다", () => {
    const result = parseServerInput("node s.mjs --define MODE=dev");
    expect(result.ok && result.servers[0]?.args).toEqual(["s.mjs", "--define", "MODE=dev"]);
  });

  it("JSON 의 command 에서 따옴표로 감싼 환경변수 할당도 거절한다", () => {
    const result = parseServerInput(
      JSON.stringify({ a: { command: "env 'API_KEY=s3cr3t-value' node s.mjs" } }),
    );
    expect(result).toEqual({
      ok: false,
      error:
        "'a' 항목의 command 에 환경변수 할당이 있습니다. 값은 env 칸으로 옮기고 command 에는 실행 파일만 적으세요.",
    });
    expect(JSON.stringify(result)).not.toContain("s3cr3t-value");
  });

  it("JSON 의 command 에 닫히지 않은 따옴표가 있으면 거절한다", () => {
    const result = parseServerInput(
      JSON.stringify({ a: { command: "env 'API_KEY=s3cr3t-value node" } }),
    );
    expect(result).toEqual({
      ok: false,
      error: "'a' 항목의 command 에 닫히지 않은 따옴표가 있습니다.",
    });
  });

  it("env 의 값을 받는 옵션은 그 값까지 건너뛴다", () => {
    for (const line of [
      "env -u TOKEN node s.mjs",
      "env --unset TOKEN node s.mjs",
      "env --unset=TOKEN node s.mjs",
      "env -i - node s.mjs",
    ]) {
      const result = parseServerInput(line);
      expect(result.ok && result.servers[0]?.command, line).toBe("node");
      expect(result.ok && result.servers[0]?.args, line).toEqual(["s.mjs"]);
    }
  });

  it("env 의 모르는 옵션은 건너뛰지 않고 거절한다", () => {
    const result = parseServerInput('env -S "API_KEY=s3cr3t-value node s.mjs"');
    expect(result).toEqual({
      ok: false,
      error: "env 의 옵션을 읽지 못했습니다. env 를 빼고 실행 명령만 붙여 넣으세요.",
    });
    expect(JSON.stringify(result)).not.toContain("s3cr3t-value");
  });

  it("JSON 의 args 에 env 의 모르는 옵션이 있으면 거절한다", () => {
    expect(
      parseServerInput('{"a":{"command":"env","args":["-S","API_KEY=x node s.mjs"]}}'),
    ).toEqual({
      ok: false,
      error: "'a' 항목의 env 옵션을 읽지 못했습니다. env 를 빼고 command 에 실행 파일만 적으세요.",
    });
  });

  it("env 의 작업 디렉터리 옵션은 버리지 않고 거절한다", () => {
    for (const line of ["env -C /srv/app node s.mjs", "env --chdir=/srv/app node s.mjs"]) {
      expect(parseServerInput(line), line).toEqual({
        ok: false,
        error: "env 의 옵션을 읽지 못했습니다. env 를 빼고 실행 명령만 붙여 넣으세요.",
      });
    }
  });

  it("같은 이름의 환경변수는 한 번만 남긴다", () => {
    const result = parseServerInput("A=1 A=2 node s.mjs");
    expect(result.ok && result.servers[0]?.envNames).toEqual(["A"]);
  });

  describe("값이 인자로 나가는 꼴", () => {
    it("export 로 시작하는 줄은 거절하고 값을 싣지 않는다", () => {
      const result = parseServerInput("export API_KEY=s3cr3t-value && node s.mjs");
      expect(result).toEqual({
        ok: false,
        error:
          "'export' 는 셸 안에서만 도는 명령이라 사전 점검이 띄울 수 없습니다. 'export 이름=값' 은 빼고 서버를 띄우는 명령만 붙여 넣으세요.",
      });
    });

    it("셸 연산자가 있는 줄은 거절한다", () => {
      expect(parseServerInput("cd /srv/app && node s.mjs")).toEqual({
        ok: false,
        error:
          "셸 연산자 '&&' 가 있습니다. 사전 점검은 명령 하나만 띄웁니다. 서버를 띄우는 명령 하나만 붙여 넣으세요.",
      });
    });

    it.each([
      ["sudo API_KEY=s3cr3t-value node s.mjs", "sudo"],
      ["sudo -E env API_KEY=s3cr3t-value node s.mjs", "env"],
      ["npx cross-env API_KEY=s3cr3t-value node s.mjs", "cross-env"],
      ["exec env API_KEY=s3cr3t-value node s.mjs", "env"],
      ["\\env API_KEY=s3cr3t-value node s.mjs", "env"],
      ["/usr/bin/sudo API_KEY=s3cr3t-value node s.mjs", "sudo"],
    ])("%j 는 감싸는 명령 뒤의 할당을 거절하고 이름만 말한다", (line, wrapper) => {
      const result = parseServerInput(line);
      expect(result).toEqual({
        ok: false,
        error: `'${wrapper}' 뒤에 환경변수 할당(API_KEY)이 있습니다. 사전 점검은 환경변수 값을 넘기지 않습니다. 'API_KEY=...' 을 지우고 다시 붙여 넣으세요.`,
      });
      expect(JSON.stringify(result)).not.toContain("s3cr3t-value");
    });

    it("JSON 의 sh -c 코드에 든 할당은 항목 이름을 붙여 거절한다", () => {
      const result = parseServerInput(
        JSON.stringify({
          a: { command: "sh", args: ["-c", "cd /app && API_KEY=s3cr3t-value node s.mjs"] },
        }),
      );
      expect(result).toEqual({
        ok: false,
        error:
          "'a' 항목: 'sh -c' 의 코드에 환경변수 할당(API_KEY)이 있습니다. 사전 점검은 환경변수 값을 넘기지 않습니다. 'API_KEY=...' 을 지우고 다시 붙여 넣으세요.",
      });
      expect(JSON.stringify(result)).not.toContain("s3cr3t-value");
    });

    it("sh -c 코드의 --옵션=값 은 할당으로 보지 않는다", () => {
      const result = parseServerInput('bash -lc "node s.mjs --mode=dev"');
      expect(result.ok && result.servers[0]?.args).toEqual(["-lc", "node s.mjs --mode=dev"]);
    });

    it("docker 의 환경변수 옵션은 쌍을 걷어 내고 이름만 남긴다", () => {
      const result = parseServerInput(
        "docker run -i --rm -e API_KEY=s3cr3t-value --env TOKEN=t0k -eA=1 --env=B=2 -e PASSTHROUGH img --flag X=1",
      );
      expect(result).toEqual({
        ok: true,
        servers: [
          {
            name: null,
            transport: "stdio",
            command: "docker",
            args: ["run", "-i", "--rm", "-e", "PASSTHROUGH", "img", "--flag", "X=1"],
            envNames: ["API_KEY", "TOKEN", "A", "B"],
            url: "",
            headerNames: [],
          },
        ],
      });
      expect(JSON.stringify(result)).not.toContain("s3cr3t-value");
      expect(JSON.stringify(result)).not.toContain("t0k");
    });

    it("JSON 의 docker args 도 같은 식으로 걷어 내고 env 칸의 이름과 합친다", () => {
      const result = parseServerInput(
        JSON.stringify({
          a: {
            command: "docker",
            args: ["run", "-e", "API_KEY=s3cr3t-value", "img"],
            env: { API_KEY: "x", TOKEN: "y" },
          },
        }),
      );
      expect(result.ok && result.servers[0]?.args).toEqual(["run", "img"]);
      expect(result.ok && result.servers[0]?.envNames).toEqual(["API_KEY", "TOKEN"]);
    });
  });
});
