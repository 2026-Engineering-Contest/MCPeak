/**
 * Analyze 화면 테스트의 순수 데이터 픽스처. DOM·RTL·`vi` 를 import 하지 않는다. node 환경 테스트인
 * `analyze-pillars.test.ts` 는 이 파일만 import 한다. DOM helper 와 fetch fake 는 `analyze-fixtures.tsx` 에 있고
 * 그 파일이 여기 값을 re-export 한다. 값은 `analyze-view.test.tsx`·`security-panel.test.tsx` 에서 옮긴 것 그대로다.
 */
import type { AuditReport, Finding, SandboxReport } from "@mcpeak/audit";
import type {
  AnalyzeSecurityResponse,
  AnalyzeTokensResponse,
  SecurityFindingView,
  ServerCandidate,
  ServerMeta,
  SourceEditResponse,
} from "../../src/api-types.js";

export const META: ServerMeta = { root: "/tmp/proj" };
/** home.test 의 WEATHER 와 같은 값이다. */
export const WEATHER: ServerCandidate = {
  id: "mcp-config:.mcp.json:weather",
  name: "weather",
  command: "node",
  args: ["examples/weather-server/server.mjs", "--port", "3000"],
  source: "mcp-config",
  path: ".mcp.json",
  envNames: ["API_KEY"],
};

/** 도구 a 의 원본. 압축본은 `$schema` 키만 빠진다. */
export const SOURCE_A = {
  name: "a",
  description: "A",
  inputSchema: { $schema: "http://json-schema.org/draft-07/schema#", type: "object" },
};

/** WEATHER 후보로 분석할 때 화면이 만드는 argv. 토큰·보안·홈이 같은 배열이다. */
export const WEATHER_ARGV = [
  "--command",
  "node",
  "--arg",
  "examples/weather-server/server.mjs",
  "--arg",
  "--port",
  "--arg",
  "3000",
  "--env",
  "API_KEY",
];

export const SCHEMA_CHANGE = { kind: "schema-key-removed", path: "/", key: "$schema" } as const;
export const CLEANED_CHANGE = {
  kind: "description-cleaned",
  path: "/",
  before: "A tool.  ",
  after: "A",
} as const;
/** `cleanedResponse()` 의 변경을 도구 이름과 함께 편 것. 화면이 이 순서로 보낸다. */
export const CLEANED_EDITS = [
  { tool: "a", change: SCHEMA_CHANGE },
  { tool: "a", change: CLEANED_CHANGE },
];

export const NOT_FOUND_DETAIL =
  "소스 파일에서 찾지 못했습니다. SDK 나 라이브러리가 만드는 값이면 소스에서 고칠 수 없습니다.";
export const SOURCE_BEFORE =
  'const tools = [\n  {\n    name: "a",\n    description: "A tool.  ",\n  },\n];\n';
export const SOURCE_AFTER = SOURCE_BEFORE.replace('"A tool.  "', '"A"');

/** `cleanedResponse()` 에 대한 미리보기. 설명 한 건만 소스에 있다. */
export function previewResponse(overrides: Partial<SourceEditResponse> = {}): SourceEditResponse {
  return {
    file: "srv/server.mjs",
    mtimeMs: 10,
    before: SOURCE_BEFORE,
    after: SOURCE_AFTER,
    results: [
      { tool: "a", change: SCHEMA_CHANGE, status: "not-found", detail: NOT_FOUND_DETAIL },
      {
        tool: "a",
        change: CLEANED_CHANGE,
        status: "ready",
        detail: "소스에서 1곳을 찾았습니다.",
      },
    ],
    readyCount: 1,
    applied: false,
    conflict: false,
    ...overrides,
  };
}

export const OVERLAY_TEXT = '{\n  "schemaVersion": 1\n}\n';

/** 도구 a 의 설명까지 바뀐 응답. 원본에는 지운 줄, 압축에는 바뀐 줄이 생긴다. */
export function cleanedResponse(): AnalyzeTokensResponse {
  const base = analyzeResponse();
  const [a, b] = base.overlay.tools;
  if (a === undefined || b === undefined) {
    throw new Error("analyzeResponse 의 도구가 둘이 아니다");
  }
  return {
    ...base,
    overlay: {
      ...base.overlay,
      tools: [
        {
          ...a,
          changes: [
            ...a.changes,
            { kind: "description-cleaned", path: "/", before: "A tool.  ", after: "A" },
          ],
        },
        b,
      ],
    },
    sourceTools: [
      { ...SOURCE_A, description: "A tool.  " },
      { name: "b", inputSchema: {} },
    ],
  };
}

/**
 * 토큰 분석 응답. 요약 함수가 읽는 수치는 before 1000, after 760, 도구 a 600→400, b 400→360,
 * promotedParameters 2 다.
 */
