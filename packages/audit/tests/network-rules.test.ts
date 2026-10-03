import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  exfiltratedCanaries,
  NETWORK_RULES,
  type NetworkContext,
  runNetworkRules,
} from "../src/rules/network.js";
import type {
  CanaryValue,
  Finding,
  Observation,
  ObservedRequest,
  SandboxPhase,
  SyscallEvent,
} from "../src/types.js";

const SANDBOX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sandbox");

/** §8.1 의 픽스처 꼴 중 network 가 쓰는 부분. `also` 는 그 파일에서 함께 나도 되는 규칙이다. */
interface NetworkFixture extends NetworkContext {
  readonly expect: { readonly ruleId: string; readonly count: number; readonly also?: string[] };
}

function loadFixture(file: string): NetworkFixture {
  return JSON.parse(readFileSync(join(SANDBOX, file), "utf8")) as NetworkFixture;
}

const ENV_CANARY: CanaryValue = {
  origin: "env",
  name: "GITHUB_TOKEN",
  value: "MCPEAK_CANARY_00000000deadbeef",
};
const FILE_CANARY: CanaryValue = {
  origin: "file",
  name: "~/.cursor/mcp.json",
  value: "0123456789abcdef0123456789abcdef",
};

const START: SandboxPhase = { kind: "start" };
const call = (toolIndex: number, toolName: string, callId = "placeholder"): SandboxPhase => ({
  kind: "call",
  toolIndex,
  toolName,
  callId,
});
const SYNC = call(3, "sync_settings");

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");
/** DNS 레이블은 63자까지라 hex 로 바꾼 값을 두 레이블로 나눠 싣는다. */
const splitHex = (text: string) => `${hex(text).slice(0, 30)}.${hex(text).slice(30)}`;

function request(over: Partial<ObservedRequest> = {}): ObservedRequest {
  return {
    phase: SYNC,
    scheme: "https",
    host: "collect.example.net",
    port: 443,
    method: "POST",
    path: "/v1",
    headers: [["accept", "*/*"]],
    bodyBase64: "",
    bodyTruncated: false,
    served: "live",
    ...over,
  };
}

function connect(
  address: string,
  port: number,
  family: "inet" | "inet6" = "inet",
  phase: SandboxPhase = SYNC,
): SyscallEvent {
  return { kind: "connect", phase, family, address, port };
}

function observation(over: Partial<Observation> = {}): Observation {
  return {
    events: [],
    requests: [],
    tlsRejections: [],
    dnsNames: [],
    traceShrank: false,
    gaps: [],
    ...over,
  };
}

function context(over: Partial<Observation>, rest: Partial<NetworkContext> = {}): NetworkContext {
  return {
    observation: observation(over),
    declaredHosts: ["registry.npmjs.org"],
    canaries: [ENV_CANARY, FILE_CANARY],
    mode: "live",
    ...rest,
  };
}

const of = (findings: readonly Finding[], ruleId: string) =>
  findings.filter((finding) => finding.ruleId === ruleId);

const SYNC_LOCATION = {
  kind: "call",
  toolIndex: 3,
  toolName: "sync_settings",
  callId: "placeholder",
  path: "",
};
const EXFILTRATION_FIX = "서버가 자격 증명을 밖으로 보냅니다. 등록하지 마세요.";

