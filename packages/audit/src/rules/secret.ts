import type { CollectedString, Finding, RuleInfo, TextForm } from "../types.js";

export const SECRET_RULES: readonly RuleInfo[] = [
  {
    id: "secret/env-leak",
    family: "secret",
    defaultSeverity: "high",
    summary: "환경변수에 심은 카나리 값이 서버가 내보낸 문자열에 나오는지 본다.",
  },
  {
    id: "secret/env-echo",
    family: "secret",
    defaultSeverity: "high",
    summary: "사용자가 전달한 환경변수의 실제 값이 서버가 내보낸 문자열에 나오는지 본다.",
  },
  {
    id: "secret/env-name-in-description",
    family: "secret",
    defaultSeverity: "info",
    summary: "도구 설명이 비밀 환경변수 이름을 언급하는지 알린다.",
  },
] as const;

/** 카나리를 심는 환경변수 이름. 순서가 곧 `CanaryPlan.names` 의 순서다. */
const CANARY_NAMES = [
  "GITHUB_TOKEN",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_ACCESS_KEY_ID",
  "SLACK_TOKEN",
  "SLACK_BOT_TOKEN",
  "NOTION_TOKEN",
  "DATABASE_URL",
  "STRIPE_SECRET_KEY",
  "NPM_TOKEN",
  "GOOGLE_APPLICATION_CREDENTIALS",
] as const;

const CANARY_PREFIX = "MCPEAK_CANARY_";

/** 이 길이 미만의 전달 값은 우연히 겹치기 쉬워 env-echo 대상에서 뺀다. */
const ECHO_MIN_LENGTH = 8;

export interface CanaryPlan {
  readonly env: Readonly<Record<string, string>>;
  readonly names: readonly string[];
}

/**
 * 카나리 계획. `random` 은 16자 소문자 hex 를 낸다(CLI 는 `crypto.randomBytes(8)`). 값은 출력에
 * 절대 쓰지 않으므로 무작위여도 결정론을 깨지 않는다.
 */
export function planCanaries(
  forwardedEnvNames: readonly string[],
  random: () => string,
): CanaryPlan {
  const forwarded = new Set(forwardedEnvNames);
  const names = CANARY_NAMES.filter((name) => !forwarded.has(name));
  const env: Record<string, string> = {};
  const used = new Set<string>();
  for (const name of names) {
    const value = `${CANARY_PREFIX}${random()}`;
    if (used.has(value)) {
      throw new Error(
        "random() 이 같은 카나리 값을 두 번 냈습니다. 어느 이름의 값이 샜는지 가리려면 카나리 값은 이름마다 달라야 합니다.",
      );
    }
    used.add(value);
    env[name] = value;
  }
  return { env, names };
}

interface Needle {
  readonly form: Exclude<TextForm, "folded">;
  readonly text: string;
  readonly caseInsensitive: boolean;
}

