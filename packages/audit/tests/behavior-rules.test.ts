import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BEHAVIOR_RULES, type BehaviorContext, runBehaviorRules } from "../src/rules/behavior.js";
import { filterNoise, NOISE_TABLE } from "../src/sandbox/noise.js";
import { parseTrace } from "../src/sandbox/trace.js";
import type {
  CollectedString,
  Finding,
  HomePlan,
  Observation,
  RawTool,
  SandboxPhase,
  Severity,
  SyscallEvent,
} from "../src/types.js";

const SANDBOX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sandbox");

const AWS_CANARY = "0123456789abcdef0123456789abcdef";
const SSH_CANARY = "fedcba9876543210fedcba9876543210";

/** 카나리 값을 고정 문자열로 둔 작은 격리 홈. 실제 계획은 planHome 이 만든다. */
const HOME: HomePlan = {
  hostname: "jiwoo-laptop",
  files: [
    {
      path: ".aws/credentials",
      content: `[default]\naws_secret_access_key = ${AWS_CANARY}\n`,
      mode: 0o644,
      canary: AWS_CANARY,
    },
    { path: ".ssh/id_ed25519", content: `${SSH_CANARY}\n`, mode: 0o644, canary: SSH_CANARY },
    { path: ".gitconfig", content: "[user]\n\tname = Jiwoo Kim\n", mode: 0o644 },
  ],
};

const START: SandboxPhase = { kind: "start" };
const LIST: SandboxPhase = { kind: "list" };
const SHUTDOWN: SandboxPhase = { kind: "shutdown" };

type Call = BehaviorContext["calls"][number];

function call(toolIndex: number, toolName: string, callId: string): Call {
  return { toolIndex, toolName, callId, outcome: "ok" };
}

function phaseOf(entry: Call): SandboxPhase {
  return {
    kind: "call",
    toolIndex: entry.toolIndex,
    toolName: entry.toolName,
    callId: entry.callId,
  };
}

const open = (
  phase: SandboxPhase,
  path: string,
  write = false,
  result: "ok" | "denied" | "missing" | "error" = "ok",
): SyscallEvent => ({ kind: "open", phase, path, write, result });

const exec = (
  phase: SandboxPhase,
  path: string,
  argv: readonly string[],
  result: "ok" | "error" = "ok",
): SyscallEvent => ({ kind: "exec", phase, path, argv, result });

const alter = (
  phase: SandboxPhase,
  path: string,
  via: "unlink" | "rmdir" | "rename-from" | "rename-to",
  result: "ok" | "denied" | "missing" | "error" = "denied",
): SyscallEvent => ({ kind: "alter", phase, path, via, result });

const connect = (
  phase: SandboxPhase,
  address: string,
  port: number,
  family: "inet" | "inet6" | "unix" = address.includes(":") ? "inet6" : "inet",
): SyscallEvent => ({ kind: "connect", phase, family, address, port });

function observation(events: readonly SyscallEvent[], traceShrank = false): Observation {
  return { events, requests: [], tlsRejections: [], dnsNames: [], traceShrank, gaps: [] };
}

const READ_NOTE: RawTool = { name: "read_note", inputSchema: { type: "object" } };
const READ_ONLY: RawTool = {
  name: "list_files",
  inputSchema: { type: "object" },
  annotations: { readOnlyHint: true },
};
const NON_DESTRUCTIVE: RawTool = {
  name: "tidy",
  inputSchema: { type: "object" },
  annotations: { destructiveHint: false },
};

const PLACEHOLDER = call(0, "read_note", "placeholder");
const TRAVERSAL = call(0, "read_note", "path:traversal");
const ABSOLUTE = call(0, "read_note", "path:absolute");
const CALLS = [PLACEHOLDER, TRAVERSAL, ABSOLUTE];

function run(
  events: readonly SyscallEvent[],
  overrides: Partial<Omit<BehaviorContext, "observation">> & { traceShrank?: boolean } = {},
): Finding[] {
  const { traceShrank, ...rest } = overrides;
  return runBehaviorRules({
    observation: observation(events, traceShrank),
    tools: [READ_NOTE],
    calls: CALLS,
    resultStrings: [],
    exfiltrated: [],
    home: HOME,
    mountRoot: "/workspace",
    ...rest,
  });
}

const byRule = (findings: readonly Finding[], name: string) =>
  findings.filter((finding) => finding.ruleId === `behavior/${name}`);

function resultString(toolIndex: number, toolName: string, raw: string): CollectedString {
  return {
    location: { kind: "result", toolIndex, toolName, path: "content[0].text" },
    raw,
    isKey: false,
  };
}

const callLocation = (entry: Call) => ({
  kind: "call",
  toolIndex: entry.toolIndex,
  toolName: entry.toolName,
  callId: entry.callId,
  path: "",
});

describe("BEHAVIOR_RULES", () => {
  it("§3.4 의 여섯 규칙이 그 기본 심각도로 있다", () => {
    expect(BEHAVIOR_RULES.map((rule) => [rule.id, rule.family, rule.defaultSeverity])).toEqual([
      ["behavior/file-canary-read", "behavior", "medium"],
      ["behavior/internal-address", "behavior", "medium"],
      ["behavior/child-process", "behavior", "low"],
      ["behavior/annotation-violation", "behavior", "high"],
      ["behavior/write-outside", "behavior", "medium"],
      ["behavior/observation-tampered", "behavior", "high"],
    ]);
    for (const rule of BEHAVIOR_RULES) expect(rule.summary.length).toBeGreaterThan(0);
  });
});