describe("runNetworkRules", () => {
  it("network/canary-exfiltration: env 카나리 값이 본문에 그대로 실리면 한 번, 심각도 high", () => {
    const findings = runNetworkRules(
      context({ requests: [request({ bodyBase64: b64(`{"token":"${ENV_CANARY.value}"}`) })] }),
    );
    expect(of(findings, "network/canary-exfiltration")).toEqual([
      {
        ruleId: "network/canary-exfiltration",
        severity: "high",
        location: SYNC_LOCATION,
        message:
          "환경변수 GITHUB_TOKEN 에 심은 값이 collect.example.net 로 가는 요청의 본문 에 실렸습니다 (raw 형에서 발견)",
        fix: EXFILTRATION_FIX,
        evidence: [
          "collect.example.net <canary:GITHUB_TOKEN>",
          "호출: placeholder",
          "요청의 본문: raw",
        ],
      },
    ]);
  });

  it("network/canary-exfiltration: 파일 카나리 값이 base64 로 실려도 잡고 evidence 에 형 이름이 있다", () => {
    const inner = b64(`{"mcpServers":{"x":{"env":{"API_TOKEN":"${FILE_CANARY.value}"}}}}`);
    const findings = runNetworkRules(
      context({ requests: [request({ bodyBase64: b64(`payload=${inner}`) })] }),
    );
    expect(of(findings, "network/canary-exfiltration")).toEqual([
      {
        ruleId: "network/canary-exfiltration",
        severity: "high",
        location: SYNC_LOCATION,
        message:
          "파일 ~/.cursor/mcp.json 에 심은 값이 collect.example.net 로 가는 요청의 본문 에 실렸습니다 (base64 형에서 발견)",
        fix: EXFILTRATION_FIX,
        evidence: [
          "collect.example.net <canary:~/.cursor/mcp.json>",
          "호출: placeholder",
          "요청의 본문: base64",
        ],
      },
    ]);
  });

  it("network/canary-exfiltration: 선언된 호스트로 가는 요청이어도 잡는다", () => {
    const findings = runNetworkRules(
      context(
        { requests: [request({ bodyBase64: b64(ENV_CANARY.value) })] },
        { declaredHosts: ["collect.example.net"] },
      ),
    );
    expect(of(findings, "network/canary-exfiltration")).toHaveLength(1);
    expect(of(findings, "network/canary-exfiltration")[0]?.severity).toBe("high");
    expect(of(findings, "network/undeclared-destination")).toHaveLength(0);
    expect(of(findings, "network/declared-destination")).toHaveLength(1);
  });

  it("network/canary-exfiltration: message 와 evidence 어디에도 카나리 값이 없다", () => {
    const value = ENV_CANARY.value;
    const half = hex(value).slice(0, 30);
    const findings = runNetworkRules(
      context({
        requests: [
          request({ method: "GET", path: `/c?t=${value}&x=1` }),
          request({ path: `/c/${encodeURIComponent(b64(`id=${value};`))}` }),
          request({ headers: [["x-debug", `Bearer ${hex(value)}`]] }),
          request({ bodyBase64: b64(FILE_CANARY.value.toUpperCase()) }),
          request({ host: `${hex(value)}.collect.example.net` }),
        ],
        tlsRejections: [{ phase: SYNC, host: `${value.toLowerCase()}.pinned.example.net` }],
        dnsNames: [{ phase: SYNC, name: `${half}.${hex(value).slice(30)}.collect.example.net` }],
      }),
    );
    // (도구, collect.example.net, env) 의 URL·헤더, 같은 호스트의 파일 카나리, 이름 조회 한 건.
    expect(of(findings, "network/canary-exfiltration")).toHaveLength(3);

    const printed = JSON.stringify(
      findings.map((finding) => [finding.message, finding.fix, finding.evidence]),
    );
    const lower = printed.toLowerCase();
    for (const canary of [ENV_CANARY, FILE_CANARY]) {
      expect(lower).not.toContain(canary.value.toLowerCase());
      expect(lower).not.toContain(hex(canary.value));
      expect(printed).not.toContain(b64(canary.value).replace(/=+$/, ""));
    }
    // 값의 절반만 남는 것도 실행마다 달라지는 조각이다(§4).
    expect(lower).not.toContain(half);
    expect(printed).not.toContain(b64(`id=${value};`).slice(8, 24));

    expect(of(findings, "network/undeclared-destination").map((f) => f.message)).toContain(
      "선언되지 않은 호스트 collect.example.net 에 접속했습니다: GET /c?t=<canary:GITHUB_TOKEN>&x=1",
    );
    expect(findings.map((f) => f.evidence[0])).toContain(
      "<canary:GITHUB_TOKEN>.collect.example.net",
    );
  });

  it("network/undeclared-destination: 선언에 없는 호스트면 한 번", () => {
    const findings = runNetworkRules(context({ requests: [request()] }));
    expect(findings).toEqual([
      {
        ruleId: "network/undeclared-destination",
        severity: "medium",
        location: SYNC_LOCATION,
        message: "선언되지 않은 호스트 collect.example.net 에 접속했습니다: POST /v1",
        fix: "서버 문서에 없는 목적지입니다. 의도된 접속이면 --allow-host collect.example.net 로 선언하세요. 아니면 등록하지 마세요.",
        evidence: ["collect.example.net", "호출: placeholder"],
      },
    ]);
  });

  it("network/undeclared-destination: '*.example.com' 항목은 api.example.com 을 덮고 evil-example.com 은 덮지 않는다", () => {
    const findings = runNetworkRules(
      context(
        {
          requests: [
            request({ host: "api.example.com" }),
            request({ host: "a.b.example.com" }),
            request({ host: "evil-example.com" }),
            request({ host: "example.com.evil.net" }),
          ],
        },
        { declaredHosts: ["*.example.com"] },
      ),
    );
    expect(of(findings, "network/undeclared-destination").map((f) => f.evidence[0])).toEqual([
      "evil-example.com",
      "example.com.evil.net",
    ]);
    expect(of(findings, "network/declared-destination").map((f) => f.evidence[0])).toEqual([
      "a.b.example.com",
      "api.example.com",
    ]);
  });

  it("network/undeclared-destination: '*.' 없는 항목은 하위 도메인을 덮지 않는다", () => {
    const findings = runNetworkRules(
      context(
        { requests: [request({ host: "example.com" }), request({ host: "api.example.com" })] },
        { declaredHosts: ["example.com"] },
      ),
    );
    expect(of(findings, "network/undeclared-destination").map((f) => f.evidence[0])).toEqual([
      "api.example.com",
    ]);
    expect(of(findings, "network/declared-destination").map((f) => f.evidence[0])).toEqual([
      "example.com",
    ]);
  });

  it("network/undeclared-destination: tlsRejections 의 호스트가 선언 밖이면 '내용 못 봄' 문장으로 한 번", () => {
    const findings = runNetworkRules(
      context({
        tlsRejections: [
          { phase: SYNC, host: "pinned.example.net" },
          { phase: SYNC, host: "pinned.example.net" },
        ],
      }),
    );
    expect(of(findings, "network/undeclared-destination")).toEqual([
      {
        ruleId: "network/undeclared-destination",
        severity: "medium",
        location: SYNC_LOCATION,
        message:
          "선언되지 않은 호스트 pinned.example.net 에 접속했습니다 (인증서 고정이라 내용은 보지 못했습니다)",
        fix: "서버 문서에 없는 목적지입니다. 의도된 접속이면 --allow-host pinned.example.net 로 선언하세요. 아니면 등록하지 마세요.",
        evidence: ["pinned.example.net", "호출: placeholder"],
      },
    ]);
  });

  it("network/canary-exfiltration: DNS 질의 이름에 hex 로 실린 카나리를 잡고 채널이 '이름 조회' 다", () => {
    const encoded = hex(ENV_CANARY.value);
    const findings = runNetworkRules(
      context({
        dnsNames: [
          { phase: SYNC, name: `${encoded.slice(0, 30)}.${encoded.slice(30)}.t.attacker.net` },
        ],
      }),
    );
    expect(findings).toEqual([
      {
        ruleId: "network/canary-exfiltration",
        severity: "high",
        location: SYNC_LOCATION,
        message:
          "환경변수 GITHUB_TOKEN 에 심은 값이 <canary:GITHUB_TOKEN>.t.attacker.net 로 가는 이름 조회 에 실렸습니다 (hex 형에서 발견)",
        fix: EXFILTRATION_FIX,
        evidence: [
          "<canary:GITHUB_TOKEN>.t.attacker.net <canary:GITHUB_TOKEN>",
          "호출: placeholder",
          "이름 조회: hex",
        ],
      },
    ]);
  });

  it("network/canary-exfiltration: 같은 도구·호스트·카나리의 요청 셋이 한 건으로 접힌다", () => {
    const body = b64(ENV_CANARY.value);
    const findings = runNetworkRules(
      context({
        requests: [
          request({ phase: call(3, "sync_settings", "url:metadata"), bodyBase64: body }),
          request({ phase: call(3, "sync_settings", "url:loopback"), bodyBase64: body }),
          request({ bodyBase64: body, path: `/v1?k=${ENV_CANARY.value}` }),
        ],
      }),
    );
    expect(of(findings, "network/canary-exfiltration")).toEqual([
      {
        ruleId: "network/canary-exfiltration",
        severity: "high",
        location: SYNC_LOCATION,
        message:
          "환경변수 GITHUB_TOKEN 에 심은 값이 collect.example.net 로 가는 요청의 URL 에 실렸습니다 (raw 형에서 발견)",
        fix: EXFILTRATION_FIX,
        evidence: [
          "collect.example.net <canary:GITHUB_TOKEN>",
          "호출: placeholder, url:loopback, url:metadata",
          "요청의 URL: raw",
          "요청의 본문: raw",
        ],
      },
    ]);
  });

  it("network/canary-exfiltration: 도구나 호스트나 카나리가 다르면 접히지 않는다", () => {
    const findings = runNetworkRules(
      context({
        requests: [
          request({ bodyBase64: b64(`${ENV_CANARY.value} ${FILE_CANARY.value}`) }),
          request({ host: "other.example.net", bodyBase64: b64(ENV_CANARY.value) }),
          request({ phase: call(4, "ping"), bodyBase64: b64(ENV_CANARY.value) }),
        ],
      }),
    );
    expect(of(findings, "network/canary-exfiltration")).toHaveLength(4);
  });

  it("network/canary-exfiltration: 헤더에 실리면 채널에 헤더 이름이 들어간다", () => {
    const findings = runNetworkRules(
      context({
        requests: [request({ headers: [["authorization", `Bearer ${ENV_CANARY.value}`]] })],
      }),
    );
    expect(of(findings, "network/canary-exfiltration")[0]?.message).toBe(
      "환경변수 GITHUB_TOKEN 에 심은 값이 collect.example.net 로 가는 요청의 헤더 'authorization' 에 실렸습니다 (raw 형에서 발견)",
    );
  });

  it("network/canary-exfiltration: 값 사이에 보이지 않는 문자를 끼워 보내도 잡고, 그 경로는 message 에 싣지 않는다", () => {
    // 폭 없는 공백(U+200B). 소스에 숨은 문자를 두지 않으려고 코드로 만든다.
    const hidden = String.fromCharCode(0x200b);
    const split = `${ENV_CANARY.value.slice(0, 12)}${hidden}${ENV_CANARY.value.slice(12)}`;
    const findings = runNetworkRules(
      context({
        requests: [request({ method: "GET", path: `/c?t=${encodeURIComponent(split)}` })],
      }),
    );
    expect(findings.map((f) => [f.ruleId, f.message, f.evidence])).toEqual([
      [
        "network/canary-exfiltration",
        "환경변수 GITHUB_TOKEN 에 심은 값이 collect.example.net 로 가는 요청의 URL 에 실렸습니다 (folded 형에서 발견)",
        ["collect.example.net <canary:GITHUB_TOKEN>", "호출: placeholder", "요청의 URL: folded"],
      ],
      [
        "network/undeclared-destination",
        "선언되지 않은 호스트 collect.example.net 에 접속했습니다: GET <canary:GITHUB_TOKEN>",
        ["collect.example.net", "호출: placeholder"],
      ],
    ]);
  });

  it("network/canary-exfiltration: 카나리가 비어 있거나 없으면 유출 발견이 없다", () => {
    const requests = [request({ bodyBase64: b64(ENV_CANARY.value) })];
    expect(
      of(runNetworkRules(context({ requests }, { canaries: [] })), "network/canary-exfiltration"),
    ).toEqual([]);
    expect(
      of(
        runNetworkRules(context({ requests }, { canaries: [{ ...ENV_CANARY, value: "" }] })),
        "network/canary-exfiltration",
      ),
    ).toEqual([]);
  });

  it("network/internal-destination: served 가 blocked 인 요청이면 한 번", () => {
    const findings = runNetworkRules(
      context(
        { requests: [request({ method: "GET", path: "/latest/meta-data/", served: "blocked" })] },
        { declaredHosts: ["collect.example.net"] },
      ),
    );
    expect(of(findings, "network/internal-destination")).toEqual([
      {
        ruleId: "network/internal-destination",
        severity: "medium",
        location: SYNC_LOCATION,
        message:
          "collect.example.net 가 내부 주소로 풀려 요청을 전달하지 않았습니다: GET /latest/meta-data/",
        fix: "바깥 이름이 내부 주소를 가리킵니다. 사내망이나 메타데이터 주소에 닿으려는 모양입니다. 이 호스트가 왜 필요한지 확인하세요.",
        evidence: ["collect.example.net", "호출: placeholder"],
      },
    ]);
  });

  it("exfiltratedCanaries: 호출 단계의 유출만 돌려주고 origin 이 맞다", () => {
    const input = context({
      requests: [
        request({ phase: START, bodyBase64: b64(ENV_CANARY.value) }),
        request({ bodyBase64: b64(FILE_CANARY.value) }),
        request({ bodyBase64: b64(FILE_CANARY.value) }),
        request({ phase: call(1, "fetch_status"), path: `/?k=${ENV_CANARY.value}` }),
      ],
      dnsNames: [
        { phase: call(5, "ping"), name: `${splitHex(FILE_CANARY.value)}.x.net` },
        // 값의 일부만 실린 이름은 유출로 보지 않는다.
        { phase: call(6, "echo"), name: `${hex(FILE_CANARY.value).slice(0, 60)}.x.net` },
      ],
    });
    expect(exfiltratedCanaries(input)).toEqual([
      { toolIndex: 1, name: "GITHUB_TOKEN", origin: "env" },
      { toolIndex: 3, name: "~/.cursor/mcp.json", origin: "file" },
      { toolIndex: 5, name: "~/.cursor/mcp.json", origin: "file" },
    ]);
    // 시작 단계의 유출도 발견으로는 난다. 위치가 서버 전체일 뿐이다.
    const atServer = of(runNetworkRules(input), "network/canary-exfiltration").filter(
      (finding) => finding.location.kind === "server",
    );
    expect(atServer.map((finding) => finding.evidence)).toEqual([
      ["collect.example.net <canary:GITHUB_TOKEN>", "단계: 시작", "요청의 본문: raw"],
    ]);
  });

  it("network/declared-destination: 같은 호스트 여러 요청이 한 건으로 접히고 횟수가 message 에 있다", () => {
    const findings = runNetworkRules(
      context(
        {
          requests: [
            request({ phase: START, method: "GET", path: "/a" }),
            request({ phase: call(0, "get_forecast"), method: "GET", path: "/b" }),
            request({ method: "GET", path: "/a" }),
          ],
        },
        { declaredHosts: ["collect.example.net"] },
      ),
    );
    expect(findings).toEqual([
      {
        ruleId: "network/declared-destination",
        severity: "info",
        location: { kind: "server", path: "" },
        message: "선언된 호스트 collect.example.net 에 3회 접속했습니다",
        fix: "기록입니다. 조치가 필요 없습니다.",
        evidence: ["collect.example.net", "호출: placeholder", "GET /a", "GET /b"],
      },
    ]);
  });

  it("network/replay-miss: served 가 replay-miss 인 요청마다 한 번", () => {
    const findings = runNetworkRules(
      context(
        {
          requests: [
            request({ served: "replay-miss", method: "GET", path: "/v1/latest?t=1" }),
            request({ served: "replay-miss", host: "api.example.net" }),
            request({ served: "replay-hit", host: "hit.example.net" }),
          ],
        },
        { declaredHosts: ["*.example.net"], mode: "replay" },
      ),
    );
    expect(of(findings, "network/replay-miss")).toEqual([
      {
        ruleId: "network/replay-miss",
        severity: "medium",
        location: SYNC_LOCATION,
        message: "녹화에 없는 요청이 재생에서 나왔습니다: POST api.example.net/v1",
        fix: "같은 입력에 다른 요청을 보냅니다. 요청이 시각이나 난수에 의존한다는 뜻입니다. 서버가 무엇을 바꿔 보내는지 확인하세요.",
        evidence: ["api.example.net", "호출: placeholder"],
      },
      {
        ruleId: "network/replay-miss",
        severity: "medium",
        location: SYNC_LOCATION,
        message: "녹화에 없는 요청이 재생에서 나왔습니다: GET collect.example.net/v1/latest?t=1",
        fix: "같은 입력에 다른 요청을 보냅니다. 요청이 시각이나 난수에 의존한다는 뜻입니다. 서버가 무엇을 바꿔 보내는지 확인하세요.",
        evidence: ["collect.example.net", "호출: placeholder"],
      },
    ]);
  });

  it("network/replay-miss: 같은 도구·호스트의 누락 요청 셋은 한 건으로 접히고 나머지가 evidence 에 실린다", () => {
    const findings = runNetworkRules(
      context(
        {
          requests: ["/d", "/b", "/a", "/c"].map((path) =>
            request({ served: "replay-miss", method: "GET", path }),
          ),
        },
        { declaredHosts: ["collect.example.net"], mode: "replay" },
      ),
    );
    expect(of(findings, "network/replay-miss").map((f) => [f.message, f.evidence])).toEqual([
      [
        "녹화에 없는 요청이 재생에서 나왔습니다: GET collect.example.net/a",
        ["collect.example.net", "호출: placeholder", "GET /b", "GET /c", "외 1개"],
      ],
    ]);
  });

  it("network/pinned-certificate: tlsRejections 의 호스트마다 한 번", () => {
    const findings = runNetworkRules(
      context(
        {
          tlsRejections: [
            { phase: SYNC, host: "b.example.net" },
            { phase: START, host: "a.example.net" },
            { phase: call(0, "get_forecast"), host: "b.example.net" },
          ],
        },
        { declaredHosts: ["*.example.net"] },
      ),
    );
    expect(findings).toEqual([
      {
        ruleId: "network/pinned-certificate",
        severity: "info",
        location: { kind: "server", path: "" },
        message: "a.example.net 가 점검용 인증서를 거부해 요청 내용을 보지 못했습니다",
        fix: "인증서 고정을 쓰는 접속입니다. 목적지만 기록됐습니다. 그 호스트를 신뢰할지는 직접 판단하세요.",
        evidence: ["a.example.net", "단계: 시작"],
      },
      {
        ruleId: "network/pinned-certificate",
        severity: "info",
        location: { kind: "server", path: "" },
        message: "b.example.net 가 점검용 인증서를 거부해 요청 내용을 보지 못했습니다",
        fix: "인증서 고정을 쓰는 접속입니다. 목적지만 기록됐습니다. 그 호스트를 신뢰할지는 직접 판단하세요.",
        evidence: ["b.example.net", "호출: placeholder"],
      },
    ]);
  });

  it("network/direct-ip: '<gateway>' 도 내부 주소도 아닌 inet connect 는 한 번, '<gateway>' 로 가는 connect 는 0", () => {
    const findings = runNetworkRules(
      context({
        events: [
          connect("203.0.113.7", 443),
          connect("203.0.113.7", 443),
          connect("<gateway>", 443),
          connect("<gateway>", 8443),
          { kind: "connect", phase: SYNC, family: "unix", address: "/run/x.sock", port: 0 },
        ],
      }),
    );
    expect(findings).toEqual([
      {
        ruleId: "network/direct-ip",
        severity: "medium",
        location: SYNC_LOCATION,
        message: "이름 조회 없이 203.0.113.7:443 에 직접 접속을 시도했습니다",
        fix: "격리 안이라 닿지 않았습니다. 주소를 코드에 박아 둔 접속은 목적지를 감추는 수법일 수 있습니다.",
        evidence: ["203.0.113.7:443", "호출: placeholder"],
      },
    ]);
  });

  it("network/direct-ip: 내부 주소로 가는 connect 는 이 규칙에 걸리지 않는다(behavior/internal-address 의 몫)", () => {
    const internal: SyscallEvent[] = [
      connect("10.0.0.5", 80),
      connect("172.16.0.1", 80),
      connect("172.31.255.254", 80),
      connect("192.168.1.1", 80),
      connect("127.0.0.1", 8080),
      connect("169.254.169.254", 80),
      connect("::1", 80, "inet6"),
      connect("fd00::1", 80, "inet6"),
      connect("fe80::1", 80, "inet6"),
      connect("::ffff:10.0.0.5", 80, "inet6"),
    ];
    expect(runNetworkRules(context({ events: internal }))).toEqual([]);

    // 표의 경계 바로 밖은 걸린다.
    const outside = runNetworkRules(
      context({
        events: [
          connect("172.32.0.1", 80),
          connect("11.0.0.1", 80),
          connect("2001:db8::1", 443, "inet6"),
        ],
      }),
    );
    expect(outside.map((finding) => finding.evidence[0])).toEqual([
      "11.0.0.1:80",
      "172.32.0.1:80",
      "[2001:db8::1]:443",
    ]);
  });

  it("network/direct-ip: 같은 도구·주소는 포트가 달라도 한 건이고 다른 포트가 evidence 에 실린다", () => {
    const findings = runNetworkRules(
      context({ events: [connect("203.0.113.7", 8080), connect("203.0.113.7", 443)] }),
    );
    expect(findings.map((f) => [f.message, f.evidence])).toEqual([
      [
        "이름 조회 없이 203.0.113.7:443 에 직접 접속을 시도했습니다",
        ["203.0.113.7:443", "호출: placeholder", "203.0.113.7:8080"],
      ],
    ]);
  });

  it("호출이 아닌 단계의 관측은 위치가 서버 전체이고 evidence 둘째 칸이 단계 이름이다", () => {
    const findings = runNetworkRules(
      context({
        requests: [request({ phase: { kind: "shutdown" } }), request({ phase: START })],
        events: [connect("203.0.113.7", 443, "inet", { kind: "list" })],
      }),
    );
    expect(findings.map((f) => [f.ruleId, f.location, f.evidence])).toEqual([
      ["network/direct-ip", { kind: "server", path: "" }, ["203.0.113.7:443", "단계: 목록"]],
      [
        "network/undeclared-destination",
        { kind: "server", path: "" },
        ["collect.example.net", "단계: 시작, 종료"],
      ],
    ]);
  });

  it("path 는 앞 80자만 message 에 싣는다", () => {
    const path = `/${"a".repeat(100)}`;
    const findings = runNetworkRules(context({ requests: [request({ method: "GET", path })] }));
    expect(findings[0]?.message).toBe(
      `선언되지 않은 호스트 collect.example.net 에 접속했습니다: GET /${"a".repeat(79)}`,
    );
  });

  it("호스트 대조는 대소문자와 끝의 점을 가리지 않는다", () => {
    const findings = runNetworkRules(
      context(
        { requests: [request({ host: "API.Example.COM." })] },
        { declaredHosts: ["api.example.com"] },
      ),
    );
    expect(findings.map((f) => f.ruleId)).toEqual(["network/declared-destination"]);
  });

  it("입력 순서를 섞어도 결과가 같다", () => {
    const requests = [
      request({ phase: START, host: "registry.npmjs.org", method: "GET", path: "/x" }),
      request({ bodyBase64: b64(ENV_CANARY.value) }),
      request({ phase: call(3, "sync_settings", "url:metadata"), path: "/v2" }),
      request({ phase: call(1, "fetch_status"), host: "b.example.net", served: "blocked" }),
      request({ phase: call(1, "fetch_status"), host: "a.example.net", served: "replay-miss" }),
      request({ headers: [["x-a", FILE_CANARY.value]], path: `/?k=${ENV_CANARY.value}` }),
    ];
    const events = [
      connect("203.0.113.7", 443),
      connect("198.51.100.1", 22, "inet", call(1, "fetch_status")),
      connect("203.0.113.7", 80),
      connect("<gateway>", 443),
    ];
    const tlsRejections = [
      { phase: SYNC, host: "pinned.example.net" },
      { phase: START, host: "registry.npmjs.org" },
    ];
    const dnsNames = [
      { phase: SYNC, name: `${splitHex(FILE_CANARY.value)}.attacker.net` },
      { phase: SYNC, name: "collect.example.net" },
    ];
    const canaries = [ENV_CANARY, FILE_CANARY];
    const declaredHosts = ["registry.npmjs.org", "*.example.org"];
    const forward = runNetworkRules({
      observation: observation({ requests, events, tlsRejections, dnsNames }),
      declaredHosts,
      canaries,
      mode: "live",
    });
    const backward = runNetworkRules({
      observation: observation({
        requests: [...requests].reverse(),
        events: [...events].reverse(),
        tlsRejections: [...tlsRejections].reverse(),
        dnsNames: [...dnsNames].reverse(),
      }),
      declaredHosts: [...declaredHosts].reverse(),
      canaries: [...canaries].reverse(),
      mode: "live",
    });
    expect(forward.length).toBeGreaterThan(8);
    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward));
    expect(
      exfiltratedCanaries({
        observation: observation({ requests: [...requests].reverse(), dnsNames }),
        declaredHosts,
        canaries: [...canaries].reverse(),
        mode: "live",
      }),
    ).toEqual(
      exfiltratedCanaries({
        observation: observation({ requests, dnsNames: [...dnsNames].reverse() }),
        declaredHosts,
        canaries,
        mode: "live",
      }),
    );
  });

  it("observation 이 비면 []", () => {
    expect(runNetworkRules(context({}))).toEqual([]);
    expect(exfiltratedCanaries(context({}))).toEqual([]);
  });

  it("network-benign-startup.json 에서 info 를 제외한 발견이 0", () => {
    const findings = runNetworkRules(loadFixture("network-benign-startup.json"));
    expect(findings.filter((finding) => finding.severity !== "info")).toEqual([]);
  });

  it("NETWORK_RULES 가 §3.4 의 일곱 규칙이고, 낸 발견의 심각도가 표와 같다", () => {
    expect(NETWORK_RULES.map((rule) => [rule.id, rule.family, rule.defaultSeverity])).toEqual([
      ["network/canary-exfiltration", "network", "high"],
      ["network/undeclared-destination", "network", "medium"],
      ["network/declared-destination", "network", "info"],
      ["network/internal-destination", "network", "medium"],
      ["network/pinned-certificate", "network", "info"],
      ["network/replay-miss", "network", "medium"],
      ["network/direct-ip", "network", "medium"],
    ]);
    for (const rule of NETWORK_RULES) expect(rule.summary.length).toBeGreaterThan(0);
  });
});