export function analyzeResponse(
  otherCapabilities: AnalyzeTokensResponse["overlay"]["source"]["otherCapabilities"] = [],
): AnalyzeTokensResponse {
  return {
    overlay: {
      schemaVersion: 1,
      generator: { name: "@mcpeak/optimize", version: "0.0.0" },
      source: {
        toolCount: 2,
        toolNames: ["a", "b"],
        instructions: "",
        bytes: 1000,
        otherCapabilities,
      },
      instructions: "",
      tools: [
        {
          name: "a",
          description: "A",
          inputSchema: { type: "object" },
          bytes: { before: 600, after: 400 },
          changes: [{ kind: "schema-key-removed", path: "/", key: "$schema" }],
        },
        { name: "b", inputSchema: {}, bytes: { before: 400, after: 360 }, changes: [] },
      ],
      totals: {
        bytesBefore: 1000,
        bytesAfter: 700,
        bytesAfterWithInstructions: 760,
        promotedParameters: 2,
      },
    },
    overlayText: OVERLAY_TEXT,
    report: "REPORT\n",
    sourceTools: [SOURCE_A, { name: "b", inputSchema: {} }],
  };
}

/** 숨은 문자가 든 도구 이름. 파일에는 이스케이프로만 적는다. */
export const HIDDEN_NAME = "get" + "​" + "time";
/** 서버가 `escapeInvisible` 로 만든 표시용 글자. */
export const SHOWN_NAME = "get<U+200B>time";

/** 서버 테스트(§7.3)의 SAMPLE 과 같은 발견 셋. */
export const FINDINGS: readonly Finding[] = [
  {
    ruleId: "desc/hidden-unicode",
    severity: "high",
    location: { kind: "tool", toolIndex: 1, toolName: HIDDEN_NAME, path: "name" },
    message: "보이지 않는 문자가 들어 있습니다.",
    fix: "보이지 않는 문자를 지우세요.",
    evidence: ["U+200B", "raw"],
  },
  {
    ruleId: "protocol/plaintext",
    severity: "medium",
    location: { kind: "protocol", path: "" },
    message: "평문 HTTP 로 붙었습니다.",
    fix: "https 를 쓰세요.",
    evidence: [],
  },
  {
    ruleId: "flow/toxic-combination",
    severity: "info",
    location: { kind: "server", path: "" },
    message: "읽기와 보내기 도구가 함께 있습니다.",
    fix: "권한을 나누세요.",
    evidence: [],
  },
];

export const VIEWS: readonly SecurityFindingView[] = [
  { where: `도구 '${SHOWN_NAME}' 의 name`, tool: SHOWN_NAME, toolIndex: 1 },
  { where: "프로토콜", tool: null, toolIndex: -1 },
  { where: "서버", tool: null, toolIndex: -1 },
];

export const SKIP_REASON = "--baseline 을 주지 않아 도구 표면 변경을 비교하지 않았습니다.";
export const LIMITS = [
  "행위 관측(Docker 격리)은 mcpeak audit --sandbox 로 켭니다.",
  "정적 검사는 도구 정의의 글자만 봅니다.",
];
export const RENDERED =
  "mcpeak audit · sample 1.0.0\n\n판정: 심각 1건, 주의 1건, 낮음 0건, 정보 0건\n";

export const DOCKER_MISSING_LINE =
  "행위 관측 안 함: Docker 를 찾을 수 없습니다. 서버는 격리 없이 이 머신에서 실행됐습니다. (설치: https://docs.docker.com/get-docker/)";
export const RAN_LINE =
  "격리 실행: Docker 컨테이너 안에서 서버를 띄웠습니다 · 네트워크 실제 전달 · 이미지 mcpeak-audit:abc";

export const RAN: SandboxReport = {
  status: "ran",
  backend: "docker",
  image: "mcpeak-audit:abc",
  network: "live",
  compareHost: false,
  callCount: 3,
  declaredHosts: ["api.example.com"],
  requests: [
    { host: "api.example.com", port: 443, method: "GET", path: "/v1", count: 2, declared: true },
    { host: "evil.example.net", port: 80, method: "POST", path: "/x", count: 1, declared: false },
  ],
};

export function securityResponse(
  overrides: Partial<AnalyzeSecurityResponse> & {
    readonly findings?: readonly Finding[];
    readonly sandbox?: SandboxReport;
  } = {},
): AnalyzeSecurityResponse {
  const { findings = FINDINGS, sandbox, ...rest } = overrides;
  const report: AuditReport = {
    schemaVersion: 1,
    generator: { name: "@mcpeak/audit", version: "0.0.0" },
    server: {
      name: "sample",
      version: "1.0.0",
      toolCount: 2,
      promptCount: 0,
      resourceCount: 0,
      hasInstructions: false,
      capabilityKeys: ["tools"],
    },
    probe: "readonly",
    probedTools: ["add"],
    ...(sandbox === undefined ? {} : { sandbox }),
    findings,
    skipped: [{ family: "surface", reason: SKIP_REASON }],
    counts: { high: 1, medium: 1, low: 0, info: 0 },
    exitCode: 2,
  };
  return {
    report,
    reportText: `${JSON.stringify(report, null, 2)}\n`,
    rendered: RENDERED,
    views: VIEWS,
    sandboxLine: null,
    limits: LIMITS,
    exitCode: 2,
    cleanupError: "",
    ...rest,
  };
}