function rot13(text: string): string {
  return text.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

/**
 * 값이 더 긴 문자열 안에서 base64 로 인코딩됐을 때 반드시 나타나는 부분들. 앞에 붙은 바이트 수
 * (0·1·2, 3 으로 나눈 나머지)에 따라 정렬이 달라지므로 셋 다 만든다. 각 경우 앞쪽 바이트와 섞인
 * 글자, 뒤쪽 미지의 바이트와 섞이는 글자를 잘라 낸 가운데만 쓴다.
 */
function base64Cores(value: string): string[] {
  const bytes = Buffer.from(value, "utf8");
  const cores: string[] = [];
  for (const offset of [0, 1, 2]) {
    const encoded = Buffer.concat([Buffer.alloc(offset), bytes]).toString("base64");
    const start = offset === 0 ? 0 : Math.floor((8 * offset - 1) / 6) + 1;
    const end = Math.floor((8 * (offset + bytes.length)) / 6);
    const core = encoded.slice(start, end);
    cores.push(core, core.replace(/\+/g, "-").replace(/\//g, "_"));
  }
  return [...new Set(cores)];
}

/** §3.1 의 raw·base64·hex·rot13 형. 설명문을 디코딩하지 않고 값 쪽을 인코딩해 찾는다. */
function needlesFor(value: string): Needle[] {
  return [
    { form: "raw", text: value, caseInsensitive: true },
    ...base64Cores(value).map((text) => ({
      form: "base64" as const,
      text,
      caseInsensitive: false,
    })),
    { form: "hex", text: Buffer.from(value, "utf8").toString("hex"), caseInsensitive: true },
    { form: "rot13", text: rot13(value), caseInsensitive: true },
  ];
}

function findForm(haystack: string, needles: readonly Needle[]): Needle["form"] | undefined {
  const lower = haystack.toLowerCase();
  for (const needle of needles) {
    const found = needle.caseInsensitive
      ? lower.includes(needle.text.toLowerCase())
      : haystack.includes(needle.text);
    if (found) return needle.form;
  }
  return undefined;
}

function isToolDescription(item: CollectedString): boolean {
  return (
    item.location.kind === "tool" &&
    !item.isKey &&
    (item.location.path === "description" || item.location.path.endsWith(".description"))
  );
}

function mentions(text: string, name: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(text);
}

export function runSecretRules(
  strings: readonly CollectedString[],
  plan: CanaryPlan,
  forwarded: Readonly<Record<string, string>>,
): Finding[] {
  const canaries = plan.names.flatMap((name) => {
    const value = plan.env[name];
    return value === undefined ? [] : [{ name, needles: needlesFor(value) }];
  });
  const echoes = Object.keys(forwarded)
    .sort()
    .flatMap((name) => {
      const value = forwarded[name] ?? "";
      return value.length < ECHO_MIN_LENGTH ? [] : [{ name, needles: needlesFor(value) }];
    });
  const mentionable = [...new Set([...plan.names, ...Object.keys(forwarded)])].sort();

  const findings: Finding[] = [];
  for (const item of strings) {
    for (const canary of canaries) {
      const form = findForm(item.raw, canary.needles);
      if (form === undefined) continue;
      findings.push({
        ruleId: "secret/env-leak",
        severity: "high",
        location: item.location,
        message: `환경변수 ${canary.name} 에 심은 값이 응답에 나왔습니다`,
        fix: "서버가 환경변수를 읽어 밖으로 냅니다. 등록하지 마세요.",
        evidence: [`<canary:${canary.name}>`, form],
      });
    }
    for (const echo of echoes) {
      const form = findForm(item.raw, echo.needles);
      if (form === undefined) continue;
      findings.push({
        ruleId: "secret/env-echo",
        severity: "high",
        location: item.location,
        message: `전달한 환경변수 ${echo.name} 의 값이 응답에 나왔습니다`,
        fix: "비밀이 모델 컨텍스트와 로그에 실립니다. 서버가 값을 되돌리지 않게 고치거나 등록하지 마세요.",
        evidence: [`<redacted:${echo.name}>`, form],
      });
    }
    if (isToolDescription(item)) {
      for (const name of mentionable) {
        if (!mentions(item.raw, name)) continue;
        findings.push({
          ruleId: "secret/env-name-in-description",
          severity: "info",
          location: item.location,
          message: `설명이 환경변수 ${name} 을 언급합니다`,
          fix: "설정 안내라면 정상입니다.",
          evidence: [name],
        });
      }
    }
  }
  return sortAndDedupe(findings);
}

function toolIndexOf(finding: Finding): number {
  const location = finding.location;
  return location.kind === "tool" || location.kind === "result" ? location.toolIndex : -1;
}

/**
 * §3.0 의 정렬·중복 제거. 비교는 코드 단위 순서다(로캘 비의존). 키에 위치 종류를 넣어
 * 서로 다른 프롬프트·리소스의 같은 path 가 하나로 합쳐지지 않게 한다.
 */
function sortAndDedupe(findings: readonly Finding[]): Finding[] {
  const seen = new Set<string>();
  const unique = findings.filter((f) => {
    const key = JSON.stringify([f.ruleId, f.location, f.evidence[0] ?? ""]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.sort((a, b) => {
    const byTool = toolIndexOf(a) - toolIndexOf(b);
    if (byTool !== 0) return byTool;
    for (const [x, y] of [
      [a.ruleId, b.ruleId],
      [a.location.path, b.location.path],
      [a.evidence[0] ?? "", b.evidence[0] ?? ""],
    ] as const) {
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  });
}
