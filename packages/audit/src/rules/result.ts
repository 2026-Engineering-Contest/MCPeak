import { normalizeTextWithSources } from "../text/normalize.js";
import type { CollectedString, Finding, Location, RuleInfo } from "../types.js";
import {
  COVERT_ACTION_PATTERNS,
  evidenceFragment,
  findAnsiEscape,
  findHiddenCharacters,
  findInjection,
  type PatternHit,
  SHADOWING_PATTERNS,
} from "./description.js";

export const RESULT_RULES: readonly RuleInfo[] = [
  {
    id: "result/injection",
    family: "result",
    defaultSeverity: "high",
    summary: "호출 응답에 모델 지시(injection·covert-action·shadowing 문형)가 있다",
  },
  {
    id: "result/hidden-unicode",
    family: "result",
    defaultSeverity: "medium",
    summary: "호출 응답에 보이지 않는 문자(zero-width·bidi·tag)가 있다",
  },
  {
    id: "result/ansi-escape",
    family: "result",
    defaultSeverity: "high",
    summary: "호출 응답에 터미널 제어 문자(ANSI 이스케이프)가 있다",
  },
  {
    id: "result/oversized",
    family: "result",
    defaultSeverity: "medium",
    summary: "호출 응답이 메시지 상한의 절반을 넘는다",
  },
  {
    id: "result/unavailable",
    family: "result",
    defaultSeverity: "info",
    summary: "호출이 제한 시간 안에 끝나지 않았거나 전송 오류로 실패했다",
  },
];

/** 도구 호출 하나의 제한 시간(§3.7). `audit` 가 이 값으로 호출을 끊고, 메시지도 이 값을 쓴다. */
export const CALL_TIMEOUT_MS = 10_000;

/** 호출 하나의 결과. `raw` 는 tools/call 의 result 객체 그대로다(`isError` 응답 포함). */
export interface ToolCallResult {
  readonly toolIndex: number;
  readonly toolName: string;
  readonly raw: unknown;
  readonly outcome: "ok" | "timeout" | "error";
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * 값 아래의 모든 문자열(값과 키 이름)을 문서 순서로 모은다. 키 이름에는 `(key)` 를 붙인다(§3.0.2).
 * 재귀 대신 스택이라 서버가 보낸 깊은 중첩이 호출 스택을 넘기지 못한다.
 */
function walkStrings(
  root: unknown,
  rootPath: string,
  location: (path: string) => Location,
  out: CollectedString[],
): void {
  const stack: { value: unknown; path: string; key?: boolean }[] = [
    { value: root, path: rootPath },
  ];
  while (stack.length > 0) {
    const { value, path, key } = stack.pop() as { value: unknown; path: string; key?: boolean };
    if (typeof value === "string") {
      out.push({ location: location(path), raw: value, isKey: key === true });
      continue;
    }
    const children: { value: unknown; path: string; key?: boolean }[] = [];
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        children.push({ value: item, path: `${path}[${index}]` });
      });
    } else if (isObject(value)) {
      for (const [name, child] of Object.entries(value)) {
        const childPath = path === "" ? name : `${path}.${name}`;
        children.push({ value: name, path: `${childPath}(key)`, key: true });
        children.push({ value: child, path: childPath });
      }
    }
    for (let index = children.length - 1; index >= 0; index -= 1)
      stack.push(children[index] as { value: unknown; path: string; key?: boolean });
  }
}

/**
 * 호출 응답에서 모델이 읽는 문자열(§3.0.2 의 "응답" 행). `content[i].text`, `structuredContent` 안의
 * 모든 문자열, `isError` 응답이면 응답 전체의 모든 문자열. 계획서 표에 더해 내장 리소스의
 * `content[i].resource.text` 도 모은다. 모델 컨텍스트에 그대로 실리는 본문이기 때문이다.
 * 끝나지 않은 호출(`timeout`·`error`)에는 응답이 없다.
 */
export function collectResultStrings(results: readonly ToolCallResult[]): CollectedString[] {
  const out: CollectedString[] = [];
  for (const result of results) {
    if (result.outcome !== "ok" || !isObject(result.raw)) continue;
    const { raw, toolIndex, toolName } = result;
    const location = (path: string): Location => ({ kind: "result", toolIndex, toolName, path });
    if (raw.isError === true) {
      walkStrings(raw, "", location, out);
      continue;
    }
    if (Array.isArray(raw.content))
      raw.content.forEach((item, index) => {
        if (!isObject(item)) return;
        if (typeof item.text === "string")
          out.push({ location: location(`content[${index}].text`), raw: item.text, isKey: false });
        if (isObject(item.resource) && typeof item.resource.text === "string")
          out.push({
            location: location(`content[${index}].resource.text`),
            raw: item.resource.text,
            isKey: false,
          });
      });
    if ("structuredContent" in raw)
      walkStrings(raw.structuredContent, "structuredContent", location, out);
  }
  return out;
}

const caseInsensitive = (pattern: RegExp) =>
  pattern.flags.includes("i") ? pattern : new RegExp(pattern.source, `${pattern.flags}i`);

const OTHER_INSTRUCTIONS = [...COVERT_ACTION_PATTERNS, ...SHADOWING_PATTERNS];
const OTHER_INSTRUCTIONS_RAW = OTHER_INSTRUCTIONS.map(caseInsensitive);

