import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderReport } from "../src/report.js";
import type {
  AuditReport,
  Finding,
  SandboxNetworkMode,
  SandboxReport,
  SandboxUnavailableCode,
  Severity,
} from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const expectedDir = join(here, "fixtures", "expected");

function loadSample(): AuditReport {
  return JSON.parse(readFileSync(join(expectedDir, "report.sample.json"), "utf8")) as AuditReport;
}

function report(overrides: Partial<AuditReport> = {}): AuditReport {
  return {
    schemaVersion: 1,
    generator: { name: "@mcpeak/audit", version: "0.1.0" },
    server: {
      name: "demo",
      version: "1.0.0",
      toolCount: 3,
      promptCount: 0,
      resourceCount: 0,
      hasInstructions: false,
      capabilityKeys: ["tools"],
    },
    probe: "readonly",
    probedTools: [],
    findings: [],
    skipped: [],
    counts: { high: 0, medium: 0, low: 0, info: 0 },
    exitCode: 0,
    ...overrides,
  };
}

function toolFinding(
  ruleId: Finding["ruleId"],
  severity: Severity,
  toolIndex: number,
  toolName: string,
  path: string,
): Finding {
  return {
    ruleId,
    severity,
    location: { kind: "tool", toolIndex, toolName, path },
    message: `${ruleId} 메시지`,
    fix: `${ruleId} 해결`,
    evidence: [path],
  };
}

/** 발견 머리 줄(`[...] ruleId · 위치`)만 순서대로 뽑는다. */
function headLines(text: string): string[] {
  return text.split("\n").filter((line) => line.startsWith("["));
}

const FLOW: Finding = {
  ruleId: "flow/toxic-combination",
  severity: "low",
  location: { kind: "server", path: "" },
  message:
    "이 서버는 외부 입력을 읽고(get_issue), 비공개 데이터에 닿고(get_file), 밖으로 쓸 수 있습니다(create_pr).",
  fix: "세 역할을 한 세션에서 함께 켜지 마세요. 외부 입력을 읽는 도구만 따로 붙이거나 쓰기 도구를 끄세요.",
  evidence: ["get_issue", "get_file", "create_pr"],
};