describe("runBehaviorRules", () => {
  it("behavior/file-canary-read: canary 가 있는 HomeFile 을 연 open 사건이면 한 번이고 위치는 그 호출이다", () => {
    const findings = run([open(phaseOf(TRAVERSAL), "/home/node/.aws/credentials")]);
    expect(findings).toEqual([
      {
        ruleId: "behavior/file-canary-read",
        severity: "medium",
        location: callLocation(TRAVERSAL),
        message: "자격 증명 파일 ~/.aws/credentials 를 열었습니다",
        fix: "이 도구의 기능에 그 파일이 필요한지 확인하세요. 필요 없다면 등록하지 마세요. 실제 머신에서는 진짜 자격 증명이 읽힙니다.",
        evidence: ["~/.aws/credentials", "호출: path:traversal"],
      },
    ]);
  });

  it("behavior/file-canary-read: canary 가 없는 홈 파일(.gitconfig 등)은 걸리지 않는다", () => {
    expect(
      run([
        open(phaseOf(TRAVERSAL), "/home/node/.gitconfig"),
        open(phaseOf(TRAVERSAL), "/home/node/.aws/config"),
        open(phaseOf(TRAVERSAL), "/home/node"),
        // 홈 밖의 같은 꼬리 경로도 미끼가 아니다.
        open(phaseOf(TRAVERSAL), "/workspace/.aws/credentials"),
      ]),
    ).toEqual([]);
  });

  it("behavior/file-canary-read: 같은 호출이 같은 파일을 세 번 열어도 한 건이다", () => {
    const event = open(phaseOf(TRAVERSAL), "/home/node/.aws/credentials");
    const findings = run([event, event, event]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence).toEqual(["~/.aws/credentials", "호출: path:traversal"]);
  });

  it("behavior/file-canary-read: result 가 missing 이면 걸리지 않는다", () => {
    for (const result of ["missing", "denied", "error"] as const)
      expect(run([open(phaseOf(TRAVERSAL), "/home/node/.aws/credentials", false, result)])).toEqual(
        [],
      );
  });

  it.each([
    ["10.0.0.0/8", "10.0.0.0", "9.255.255.255"],
    ["10.0.0.0/8", "10.255.255.255", "11.0.0.0"],
    ["172.16.0.0/12", "172.16.0.0", "172.15.255.255"],
    ["172.16.0.0/12", "172.31.255.255", "172.32.0.0"],
    ["192.168.0.0/16", "192.168.0.0", "192.167.255.255"],
    ["192.168.0.0/16", "192.168.255.255", "192.169.0.0"],
    ["127.0.0.0/8", "127.0.0.0", "126.255.255.255"],
    ["127.0.0.0/8", "127.255.255.255", "128.0.0.0"],
    ["169.254.0.0/16", "169.254.0.0", "169.253.255.255"],
    ["169.254.0.0/16", "169.254.255.255", "169.255.0.0"],
    ["::1", "::1", "::2"],
    ["::1", "0:0:0:0:0:0:0:1", "::"],
    ["fc00::/7", "fc00::", "fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],
    ["fc00::/7", "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "fe00::"],
    ["fe80::/10", "fe80::", "fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],
    ["fe80::/10", "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "fec0::"],
  ])(
    "behavior/internal-address: §3.4 의 내부 주소 표의 각 대역 경계값 안쪽은 걸리고 바깥쪽은 안 걸린다 (%s: %s 안, %s 밖)",
    (_range, inside, outside) => {
      expect(
        byRule(run([connect(phaseOf(PLACEHOLDER), inside, 80)]), "internal-address"),
      ).toHaveLength(1);
      expect(run([connect(phaseOf(PLACEHOLDER), outside, 80)])).toEqual([]);
    },
  );

  it("behavior/internal-address: IPv4 를 담은 IPv6 주소(::ffff:127.0.0.1)는 그 IPv4 로 본다", () => {
    expect(run([connect(phaseOf(PLACEHOLDER), "::ffff:127.0.0.1", 80)])).toHaveLength(1);
    expect(run([connect(phaseOf(PLACEHOLDER), "::ffff:8.8.8.8", 80)])).toEqual([]);
  });

  it("behavior/internal-address: '<gateway>' 접속은 걸리지 않는다", () => {
    expect(
      run([
        connect(phaseOf(PLACEHOLDER), "<gateway>", 443, "inet"),
        connect(phaseOf(PLACEHOLDER), "<gateway>", 8080, "inet"),
        // unix 소켓 경로가 내부 주소처럼 생겨도 주소가 아니다.
        connect(phaseOf(PLACEHOLDER), "127.0.0.1", 0, "unix"),
      ]),
    ).toEqual([]);
  });

  it("behavior/child-process: 호출 단계의 exec 사건이면 한 번이고 message 가 argv 앞 80자다", () => {
    const long = `--exclude=${"x".repeat(100)}`;
    const findings = run([exec(phaseOf(PLACEHOLDER), "/usr/bin/du", ["du", "-sk", long, "/tmp"])]);
    const head = `du -sk ${long} /tmp`.slice(0, 80);
    expect(head).toHaveLength(80);
    expect(findings).toEqual([
      {
        ruleId: "behavior/child-process",
        severity: "low",
        location: callLocation(PLACEHOLDER),
        message: `자식 프로세스를 띄웠습니다: ${head}`,
        fix: "셸이나 다운로드 도구를 띄우는 서버는 명령 주입의 입구입니다. 이 실행이 도구의 기능인지 확인하세요.",
        evidence: [head, "호출: placeholder"],
      },
    ]);
    // PATH 를 훑다 실패한 execve 는 띄운 것이 아니다.
    expect(
      run([exec(phaseOf(PLACEHOLDER), "/usr/local/bin/du", ["du", "-sk", "/tmp"], "error")]),
    ).toEqual([]);
  });

  it("behavior/child-process: start 단계의 런타임 자식(npx 가 띄우는 node)은 filterNoise 뒤에 남지 않는다", () => {
    // 격리 이미지에서 `npx --no-install tsc --version` 을 strace 아래 띄워 떠 온 기록이다.
    const lines = readFileSync(join(SANDBOX, "trace-npx-start.txt"), "utf8").split("\n");
    const parsed = parseTrace(lines, START, "/workspace");
    expect(parsed.unparsed).toBe(0);
    // 채집은 --network none 이라 이름 조회가 Docker Desktop 의 기본 리졸버로 갔다. 실제 실행에서는 --dns 가
    // 게이트웨이라서 백엔드가 그 주소를 "<gateway>" 로 바꿔 넘긴다. 그 치환만 여기서 흉내 낸다.
    const events = parsed.events.map((event) =>
      event.kind === "connect" && event.address === "192.168.65.7"
        ? { ...event, address: "<gateway>" }
        : event,
    );
    const succeeded = events.filter((event) => event.kind === "exec" && event.result === "ok");
    expect(succeeded.length).toBeGreaterThanOrEqual(8);

    const filtered = filterNoise(observation(events), { mountRoot: "/workspace", command: "npx" });
    expect(
      filtered.events.filter((event) => event.kind === "exec" && event.result === "ok"),
    ).toEqual([]);
    expect(run(filtered.events, { tools: [], calls: [] })).toEqual([]);

    // 같은 기록이라도 명령이 node 였다면 그 자식들은 서버가 띄운 것이다.
    const asNode = filterNoise(observation(events), { mountRoot: "/workspace", command: "node" });
    const findings = run(asNode.events, { tools: [], calls: [] });
    expect(byRule(findings, "child-process")).toHaveLength(1);
    expect(findings[0]?.location).toEqual({ kind: "server", path: "" });
  });

  it("behavior/annotation-violation: readOnlyHint 가 true 인 도구의 호출에서 쓰기 open 이면 한 번", () => {
    const entry = call(0, "list_files", "placeholder");
    for (const result of ["ok", "denied"] as const) {
      const findings = run([open(phaseOf(entry), "/home/node/mcpeak-probe", true, result)], {
        tools: [READ_ONLY],
        calls: [entry],
      });
      expect(findings).toEqual([
        {
          ruleId: "behavior/annotation-violation",
          severity: "high",
          location: callLocation(entry),
          message: "readOnlyHint 가 true 인데 호출 중 ~/mcpeak-probe 에 쓰려 했습니다",
          fix: "클라이언트는 이 주석을 믿고 확인 없이 실행합니다. 주석을 false 로 고치거나 등록하지 마세요.",
          evidence: ["~/mcpeak-probe", "호출: placeholder"],
        },
      ]);
    }
    // /tmp 아래 쓰기, 읽기 열기, 없는 디렉터리에 쓰려다 실패한 것은 어기지 않았다.
    expect(
      run(
        [
          open(phaseOf(entry), "/tmp/cache.json", true),
          open(phaseOf(entry), "/home/node/.gitconfig", false),
          open(phaseOf(entry), "/home/node/.npm/_logs/x.log", true, "missing"),
        ],
        { tools: [READ_ONLY], calls: [entry] },
      ),
    ).toEqual([]);
  });

  it("behavior/annotation-violation: readOnlyHint 가 없는 도구는 걸리지 않는다", () => {
    const findings = run([open(phaseOf(PLACEHOLDER), "/home/node/mcpeak-probe", true, "denied")]);
    expect(byRule(findings, "annotation-violation")).toEqual([]);
    // readOnlyHint 가 false 이거나 문자열 "true" 여도 선언이 아니다.
    for (const readOnlyHint of [false, "true"]) {
      const tool: RawTool = { name: "read_note", annotations: { readOnlyHint } };
      expect(
        byRule(
          run([open(phaseOf(PLACEHOLDER), "/home/node/mcpeak-probe", true, "denied")], {
            tools: [tool],
          }),
          "annotation-violation",
        ),
      ).toEqual([]);
    }
  });

  it("behavior/write-outside: /tmp 밖 쓰기 시도는 result 가 denied 여도 걸린다", () => {
    for (const result of ["ok", "denied"] as const) {
      expect(run([open(phaseOf(PLACEHOLDER), "/home/node/mcpeak-probe", true, result)])).toEqual([
        {
          ruleId: "behavior/write-outside",
          severity: "medium",
          location: callLocation(PLACEHOLDER),
          message: "임시 디렉터리 밖 ~/mcpeak-probe 에 쓰려 했습니다",
          fix: "격리 안이라 막혔습니다. 실제 머신에서는 써집니다. 이 경로에 쓰는 것이 도구의 기능인지 확인하세요.",
          evidence: ["~/mcpeak-probe", "호출: placeholder"],
        },
      ]);
    }
    // 홈 밖은 컨테이너 안 절대 경로 그대로 적는다.
    expect(
      run([open(phaseOf(PLACEHOLDER), "/workspace/out.json", true, "denied")])[0]?.message,
    ).toBe("임시 디렉터리 밖 /workspace/out.json 에 쓰려 했습니다");
    // 이름이 /tmp 로 시작할 뿐인 경로는 임시 디렉터리가 아니다.
    expect(run([open(phaseOf(PLACEHOLDER), "/tmpfoo/x", true, "denied")])).toHaveLength(1);
    // missing·error 는 쓰려는 곳이 없었거나 다른 이유로 실패한 것이다.
    for (const result of ["missing", "error"] as const)
      expect(run([open(phaseOf(PLACEHOLDER), "/home/node/x", true, result)])).toEqual([]);
  });

  it("behavior/write-outside: /tmp 아래 쓰기는 걸리지 않는다", () => {
    expect(
      run([
        open(phaseOf(PLACEHOLDER), "/tmp/mcpeak-probe.txt", true),
        open(phaseOf(PLACEHOLDER), "/tmp/a/b/c.txt", true),
        open(phaseOf(PLACEHOLDER), "/home/node/.gitconfig", false),
      ]),
    ).toEqual([]);
  });

  it("behavior/file-canary-read: 그 카나리 값이 같은 도구의 응답 문자열에 있으면 high 이고 문장이 '응답에 나왔습니다' 다", () => {
    const findings = run([open(phaseOf(TRAVERSAL), "/home/node/.aws/credentials")], {
      resultStrings: [resultString(0, "read_note", `secret = ${AWS_CANARY}\n`)],
    });
    expect(findings).toEqual([
      {
        ruleId: "behavior/file-canary-read",
        severity: "high",
        location: callLocation(TRAVERSAL),
        message: "자격 증명 파일 ~/.aws/credentials 를 열었고 그 내용이 호출 응답에 나왔습니다",
        fix: "서버가 자격 증명을 읽어 모델에게 돌려줍니다. 받는 경로를 허용 디렉터리 안으로 좁히지 않았다면 등록하지 마세요.",
        evidence: ["~/.aws/credentials", "호출: path:traversal"],
      },
    ]);
    // 카나리 값은 어디에도 실리지 않는다.
    expect(JSON.stringify(findings)).not.toContain(AWS_CANARY);

    // 다른 도구의 응답에 나온 것, 다른 파일의 카나리가 나온 것은 이 읽기를 high 로 올리지 않는다.
    expect(
      run([open(phaseOf(TRAVERSAL), "/home/node/.aws/credentials")], {
        resultStrings: [
          resultString(1, "other", AWS_CANARY),
          resultString(0, "read_note", SSH_CANARY),
        ],
      })[0]?.severity,
    ).toBe("medium");
  });

  it("behavior/file-canary-read: exfiltrated 에 그 도구와 파일이 있으면 내지 않는다", () => {
    const events = [
      open(phaseOf(TRAVERSAL), "/home/node/.aws/credentials"),
      open(phaseOf(ABSOLUTE), "/home/node/.ssh/id_ed25519"),
    ];
    const findings = run(events, { exfiltrated: [{ toolIndex: 0, name: "~/.aws/credentials" }] });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence).toEqual(["~/.ssh/id_ed25519", "호출: path:absolute"]);
    // 다른 도구의 유출은 이 도구의 읽기를 덮지 않는다.
    expect(
      run(events, { exfiltrated: [{ toolIndex: 1, name: "~/.aws/credentials" }] })[0]?.evidence,
    ).toEqual(["~/.aws/credentials", "호출: path:traversal, path:absolute", "~/.ssh/id_ed25519"]);
  });

  it("behavior/internal-address: 169.254.169.254 는 high, 10.0.0.1 은 medium", () => {
    const metadata = run([connect(phaseOf(PLACEHOLDER), "169.254.169.254", 80)]);
    expect(metadata).toEqual([
      {
        ruleId: "behavior/internal-address",
        severity: "high",
        location: callLocation(PLACEHOLDER),
        message: "내부 주소 169.254.169.254:80 에 접속을 시도했습니다",
        fix: "클라우드 메타데이터나 사내망에 닿으려는 모양입니다. 도구가 받는 주소를 서버가 검증하는지 확인하세요.",
        evidence: ["169.254.169.254:80", "호출: placeholder"],
      },
    ]);
    const internal = run([connect(phaseOf(PLACEHOLDER), "10.0.0.1", 443)]);
    expect(internal[0]?.severity).toBe("medium");
    expect(internal[0]?.message).toBe("내부 주소 10.0.0.1:443 에 접속을 시도했습니다");
    // IPv6 는 포트와 헷갈리지 않게 대괄호로 감싼다.
    expect(run([connect(phaseOf(PLACEHOLDER), "::1", 8080)])[0]?.message).toBe(
      "내부 주소 [::1]:8080 에 접속을 시도했습니다",
    );
  });

  it("behavior/internal-address: 같은 도구의 두 주소가 한 건으로 접히고 evidence 에 둘 다 있다", () => {
    const findings = run([
      connect(phaseOf(TRAVERSAL), "169.254.169.254", 80),
      connect(phaseOf(ABSOLUTE), "10.0.0.1", 443),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("high");
    expect(findings[0]?.evidence).toEqual([
      "10.0.0.1:443",
      "호출: path:traversal, path:absolute",
      "169.254.169.254:80",
    ]);
    // 문장은 가장 심각한 대상을 말한다.
    expect(findings[0]?.message).toBe("내부 주소 169.254.169.254:80 에 접속을 시도했습니다");
  });

  it("behavior/child-process: separator 호출에서 id 가 실행되면 high, sh 는 medium, du 는 low", () => {
    const separator = call(0, "run", "command:separator");
    const option = call(0, "run", "command:option");
    const context = { tools: [{ name: "run" }], calls: [separator, option] };
    const severityOf = (events: readonly SyscallEvent[]): Severity | undefined =>
      run(events, context)[0]?.severity;

    expect(severityOf([exec(phaseOf(separator), "/usr/bin/id", ["id"])])).toBe("high");
    expect(severityOf([exec(phaseOf(separator), "/bin/sh", ["sh", "-c", "mcpeak; id"])])).toBe(
      "medium",
    );
    expect(severityOf([exec(phaseOf(separator), "/usr/bin/du", ["du", "-sk", "/tmp"])])).toBe(
      "low",
    );
    // id 가 high 인 것은 우리가 넣은 둘째 명령이기 때문이다. 다른 호출에서는 평범한 실행이다.
    expect(severityOf([exec(phaseOf(option), "/usr/bin/id", ["id"])])).toBe("low");
    // 셸과 id 가 함께 나면 한 건으로 접히고 가장 심각한 쪽을 말한다.
    const both = run(
      [
        exec(phaseOf(separator), "/bin/sh", ["sh", "-c", "mcpeak; id"]),
        exec(phaseOf(separator), "/usr/bin/id", ["id"]),
      ],
      context,
    );
    expect(both).toHaveLength(1);
    expect(both[0]?.severity).toBe("high");
    expect(both[0]?.message).toBe("자식 프로세스를 띄웠습니다: id");
    expect(both[0]?.evidence).toEqual(["id", "호출: command:separator", "sh -c mcpeak; id"]);
  });

  it.each([
    "sh",
    "bash",
    "dash",
    "zsh",
    "curl",
    "wget",
    "nc",
    "ncat",
    "python",
    "python3",
    "perl",
    "ruby",
    "npm",
    "npx",
    "pnpm",
    "yarn",
    "pip",
    "pip3",
    "apt",
    "apt-get",
    "ssh",
    "scp",
    "git",
  ])("behavior/child-process: 실행기 표의 '%s' 는 medium 이다", (name) => {
    expect(run([exec(phaseOf(PLACEHOLDER), `/usr/bin/${name}`, [name])])[0]?.severity).toBe(
      "medium",
    );
  });

  it.each(["du", "node", "cat", "shx", "gitk", "python2"])(
    "behavior/child-process: 실행기 표에 없는 '%s' 는 low 다",
    (name) => {
      expect(run([exec(phaseOf(PLACEHOLDER), `/usr/bin/${name}`, [name])])[0]?.severity).toBe(
        "low",
      );
    },
  );

  it("behavior/annotation-violation: readOnlyHint 가 true 인 도구가 exec 하면 '실행' 문장으로 한 번이고 child-process 도 함께 난다", () => {
    const entry = call(0, "list_files", "placeholder");
    const findings = run([exec(phaseOf(entry), "/usr/bin/du", ["du", "-sk", "/tmp"])], {
      tools: [READ_ONLY],
      calls: [entry],
    });
    expect(findings.map((finding) => [finding.ruleId, finding.severity, finding.message])).toEqual([
      [
        "behavior/annotation-violation",
        "high",
        "readOnlyHint 가 true 인데 호출 중 프로세스를 띄웠습니다: du -sk /tmp",
      ],
      ["behavior/child-process", "low", "자식 프로세스를 띄웠습니다: du -sk /tmp"],
    ]);
    expect(findings[0]?.evidence).toEqual(["du -sk /tmp", "호출: placeholder"]);
  });

  it("behavior/write-outside: 그 도구에 annotation-violation 이 났으면 내지 않는다", () => {
    const entry = call(0, "list_files", "placeholder");
    const other = call(1, "read_note", "placeholder");
    const findings = run(
      [
        open(phaseOf(entry), "/home/node/a", true, "denied"),
        open(phaseOf(other), "/home/node/b", true, "denied"),
      ],
      { tools: [READ_ONLY, READ_NOTE], calls: [entry, other] },
    );
    expect(
      findings.map((finding) => [
        finding.ruleId,
        finding.location.kind === "call" ? finding.location.toolName : "",
      ]),
    ).toEqual([
      ["behavior/annotation-violation", "list_files"],
      ["behavior/write-outside", "read_note"],
    ]);
  });

  it("behavior/observation-tampered: /var/mcpeak 아래 쓰기 열기가 있으면 한 번, traceShrank 가 true 여도 한 번", () => {
    const written = run([open(phaseOf(PLACEHOLDER), "/var/mcpeak/trace", true)]);
    expect(written).toEqual([
      {
        ruleId: "behavior/observation-tampered",
        severity: "high",
        location: callLocation(PLACEHOLDER),
        message: "서버가 점검 기록(/var/mcpeak)을 건드렸습니다",
        fix: "점검을 알아채고 흔적을 지우려는 행동입니다. 이 실행의 다른 관측은 믿을 수 없습니다. 등록하지 마세요.",
        evidence: ["/var/mcpeak/trace", "호출: placeholder"],
      },
    ]);

    const shrank = run([], { traceShrank: true });
    expect(shrank).toHaveLength(1);
    expect(shrank[0]).toMatchObject({
      ruleId: "behavior/observation-tampered",
      severity: "high",
      location: { kind: "server", path: "" },
      message: "서버가 점검 기록(/var/mcpeak)을 건드렸습니다",
      evidence: ["/var/mcpeak/trace", "시스템 콜 기록의 줄 수가 줄었습니다"],
    });

    // 쓰기 열기가 이미 그 사실을 말하면 줄 수 감소로 한 건을 더 내지 않는다.
    expect(
      run([open(phaseOf(PLACEHOLDER), "/var/mcpeak/trace", true)], { traceShrank: true }),
    ).toHaveLength(1);

    // 읽기 열기는 건드린 것이 아니다. 기록을 지우거나 옮기는 것은 건드린 것이다.
    expect(run([open(phaseOf(PLACEHOLDER), "/var/mcpeak/trace", false)])).toEqual([]);
    const removed = run([alter(phaseOf(PLACEHOLDER), "/var/mcpeak/trace", "unlink", "ok")]);
    expect(removed.map((finding) => finding.ruleId)).toEqual(["behavior/observation-tampered"]);
  });

  it("접힌 발견의 위치는 계획 순서로 첫 호출이고 심각도는 최댓값이다", () => {
    // 사건은 뒤 호출 것이 먼저 온다. 위치는 사건 순서가 아니라 계획(calls) 순서를 따른다.
    const findings = run(
      [
        open(phaseOf(ABSOLUTE), "/home/node/.ssh/id_ed25519"),
        open(phaseOf(TRAVERSAL), "/home/node/.aws/credentials"),
      ],
      { resultStrings: [resultString(0, "read_note", SSH_CANARY)] },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.location).toEqual(callLocation(TRAVERSAL));
    expect(findings[0]?.severity).toBe("high");
    expect(findings[0]?.evidence).toEqual([
      "~/.aws/credentials",
      "호출: path:traversal, path:absolute",
      "~/.ssh/id_ed25519",
    ]);
    // 대상이 셋을 넘으면 셋까지 싣고 나머지는 수로 닫는다.
    const many = run(
      ["e", "d", "c", "b", "a"].map((name) =>
        open(phaseOf(PLACEHOLDER), `/home/node/out/${name}`, true, "denied"),
      ),
    );
    expect(many).toHaveLength(1);
    expect(many[0]?.evidence).toEqual([
      "~/out/a",
      "호출: placeholder",
      "~/out/b",
      "~/out/c",
      "외 2개",
    ]);
  });

  it("behavior/file-canary-read: 카나리 값이 응답에 base64 로 실려도 high 다", () => {
    const encoded = Buffer.from(`key=${AWS_CANARY};`, "utf8").toString("base64");
    expect(encoded).not.toContain(AWS_CANARY);
    for (const raw of [
      encoded,
      Buffer.from(AWS_CANARY, "utf8").toString("hex"),
      AWS_CANARY.toUpperCase(),
    ]) {
      const findings = run([open(phaseOf(TRAVERSAL), "/home/node/.aws/credentials")], {
        resultStrings: [resultString(0, "read_note", raw)],
      });
      expect(findings[0]?.severity).toBe("high");
    }
  });

  it("behavior/annotation-violation: readOnlyHint 가 true 인 도구가 /tmp 밖 파일을 지우면 '삭제·이동' 문장으로 한 번", () => {
    const entry = call(0, "list_files", "placeholder");
    const context = { tools: [READ_ONLY], calls: [entry] };
    const removed = run([alter(phaseOf(entry), "/home/node/.gitconfig", "unlink")], context);
    expect(removed).toEqual([
      {
        ruleId: "behavior/annotation-violation",
        severity: "high",
        location: callLocation(entry),
        message: "readOnlyHint 가 true 인데 호출 중 ~/.gitconfig 를 지우려 했습니다",
        fix: "클라이언트는 이 주석을 믿고 확인 없이 실행합니다. 주석을 false 로 고치거나 등록하지 마세요.",
        evidence: ["~/.gitconfig", "호출: placeholder"],
      },
    ]);
    expect(run([alter(phaseOf(entry), "/home/node/.ssh", "rmdir")], context)[0]?.message).toBe(
      "readOnlyHint 가 true 인데 호출 중 ~/.ssh 를 지우려 했습니다",
    );
    expect(
      run([alter(phaseOf(entry), "/home/node/.gitconfig", "rename-from")], context)[0]?.message,
    ).toBe("readOnlyHint 가 true 인데 호출 중 ~/.gitconfig 를 옮기려 했습니다");
    // /tmp 아래에서 지우고 옮기는 것은 어기지 않았다.
    expect(
      run(
        [
          alter(phaseOf(entry), "/tmp/a.txt", "unlink", "ok"),
          alter(phaseOf(entry), "/tmp/a.txt", "rename-from", "ok"),
          alter(phaseOf(entry), "/tmp/b.txt", "rename-to", "ok"),
        ],
        context,
      ),
    ).toEqual([]);
  });

  it("behavior/annotation-violation: destructiveHint 가 false 인 도구가 /tmp 밖 파일을 옮기면 한 번, destructiveHint 가 없으면 0", () => {
    const entry = call(0, "tidy", "placeholder");
    const events = [
      alter(phaseOf(entry), "/home/node/.gitconfig", "rename-from"),
      alter(phaseOf(entry), "/home/node/.gitconfig.bak", "rename-to"),
    ];
    const findings = run(events, { tools: [NON_DESTRUCTIVE], calls: [entry] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: "behavior/annotation-violation",
      severity: "high",
      message: "destructiveHint 가 false 인데 호출 중 ~/.gitconfig 를 옮기려 했습니다",
      evidence: ["~/.gitconfig", "호출: placeholder", "~/.gitconfig.bak"],
    });
    expect(
      run([alter(phaseOf(entry), "/home/node/.gitconfig", "unlink")], {
        tools: [NON_DESTRUCTIVE],
        calls: [entry],
      })[0]?.message,
    ).toBe("destructiveHint 가 false 인데 호출 중 ~/.gitconfig 를 지우려 했습니다");

    // destructiveHint 가 없거나 true 면 주석을 어긴 것이 아니다. write-outside 만 남는다.
    for (const annotations of [undefined, {}, { destructiveHint: true }]) {
      const plain = run(events, { tools: [{ name: "tidy", annotations }], calls: [entry] });
      expect(byRule(plain, "annotation-violation")).toEqual([]);
      expect(byRule(plain, "write-outside")).toHaveLength(1);
    }
    // destructiveHint 가 false 인 것은 지우기·옮기기에만 걸린다. 쓰기 열기와 실행은 이 주석이 말하지 않는다.
    const writes = run(
      [
        open(phaseOf(entry), "/home/node/x", true, "denied"),
        exec(phaseOf(entry), "/usr/bin/du", ["du"]),
      ],
      { tools: [NON_DESTRUCTIVE], calls: [entry] },
    );
    expect(byRule(writes, "annotation-violation")).toEqual([]);
  });

  it("behavior/write-outside: 주석 없는 도구의 /tmp 밖 unlink 는 result 가 denied 여도 걸리고 문장이 '지우려' 다", () => {
    for (const result of ["ok", "denied"] as const) {
      const findings = run([
        alter(phaseOf(PLACEHOLDER), "/home/node/.gitconfig", "unlink", result),
      ]);
      expect(findings).toEqual([
        {
          ruleId: "behavior/write-outside",
          severity: "medium",
          location: callLocation(PLACEHOLDER),
          message: "임시 디렉터리 밖 ~/.gitconfig 를 지우려 했습니다",
          fix: "격리 안이라 막혔습니다. 실제 머신에서는 써집니다. 이 경로에 쓰는 것이 도구의 기능인지 확인하세요.",
          evidence: ["~/.gitconfig", "호출: placeholder"],
        },
      ]);
    }
    expect(run([alter(phaseOf(PLACEHOLDER), "/etc/hostname", "rmdir")])[0]?.message).toBe(
      "임시 디렉터리 밖 /etc/hostname 를 지우려 했습니다",
    );
    expect(
      run([alter(phaseOf(PLACEHOLDER), "/home/node/.gitconfig", "rename-from")])[0]?.message,
    ).toBe("임시 디렉터리 밖 ~/.gitconfig 를 옮기려 했습니다");
    // 없는 파일을 지우려 한 것은 걸리지 않는다.
    expect(run([alter(phaseOf(PLACEHOLDER), "/home/node/nope", "unlink", "missing")])).toEqual([]);
  });

  it("behavior/write-outside: /tmp 아래 unlink 와 rename 은 걸리지 않는다", () => {
    expect(
      run([
        alter(phaseOf(PLACEHOLDER), "/tmp/b.txt", "unlink", "ok"),
        alter(phaseOf(PLACEHOLDER), "/tmp/d", "rmdir", "ok"),
        alter(phaseOf(PLACEHOLDER), "/tmp/a.txt", "rename-from", "ok"),
        alter(phaseOf(PLACEHOLDER), "/tmp/b.txt", "rename-to", "ok"),
      ]),
    ).toEqual([]);
  });

  it("호출이 아닌 단계의 사건은 위치가 server 이고 evidence 둘째 칸이 단계 이름이다", () => {
    const names: ReadonlyArray<readonly [SandboxPhase, string]> = [
      [START, "단계: 시작"],
      [LIST, "단계: 목록"],
      [SHUTDOWN, "단계: 종료"],
    ];
    for (const [phase, label] of names) {
      const findings = run([connect(phase, "10.0.0.1", 443)]);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.location).toEqual({ kind: "server", path: "" });
      expect(findings[0]?.evidence).toEqual(["10.0.0.1:443", label]);
    }
    // 여러 단계에 걸치면 한 건으로 접히고 단계를 시작·목록·종료 순으로 적는다.
    const folded = run([
      open(SHUTDOWN, "/home/node/.aws/credentials"),
      open(START, "/home/node/.aws/credentials"),
    ]);
    expect(folded).toHaveLength(1);
    expect(folded[0]?.evidence).toEqual(["~/.aws/credentials", "단계: 시작, 종료"]);
    // 서버 단계의 관측과 호출의 관측은 따로 선다.
    const split = run([
      open(START, "/home/node/.aws/credentials"),
      open(phaseOf(TRAVERSAL), "/home/node/.aws/credentials"),
    ]);
    expect(split.map((finding) => finding.location.kind)).toEqual(["server", "call"]);
    // 서버 단계에는 도구가 없어 주석 위반이 없다. /tmp 밖 쓰기는 그대로 걸린다.
    expect(run([open(START, "/home/node/x", true, "denied")])[0]?.ruleId).toBe(
      "behavior/write-outside",
    );
  });

  it("입력 순서를 섞어도 결과가 같다", () => {
    const second = call(1, "list_files", "placeholder");
    const events = [
      open(START, "/home/node/.ssh/id_ed25519"),
      open(phaseOf(TRAVERSAL), "/home/node/.aws/credentials"),
      open(phaseOf(ABSOLUTE), "/home/node/.ssh/id_ed25519"),
      connect(phaseOf(PLACEHOLDER), "169.254.169.254", 80),
      connect(phaseOf(ABSOLUTE), "127.0.0.1", 8080),
      exec(phaseOf(PLACEHOLDER), "/bin/sh", ["sh", "-c", "du"]),
      exec(phaseOf(PLACEHOLDER), "/usr/bin/du", ["du"]),
      open(phaseOf(PLACEHOLDER), "/home/node/b", true, "denied"),
      open(phaseOf(PLACEHOLDER), "/home/node/a", true, "denied"),
      alter(phaseOf(second), "/home/node/.gitconfig", "unlink"),
      exec(phaseOf(second), "/usr/bin/id", ["id"]),
      open(phaseOf(second), "/var/mcpeak/trace", true),
      open(SHUTDOWN, "/etc/x", true, "denied"),
    ];
    const context = {
      tools: [READ_NOTE, READ_ONLY],
      calls: [...CALLS, second],
      resultStrings: [resultString(0, "read_note", AWS_CANARY)],
    };
    const baseline = JSON.stringify(run(events, context));
    expect(JSON.parse(baseline)).not.toHaveLength(0);
    const rotations = [
      [...events].reverse(),
      [...events.slice(5), ...events.slice(0, 5)],
      [...events].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
    ];
    for (const shuffled of rotations) expect(JSON.stringify(run(shuffled, context))).toBe(baseline);
    // 응답 문자열과 유출 목록의 순서도 결과를 바꾸지 않는다.
    expect(
      JSON.stringify(
        run(events, {
          ...context,
          resultStrings: [
            resultString(1, "list_files", "x"),
            resultString(0, "read_note", AWS_CANARY),
          ],
        }),
      ),
    ).toBe(baseline);
  });

  it("benign-node-startup.json 에서 발견이 0", () => {
    const fixture = loadFixture("benign-node-startup.json");
    // 굳힌 관측은 걸러지기 전의 것이다. 서버 명령 자체의 exec 가 들어 있어 표가 없으면 발견이 난다.
    expect(fixture.observation.events.length).toBeGreaterThan(100);
    expect(byRule(runFixture(fixture, false), "child-process")).toHaveLength(1);
    expect(runFixture(fixture, true)).toEqual([]);
    // 굳힌 관측은 떠 온 원문을 해석한 것과 같다.
    const lines = readFileSync(join(SANDBOX, "trace-weather-start.txt"), "utf8").split("\n");
    expect(fixture.observation.events).toEqual(parseTrace(lines, START, "/workspace").events);
  });
});

/** §8.1 의 픽스처 꼴에서 behavior 가족이 쓰는 키. */
interface BehaviorFixture {
  readonly observation: Observation;
  readonly tools: RawTool[];
  readonly calls: Call[];
  readonly home: HomePlan;
  readonly resultStrings?: CollectedString[];
  readonly exfiltrated?: { toolIndex: number; name: string }[];
  readonly mountRoot: string;
  /** filterNoise 에 넘기는 서버 명령. */
  readonly command: string;
  readonly expect: { readonly ruleId?: string; readonly count: number };
}

function loadFixture(name: string): BehaviorFixture {
  return JSON.parse(readFileSync(join(SANDBOX, name), "utf8")) as BehaviorFixture;
}

function runFixture(fixture: BehaviorFixture, filter: boolean): Finding[] {
  const context = { mountRoot: fixture.mountRoot, command: fixture.command };
  return runBehaviorRules({
    observation: filter ? filterNoise(fixture.observation, context) : fixture.observation,
    tools: fixture.tools,
    calls: fixture.calls,
    resultStrings: fixture.resultStrings ?? [],
    exfiltrated: fixture.exfiltrated ?? [],
    home: fixture.home,
    mountRoot: fixture.mountRoot,
  });
}

describe("fixtures/sandbox/behavior-*.json", () => {
  const names = readdirSync(SANDBOX)
    .filter((name) => /^behavior-.*\.json$/.test(name))
    .sort();

  it("규칙 여섯과 잡음 표의 행마다 걸리는 픽스처와 반례가 하나씩 있다", () => {
    const rows = [
      ...BEHAVIOR_RULES.map((rule) => rule.id.replace("behavior/", "")),
      ...NOISE_TABLE.map((row) => `noise-${row.name}`),
    ];
    expect(NOISE_TABLE.map((row) => row.name)).toEqual([
      "first-exec",
      "package-runner",
      "package-bin",
      "bin-shim-helper",
      "npm-cache",
      "dev-null",
      "unix-socket",
      "embedded-resolver",
      "gateway",
    ]);
    // 표의 항목마다 왜 잡음인지와 채집한 기록의 어디에서 보았는지가 적혀 있다. 게이트웨이 행만 예외다.
    // 게이트웨이가 아직 없어 떠 올 수 없었고, 그 사정을 근거에 적었다.
    for (const row of NOISE_TABLE) {
      if (row.name === "gateway") expect(row.reason).toContain("채집한 기록에는 이 접속이 없다");
      else expect(row.reason).toMatch(/trace-[a-z0-9-]+\.txt/);
    }
    for (const row of rows) {
      expect(names).toContain(`behavior-${row}.json`);
      expect(names).toContain(`behavior-${row}.counter.json`);
    }
  });

  it.each(names)("%s: 기대한 규칙만 기대한 수로 걸린다", (name) => {
    const fixture = loadFixture(name);
    const findings = runFixture(fixture, true);
    const expected = findings.filter((finding) => finding.ruleId === fixture.expect.ruleId);
    const others = findings.filter((finding) => finding.ruleId !== fixture.expect.ruleId);
    expect(expected).toHaveLength(fixture.expect.count);
    // 그 파일에서 같은 가족의 다른 규칙은 걸리지 않는다.
    expect(others).toEqual([]);
  });
});

describe("filterNoise", () => {
  const context = { mountRoot: "/workspace", command: "node" };
  const kept = (events: readonly SyscallEvent[], command = "node") =>
    filterNoise(observation(events), { ...context, command }).events;

  it("start 단계의 첫 exec: 서버 명령 자체만 빠지고 그 뒤의 exec 는 남는다", () => {
    const server = exec(START, "/usr/local/bin/node", ["node", "server.mjs"]);
    const child = exec(START, "/usr/bin/curl", ["curl", "https://example.invalid/"]);
    expect(kept([server, child])).toEqual([child]);
    // 같은 node 를 한 번 더 띄운 것은 서버가 한 일이다.
    expect(kept([server, server])).toEqual([server]);
    // 호출 단계의 exec 는 첫 줄이어도 남는다.
    const inCall = exec(phaseOf(PLACEHOLDER), "/usr/local/bin/node", ["node", "x.mjs"]);
    expect(kept([inCall])).toEqual([inCall]);
  });

  it("패키지 실행기: 명령이 npx·npm 일 때만 start 단계의 node·sh·npm·npx 와 bin 실행이 빠진다", () => {
    const events = [
      exec(START, "/usr/local/bin/npx", ["npx", "pkg"]),
      exec(START, "/usr/local/bin/node", ["node", "/usr/local/bin/npx", "pkg"]),
      exec(START, "/usr/bin/sh", ["sh", "-c", "pkg"]),
      exec(START, "/workspace/node_modules/.bin/pkg", ["pkg"]),
      exec(START, "/usr/bin/sed", ["sed", "-e", "s,\\\\,/,g"]),
      exec(START, "/usr/bin/dirname", ["dirname", "/workspace/node_modules/.bin/pkg"]),
      exec(START, "/usr/bin/uname", ["uname"]),
      exec(START, "/usr/local/bin/npm", ["npm", "exec"]),
    ];
    for (const command of ["npx", "npm", "/usr/local/bin/npx"])
      expect(kept(events, command)).toEqual([]);
    // 실행기 과정이 아닌 것은 npx 여도 남는다.
    const curl = exec(START, "/usr/bin/curl", ["curl", "https://example.invalid/"]);
    const git = exec(START, "/usr/bin/git", ["git", "config", "--list"]);
    expect(kept([...events, curl, git], "npx")).toEqual([curl, git]);
    // 호출 단계에서 띄운 sh 는 npx 여도 남는다.
    const inCall = exec(phaseOf(PLACEHOLDER), "/usr/bin/sh", ["sh", "-c", "id"]);
    expect(kept([...events, inCall], "npx")).toEqual([inCall]);
    // 명령이 node 면 첫 exec 만 빠진다.
    expect(kept(events, "node")).toEqual(events.slice(1));
  });

  it("npm 캐시: 명령이 npx·npm 일 때만 start 단계의 /home/node/.npm/ 아래 쓰기 열기와 지우기·옮기기가 빠진다", () => {
    const CACHE = "/home/node/.npm/_cacache/tmp/4853c97a";
    const events = [
      open(START, "/home/node/.npm/_logs/debug-0.log", true),
      open(START, "/home/node/.npm/_npx/a705c79b42eea4c8/package.json", true, "denied"),
      alter(START, CACHE, "unlink", "ok"),
      alter(START, CACHE, "rename-from", "ok"),
      alter(START, "/home/node/.npm/_cacache/index-v5/c3/24/4e84", "rename-to", "ok"),
    ];
    for (const command of ["npx", "npm", "/usr/local/bin/npx"])
      expect(kept(events, command)).toEqual([]);
    // 명령이 node 면 그 자리의 쓰기는 서버가 한 일이다.
    expect(kept(events, "node")).toEqual(events);
    expect(byRule(run(kept(events, "node")), "write-outside")).toHaveLength(1);

    // 호출 단계에서 같은 자리에 쓰거나 지우는 것은 npx 여도 남는다.
    const inCall = [
      open(phaseOf(PLACEHOLDER), "/home/node/.npm/_npx/a705c79b42eea4c8/payload", true),
      alter(phaseOf(PLACEHOLDER), CACHE, "unlink", "ok"),
    ];
    expect(kept([...events, ...inCall], "npx")).toEqual(inCall);
    expect(byRule(run(kept([...events, ...inCall], "npx")), "write-outside")).toHaveLength(1);
    // list·shutdown 단계도 실행기가 캐시를 채우는 때가 아니다.
    const later = [open(LIST, CACHE, true), alter(SHUTDOWN, CACHE, "unlink", "ok")];
    expect(kept(later, "npx")).toEqual(later);

    // 접두는 `/home/node/.npm/` 까지다. 홈의 다른 자리와 이름만 비슷한 자리는 남는다.
    const outside = [
      open(START, "/home/node/.npmrc", true),
      open(START, "/home/node/.npm-evil/x", true),
      open(START, "/home/node/.ssh/authorized_keys", true),
      open(START, "/home/node/.npm", true),
      alter(START, "/home/node/.gitconfig", "unlink"),
      open(START, "/work/.npm/x", true),
    ];
    expect(kept(outside, "npx")).toEqual(outside);
    // 읽기 전용 열기는 표가 다루지 않는다. 그대로 남고 어느 규칙에도 닿지 않는다.
    const read = open(START, "/home/node/.npm/_cacache/index-v5/c3/24/4e84", false);
    expect(kept([read], "npx")).toEqual([read]);
  });

  it("npm 캐시: 레지스트리에서 받아 띄운 실제 기록에서 start 단계에 남는 쓰기·실행이 없다", () => {
    // 격리 이미지에 ADR-0109 의 tmpfs 를 얹고 `npx -y @modelcontextprotocol/server-everything@2026.8.31` 을
    // strace 아래 띄워 떠 온 기록이다(채집 명령과 줄인 방법은 docs/reports/2026-10-04-sandbox-N1.md).
    const lines = readFileSync(join(SANDBOX, "trace-npx-registry-start.txt"), "utf8").split("\n");
    const parsed = parseTrace(lines, START, "/workspace");
    expect(parsed.unparsed).toBe(0);
    const isCacheWrite = (event: SyscallEvent) =>
      ((event.kind === "open" && event.write) || event.kind === "alter") &&
      event.path.startsWith("/home/node/.npm/");
    const cacheWrites = parsed.events.filter(isCacheWrite);
    expect(cacheWrites.some((event) => event.kind === "open")).toBe(true);
    expect(cacheWrites.some((event) => event.kind === "alter" && event.via === "unlink")).toBe(
      true,
    );
    expect(cacheWrites.some((event) => event.kind === "alter" && event.via === "rename-to")).toBe(
      true,
    );
    // 받은 패키지의 bin 은 캐시 안에서 실행된다. 그래서 그 자리가 exec 여야 한다.
    expect(parsed.events).toContainEqual(
      exec(START, "/home/node/.npm/_npx/a705c79b42eea4c8/node_modules/.bin/mcp-server-everything", [
        "mcp-server-everything",
      ]),
    );

    // 채집은 게이트웨이 없이 했다. 접속은 이 표의 다른 행과 network 규칙의 몫이라 여기서는 보지 않는다.
    const local = parsed.events.filter((event) => event.kind !== "connect");
    const filtered = kept(local, "npx");
    expect(filtered.filter(isCacheWrite)).toEqual([]);
    expect(filtered.filter((event) => event.kind === "exec" && event.result === "ok")).toEqual([]);
    expect(run(filtered, { tools: [], calls: [] })).toEqual([]);

    // 같은 기록이라도 명령이 node 였다면 그 쓰기는 서버가 한 것이다.
    const asNode = kept(local, "node");
    expect(asNode.filter(isCacheWrite)).toEqual(cacheWrites);
    expect(byRule(run(asNode, { tools: [], calls: [] }), "write-outside")).toHaveLength(1);
  });

  it("/dev/null: 쓰기 열기 중 /dev/null 만 빠진다", () => {
    const sink = open(phaseOf(PLACEHOLDER), "/dev/null", true);
    const shm = open(phaseOf(PLACEHOLDER), "/dev/shm/x", true);
    const tty = open(phaseOf(PLACEHOLDER), "/dev/tty", true);
    const proc = open(phaseOf(PLACEHOLDER), "/proc/self/oom_score_adj", true);
    const read = open(phaseOf(PLACEHOLDER), "/dev/null", false);
    expect(kept([sink, shm, tty, proc, read])).toEqual([shm, tty, proc, read]);
  });

  it("unix 소켓: family 가 unix 인 connect 만 빠진다", () => {
    const nscd = connect(START, "/var/run/nscd/socket", 0, "unix");
    const inet = connect(START, "10.0.0.1", 443);
    expect(kept([nscd, inet])).toEqual([inet]);
  });

  it("내장 리졸버: 127.0.0.11 의 53번만 빠지고 같은 주소의 다른 포트와 다른 루프백 주소는 남는다", () => {
    // 격리 이미지를 --internal 네트워크에 붙여 이름 조회를 한 번 시킨 기록이다.
    const lines = readFileSync(join(SANDBOX, "trace-embedded-dns.txt"), "utf8").split("\n");
    const parsed = parseTrace(lines, phaseOf(PLACEHOLDER), "/");
    expect(parsed.unparsed).toBe(0);
    const resolver = connect(phaseOf(PLACEHOLDER), "127.0.0.11", 53);
    expect(parsed.events).toContainEqual(resolver);
    expect(kept(parsed.events).filter((event) => event.kind === "connect")).toEqual([]);
    // 표가 없으면 이름을 한 번 묻는 것만으로 내부 주소 발견이 난다.
    expect(byRule(run([resolver]), "internal-address")).toHaveLength(1);
    expect(run(kept([resolver]))).toEqual([]);

    const otherPort = connect(phaseOf(PLACEHOLDER), "127.0.0.11", 8080);
    const loopback = connect(phaseOf(PLACEHOLDER), "127.0.0.1", 53);
    expect(kept([resolver, otherPort, loopback])).toEqual([otherPort, loopback]);
  });

  it("게이트웨이: '<gateway>' 의 53·80·443 만 빠지고 다른 포트와 다른 주소는 남는다", () => {
    const dns = connect(START, "<gateway>", 53, "inet");
    const http = connect(START, "<gateway>", 80, "inet");
    const https = connect(START, "<gateway>", 443, "inet");
    const other = connect(START, "<gateway>", 8080, "inet");
    const direct = connect(START, "8.8.8.8", 443);
    expect(kept([dns, http, https, other, direct])).toEqual([other, direct]);
  });

  it("사건 밖의 관측(요청·TLS 거부·이름 조회·gaps·traceShrank)은 그대로 넘긴다", () => {
    const input: Observation = {
      events: [connect(START, "/var/run/nscd/socket", 0, "unix")],
      requests: [
        {
          phase: START,
          scheme: "https",
          host: "example.invalid",
          port: 443,
          method: "GET",
          path: "/",
          headers: [],
          bodyBase64: "",
          bodyTruncated: false,
          served: "live",
        },
      ],
      tlsRejections: [{ phase: START, host: "pinned.invalid" }],
      dnsNames: [{ phase: START, name: "example.invalid" }],
      traceShrank: true,
      gaps: [{ source: "gateway", reason: "응답 없음" }],
    };
    const output = filterNoise(input, context);
    expect(output).toEqual({ ...input, events: [] });
    // 입력을 고치지 않는다.
    expect(input.events).toHaveLength(1);
  });
});