/**
 * §3.7 `result/injection` 의 판정: desc 의 injection·covert-action·shadowing 문형. injection 은
 * T1 의 `findInjection` 이 모든 형을 본다. 나머지 둘은 같은 형 순서로 대조하고, 문형이 소문자
 * 기준이라 raw 에는 대소문자 무시 사본을 댄다(protocol.ts 의 server-request-injection 과 같은 방식).
 */
function findInstruction(raw: string): PatternHit | undefined {
  const injection = findInjection(raw);
  if (injection !== undefined) return injection;
  for (const entry of normalizeTextWithSources(raw)) {
    const patterns = entry.form === "raw" ? OTHER_INSTRUCTIONS_RAW : OTHER_INSTRUCTIONS;
    let best: RegExpExecArray | undefined;
    for (const pattern of patterns) {
      const match = pattern.exec(entry.text);
      if (match !== null && (best === undefined || match.index < best.index)) best = match;
    }
    if (best !== undefined) return { form: entry.form, fragment: best[0] };
  }
  return undefined;
}

/** result/hidden-unicode 가 보는 범주. confusable-space·variation 은 응답 본문에서 흔해 보지 않는다(§3.7). */
const RESULT_HIDDEN = new Set(["zero-width", "bidi", "tag"]);

const codePointLabel = (codePoint: number) =>
  `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;

function stringFindings(entry: CollectedString): Finding[] {
  const findings: Finding[] = [];
  const instruction = findInstruction(entry.raw);
  if (instruction !== undefined) {
    const fragment = evidenceFragment(instruction.fragment);
    findings.push({
      ruleId: "result/injection",
      severity: "high",
      location: entry.location,
      message: `호출 응답에 모델 지시가 있습니다: "${fragment}"`,
      fix: "응답으로 모델을 조종하는 수법입니다(ATPA). 등록하지 마세요.",
      evidence: [fragment, instruction.form],
    });
  }
  const hidden = findHiddenCharacters(entry.raw).filter(({ category }) =>
    RESULT_HIDDEN.has(category),
  );
  if (hidden.length > 0) {
    const labels = hidden.map(({ codePoint }) => codePointLabel(codePoint));
    const shown = labels.length > 5 ? [...labels.slice(0, 5), "…"] : labels;
    findings.push({
      ruleId: "result/hidden-unicode",
      severity: "medium",
      location: entry.location,
      message: `호출 응답에 보이지 않는 문자 ${shown.join(", ")} 가 있습니다`,
      fix: "응답 안의 숨은 글자는 사람에게 안 보입니다. 서버 작성자에게 알리세요.",
      evidence: hidden.map(
        ({ codePoint, category }) => `${codePointLabel(codePoint)} (${category})`,
      ),
    });
  }
  const ansi = findAnsiEscape(entry.raw);
  if (ansi !== undefined)
    findings.push({
      ruleId: "result/ansi-escape",
      severity: "high",
      location: entry.location,
      message: "호출 응답에 터미널 제어 문자가 있습니다",
      fix: "터미널에서 글자를 숨기는 수법입니다.",
      evidence: [evidenceFragment(ansi)],
    });
  return findings;
}

const UNAVAILABLE_FIX = "멈추는 서버는 통과가 아니라 발견입니다. 서버 로그를 확인하세요.";

/** 호출 하나 전체에 대한 발견(응답 크기, 끝나지 않은 호출). 위치 path 는 "" 다. */
function callFindings(result: ToolCallResult, maxMessageBytes: number): Finding[] {
  const location: Location = {
    kind: "result",
    toolIndex: result.toolIndex,
    toolName: result.toolName,
    path: "",
  };
  if (result.outcome === "timeout")
    return [
      {
        ruleId: "result/unavailable",
        severity: "info",
        location,
        message: `호출이 ${CALL_TIMEOUT_MS}ms 안에 끝나지 않았습니다`,
        fix: UNAVAILABLE_FIX,
        evidence: ["timeout"],
      },
    ];
  if (result.outcome === "error")
    return [
      {
        ruleId: "result/unavailable",
        severity: "info",
        location,
        // §6.2 의 문안은 타임아웃 하나뿐이다. 전송 오류에 "끝나지 않았습니다(<n>ms)" 를 쓰면 즉시
        // 실패한 호출을 오래 기다린 것처럼 말하게 되어, 원인만 바꾼 문장을 쓴다.
        message: "호출이 응답 없이 끝났습니다(전송 오류)",
        fix: UNAVAILABLE_FIX,
        evidence: ["error"],
      },
    ];
  const bytes = Buffer.byteLength(JSON.stringify(result.raw) ?? "", "utf8");
  if (bytes > maxMessageBytes / 2)
    return [
      {
        ruleId: "result/oversized",
        severity: "medium",
        location,
        message: `호출 응답이 ${bytes} 바이트입니다`,
        fix: "컨텍스트를 소진시킵니다. 페이지네이션이나 요약을 요구하세요.",
        evidence: [`${bytes}`],
      },
    ];
  return [];
}

export function runResultRules(
  results: readonly ToolCallResult[],
  maxMessageBytes: number,
): Finding[] {
  return results.flatMap((result) => [
    ...callFindings(result, maxMessageBytes),
    ...collectResultStrings([result]).flatMap(stringFindings),
  ]);
}