describe("renderReport", () => {
  it("fixtures/expected/report.sample.json 의 리포트가 report.sample.txt 와 글자 단위로 같다", () => {
    const expected = readFileSync(join(expectedDir, "report.sample.txt"), "utf8");
    expect(renderReport(loadSample())).toBe(expected);
  });

  it("심각도 내림차순, 같은 심각도 안에서는 toolIndex·ruleId·path 순이다", () => {
    const findings: Finding[] = [
      toolFinding("schema/over-broad", "medium", 1, "b", "inputSchema"),
      toolFinding("desc/injection", "high", 2, "c", "description"),
      toolFinding("desc/sensitive-path", "low", 0, "a", "description"),
      toolFinding("desc/injection", "high", 0, "a", "title"),
      toolFinding("desc/injection", "high", 0, "a", "description"),
      toolFinding("desc/encoded-blob", "info", 0, "a", "description"),
      toolFinding("desc/hidden-unicode", "high", 0, "a", "name"),
      {
        ruleId: "result/injection",
        severity: "high",
        location: { kind: "result", toolIndex: 2, toolName: "c", path: "content[0].text" },
        message: "m",
        fix: "f",
        evidence: [],
      },
      {
        ruleId: "protocol/plaintext",
        severity: "high",
        location: { kind: "protocol", path: "" },
        message: "m",
        fix: "f",
        evidence: [],
      },
    ];
    expect(headLines(renderReport(report({ findings })))).toEqual([
      "[심각] protocol/plaintext · 프로토콜",
      "[심각] desc/hidden-unicode · 도구 'a' 의 name",
      "[심각] desc/injection · 도구 'a' 의 description",
      "[심각] desc/injection · 도구 'a' 의 title",
      "[심각] desc/injection · 도구 'c' 의 description",
      "[심각] result/injection · 도구 'c' 호출 응답의 content[0].text",
      "[주의] schema/over-broad · 도구 'b' 의 inputSchema",
      "[낮음] desc/sensitive-path · 도구 'a' 의 description",
      "[정보] desc/encoded-blob · 도구 'a' 의 description",
    ]);
  });

  it("같은 도구·같은 규칙 4곳 이상이면 3개 + '같은 도구에서 n곳 더' 다", () => {
    const paths = ["p0", "p1", "p2", "p3"];
    const four = paths.map((p) => toolFinding("desc/hidden-unicode", "medium", 0, "a", p));
    const other = toolFinding("desc/hidden-unicode", "medium", 1, "b", "description");
    const text = renderReport(report({ findings: [...four, other] }));

    expect(headLines(text)).toEqual([
      "[주의] desc/hidden-unicode · 도구 'a' 의 p0",
      "[주의] desc/hidden-unicode · 도구 'a' 의 p1",
      "[주의] desc/hidden-unicode · 도구 'a' 의 p2",
      "[주의] desc/hidden-unicode · 도구 'b' 의 description",
    ]);
    const lines = text.split("\n");
    const more = lines.indexOf("  → 같은 도구에서 1곳 더");
    expect(more).toBeGreaterThan(lines.indexOf("[주의] desc/hidden-unicode · 도구 'a' 의 p2"));
    expect(more).toBeLessThan(
      lines.indexOf("[주의] desc/hidden-unicode · 도구 'b' 의 description"),
    );

    // 3곳이면 접지 않는다.
    const three = renderReport(report({ findings: four.slice(0, 3) }));
    expect(three).not.toContain("곳 더");
    expect(headLines(three)).toHaveLength(3);
  });

  it("flow 는 심각도 목록에 없고 마지막 구획에 있다", () => {
    const text = renderReport(
      report({
        findings: [FLOW, toolFinding("desc/sensitive-path", "low", 0, "a", "description")],
        skipped: [{ family: "surface", reason: "이유" }],
      }),
    );
    const lines = text.split("\n");
    expect(headLines(text)).toEqual(["[낮음] desc/sensitive-path · 도구 'a' 의 description"]);
    const flowAt = lines.indexOf("권한 조합 경고 (결함이 아닙니다)");
    expect(flowAt).toBeGreaterThan(
      lines.indexOf("[낮음] desc/sensitive-path · 도구 'a' 의 description"),
    );
    expect(lines.slice(flowAt, flowAt + 4)).toEqual([
      "권한 조합 경고 (결함이 아닙니다)",
      `  → ${FLOW.message}`,
      "  → 외부 입력에 숨은 지시가 있으면 비공개 데이터가 밖으로 나갈 수 있습니다. GitHub MCP 2025-05 사고가 이 모양입니다.",
      "  해결: 세 역할을 한 세션에서 함께 켜지 마세요. 외부 입력을 읽는 도구만 따로 붙이거나 쓰기 도구를 끄세요.",
    ]);
    expect(lines.indexOf("검사하지 않은 것")).toBeGreaterThan(flowAt);

    expect(renderReport(report())).not.toContain("권한 조합 경고");
  });

  it("skipped 가 있으면 '검사하지 않은 것' 절이 있다", () => {
    const reason = "--baseline 을 주지 않아 도구 표면 변경을 비교하지 않았습니다.";
    const lines = renderReport(report({ skipped: [{ family: "surface", reason }] })).split("\n");
    const at = lines.indexOf("검사하지 않은 것");
    expect(at).toBeGreaterThan(-1);
    expect(lines[at + 1]).toBe(`  - surface: ${reason}`);

    expect(renderReport(report())).not.toContain("검사하지 않은 것");
  });

  it("마지막 두 줄이 고정 문장이다", () => {
    const tail = [
      "이 검사는 설명문의 문형과 프로토콜 표면만 봅니다. 바꿔 말한 지시와 서버 코드의 실제 행위는 보지 못합니다.",
      "행위 관측(Docker 격리)은 mcpeak audit --sandbox 로 켭니다.",
    ];
    for (const r of [report(), loadSample()]) {
      const text = renderReport(r);
      expect(text.endsWith("\n")).toBe(true);
      expect(text.trimEnd().split("\n").slice(-2)).toEqual(tail);
    }
  });

  it("위치 줄의 이름에 든 보이지 않는 문자·제어 문자를 <U+XXXX> 로 드러낸다", () => {
    const zwsp = String.fromCodePoint(0x200b);
    const esc = String.fromCodePoint(0x1b);
    const text = renderReport(
      report({
        findings: [
          toolFinding("desc/hidden-unicode", "high", 0, `get${zwsp}time`, "name"),
          {
            ...toolFinding("desc/injection", "high", 1, "x", "description"),
            location: { kind: "resource", uri: `file:///a${esc}[8m.txt`, path: "uri" },
          },
        ],
        counts: { high: 2, medium: 0, low: 0, info: 0 },
      }),
    );
    // 리소스 위치는 toolIndex 가 없어(-1) §3.0 정렬에서 도구보다 앞선다.
    expect(headLines(text)).toEqual([
      "[심각] desc/injection · 리소스 file:///a<U+001B>[8m.txt 의 uri",
      "[심각] desc/hidden-unicode · 도구 'get<U+200B>time' 의 name",
    ]);
    expect(text).not.toContain(zwsp);
    expect(text).not.toContain(esc);
  });

  it("probe all 이면 머리에 경고 괄호가 붙는다", () => {
    const all = renderReport(report({ probe: "all", probedTools: ["a", "b"] })).split("\n");
    expect(all[2]).toBe("호출 정책 all · 호출한 도구 2개 (상태를 바꾸는 도구도 호출했습니다)");

    const readonly = renderReport(report({ probe: "readonly", probedTools: ["a"] })).split("\n");
    expect(readonly[2]).toBe("호출 정책 readonly · 호출한 도구 1개");
  });
});