describe("network 픽스처(§3.4 표의 행마다 걸리는 것 하나와 그 행만 빠진 반례 하나)", () => {
  const files = readdirSync(SANDBOX)
    .filter((file) => /^network-.*\.json$/.test(file))
    .sort();

  it("일곱 규칙 모두 걸리는 픽스처와 반례 픽스처가 있다", () => {
    for (const rule of NETWORK_RULES) {
      const name = rule.id.slice("network/".length);
      expect(files).toContain(`network-${name}.json`);
      expect(files).toContain(`network-${name}.counter.json`);
    }
  });

  it.each(files)(
    "%s: expect 의 규칙이 그 횟수만큼 나고 다른 규칙은 also 에 적힌 것뿐이다",
    (file) => {
      const fixture = loadFixture(file);
      const findings = runNetworkRules(fixture);
      const { ruleId, count, also = [] } = fixture.expect;
      expect(of(findings, ruleId)).toHaveLength(count);
      const others = [...new Set(findings.map((f) => f.ruleId))].filter((id) => id !== ruleId);
      expect(others.sort()).toEqual([...also].sort());
      const known = new Set<string>(NETWORK_RULES.map((rule) => rule.id));
      for (const finding of findings) {
        expect(known.has(finding.ruleId)).toBe(true);
        const info = NETWORK_RULES.find((rule) => rule.id === finding.ruleId);
        expect(finding.severity).toBe(info?.defaultSeverity);
      }
    },
  );
});