const RAN: Extract<SandboxReport, { status: "ran" }> = {
  status: "ran",
  backend: "docker",
  image: "mcpeak-audit-sandbox:0123456789ab",
  network: "live",
  compareHost: false,
  callCount: 7,
  declaredHosts: ["api.example.net", "registry.npmjs.org"],
  requests: [],
};

const STAGE_ONE_TAIL = [
  "이 검사는 설명문의 문형과 프로토콜 표면만 봅니다. 바꿔 말한 지시와 서버 코드의 실제 행위는 보지 못합니다.",
  "행위 관측(Docker 격리)은 mcpeak audit --sandbox 로 켭니다.",
];

function loadSandboxSample(): AuditReport {
  return JSON.parse(readFileSync(join(expectedDir, "report.sandbox.json"), "utf8")) as AuditReport;
}

describe("renderReport: 격리", () => {
  it.each<[SandboxNetworkMode, string]>([
    ["live", "가로채기"],
    ["record", "가로채기(녹화)"],
    ["replay", "재생(네트워크 없음)"],
  ])("ran 이면 둘째 줄이 §6.1 의 격리 실행 문장이다(네트워크 세 값 각각): %s", (network, label) => {
    const lines = renderReport(report({ sandbox: { ...RAN, network } })).split("\n");
    expect(lines[0]).toBe("mcpeak audit 결과");
    expect(lines[1]).toBe(
      `격리 실행: Docker 컨테이너 안에서 서버를 띄웠습니다 · 네트워크 ${label} · 이미지 mcpeak-audit-sandbox:0123456789ab`,
    );
    expect(lines[2]).toBe(
      "서버 demo 1.0.0 · 도구 3개 · 프롬프트 0개 · 리소스 0개 · instructions 없음",
    );
  });

  it.each<[SandboxUnavailableCode, string, string]>([
    [
      "docker-missing",
      "",
      "행위 관측 안 함: Docker 를 찾을 수 없습니다. 서버는 격리 없이 이 머신에서 실행됐습니다. (설치: https://docs.docker.com/get-docker/)",
    ],
    [
      "daemon-down",
      "",
      "행위 관측 안 함: Docker 데몬이 응답하지 않습니다. 서버는 격리 없이 이 머신에서 실행됐습니다. (Docker Desktop 을 켜거나 dockerd 를 시작한 뒤 다시 실행하세요)",
    ],
    [
      "unsupported-command",
      "python3",
      "행위 관측 안 함: 격리 이미지가 실행할 수 없습니다: 'python3'. 격리 이미지는 node, npx, npm 만 실행합니다. 서버는 격리 없이 이 머신에서 실행됐습니다.",
    ],
    [
      "image-build-failed",
      "failed to resolve source metadata for docker.io/library/node",
      "행위 관측 안 함: 격리 이미지를 만들지 못했습니다: failed to resolve source metadata for docker.io/library/node. 서버는 격리 없이 이 머신에서 실행됐습니다. (docker build 가 되는지, 네트워크가 되는지 확인하세요)",
    ],
    [
      "start-failed",
      "Conflict. The container name <container> is already in use",
      "행위 관측 안 함: 격리 컨테이너를 띄우지 못했습니다: Conflict. The container name <container> is already in use. 서버는 격리 없이 이 머신에서 실행됐습니다.",
    ],
  ])(
    "unavailable 다섯 code 각각의 둘째 줄이 §6.1 표와 글자 단위로 같다: %s",
    (code, detail, expected) => {
      const text = renderReport(
        report({ sandbox: { status: "unavailable", reason: { code, detail } } }),
      );
      const lines = text.split("\n");
      expect(lines[1]).toBe(expected);
      expect(lines[2]).toBe(
        "서버 demo 1.0.0 · 도구 3개 · 프롬프트 0개 · 리소스 0개 · instructions 없음",
      );
      // 격리가 안 켜졌으면 꼬리와 호출 정책 줄은 단계 1 과 같다.
      expect(lines[3]).toBe("호출 정책 readonly · 호출한 도구 0개");
      expect(text.trimEnd().split("\n").slice(-2)).toEqual(STAGE_ONE_TAIL);
      expect(text).not.toContain("선언된 목적지");
    },
  );

  it("unavailable 의 detail 에 든 제어 문자는 표기로 바뀐다", () => {
    const esc = String.fromCodePoint(0x1b);
    const text = renderReport(
      report({
        sandbox: {
          status: "unavailable",
          reason: { code: "start-failed", detail: `boom${esc}[2K` },
        },
      }),
    );
    expect(text).not.toContain(esc);
    expect(text.split("\n")[1]).toContain("boom<U+001B>[2K");
  });

  it("ran 이면 꼬리 다섯 줄이고 compareHost 에 따라 둘째 줄이 갈린다", () => {
    const first =
      "격리 실행은 한 번의 관측입니다. 호출 횟수나 시간이 지나야 달라지는 행동은 보지 못합니다.";
    const rest = [
      "HTTP 가 아닌 접속은 목적지 주소와 포트만 기록했고 내용은 보지 못했습니다.",
      "관측되지 않았다는 것은 없다는 증명이 아닙니다. 암호화하거나 요약해서 내보낸 값은 이 검사가 알아보지 못합니다.",
      "사전 점검은 피해를 0 으로 만들지 않습니다. 조용히 몇 달 갈 일을 첫 시도에서 드러내는 것이 목적입니다. 등록한 뒤에는 --baseline 비교를 이어 가세요.",
    ];
    const tail = (compareHost: boolean) => {
      const text = renderReport(report({ sandbox: { ...RAN, compareHost } }));
      expect(text.endsWith("\n")).toBe(true);
      const lines = text.trimEnd().split("\n");
      // 꼬리 앞은 빈 줄이다.
      expect(lines.at(-6)).toBe("");
      return lines.slice(-5);
    };
    expect(tail(false)).toEqual([
      first,
      "컨테이너라는 흔적(/.dockerenv, cgroup)은 지우지 못했습니다. 격리를 알아채고 얌전히 구는 서버는 --compare-host 로 안팎의 도구 표면을 비교해 보세요.",
      ...rest,
    ]);
    expect(tail(true)).toEqual([
      first,
      "컨테이너라는 흔적(/.dockerenv, cgroup)은 지우지 못했습니다. 안팎의 도구 표면은 비교했지만 호출 뒤의 행동까지 같다는 뜻은 아닙니다.",
      ...rest,
    ]);
    // 단계 1 의 꼬리 두 줄은 없다.
    const text = renderReport(report({ sandbox: RAN }));
    for (const line of STAGE_ONE_TAIL) expect(text).not.toContain(line);
  });

  it("ran 이면 서버 줄 아래에 선언된 목적지 줄이 있다", () => {
    const lines = renderReport(report({ sandbox: RAN })).split("\n");
    expect(lines[3]).toBe(
      "선언된 목적지 2곳: api.example.net, registry.npmjs.org (도구 설명·README·package.json·--allow-host 에서 읽음)",
    );
    expect(lines[4]).toBe("호출 정책 readonly · 호출한 도구 0개");
    expect(lines[5]).toBe("");
  });

  it("ran 이고 호출 정책이 all 이면 꼬리가 격리 문장과 호출 횟수다", () => {
    const lines = renderReport(
      report({ probe: "all", probedTools: ["a", "b", "c"], sandbox: RAN }),
    ).split("\n");
    expect(lines[4]).toBe(
      "호출 정책 all · 호출한 도구 3개 (격리 안이라 상태를 바꾸는 도구도 호출했습니다. 호출 7회)",
    );
    // 격리가 안 켜진 실행은 all 이어도 단계 1 의 꼬리다.
    const unavailable = renderReport(
      report({
        probe: "all",
        probedTools: ["a"],
        sandbox: { status: "unavailable", reason: { code: "daemon-down", detail: "" } },
      }),
    ).split("\n");
    expect(unavailable[3]).toBe(
      "호출 정책 all · 호출한 도구 1개 (상태를 바꾸는 도구도 호출했습니다)",
    );
  });

  it("sandbox 가 없으면 마지막 줄이 '(단계 2에서 제공)' 없는 문장이다", () => {
    const text = renderReport(report());
    expect(text.trimEnd().split("\n").slice(-2)).toEqual(STAGE_ONE_TAIL);
    expect(text).not.toContain("단계 2에서 제공");
    expect(text.split("\n")[1]).toBe(
      "서버 demo 1.0.0 · 도구 3개 · 프롬프트 0개 · 리소스 0개 · instructions 없음",
    );
  });

  it("call 위치가 \"도구 '<name>' 호출(<callId>) 중\" 으로 나온다", () => {
    const zwsp = String.fromCodePoint(0x200b);
    const finding = (toolIndex: number, toolName: string, callId: string): Finding => ({
      ruleId: "behavior/child-process",
      severity: "low",
      location: { kind: "call", toolIndex, toolName, callId, path: "" },
      message: "자식 프로세스를 띄웠습니다: du -sk .",
      fix: "f",
      evidence: ["du -sk .", `호출: ${callId}`],
    });
    const text = renderReport(
      report({
        findings: [
          finding(1, "disk_usage", "placeholder"),
          finding(0, `read${zwsp}note`, "path:traversal"),
        ],
        sandbox: RAN,
      }),
    );
    expect(headLines(text)).toEqual([
      "[낮음] behavior/child-process · 도구 'read<U+200B>note' 호출(path:traversal) 중",
      "[낮음] behavior/child-process · 도구 'disk_usage' 호출(placeholder) 중",
    ]);
  });

  it("fixtures/expected/report.sandbox.txt 와 글자 단위로 같다", () => {
    const expected = readFileSync(join(expectedDir, "report.sandbox.txt"), "utf8");
    expect(renderReport(loadSandboxSample())).toBe(expected);
  });
});
