import type { AssertionResult } from "./assertions.js";
import { canonicalJson } from "./canonical.js";
import { clampObservedText, redactByPath } from "./diagnostics.js";
import type { TestCaseResult } from "./executor.js";
import { REDACTED, type RunnerRedactionOptions } from "./sanitization.js";
import type { JsonValue } from "./spec/types.js";

/** 한 회차에서 케이스 하나를 관찰한 것. CLI 래퍼(설계 §5)가 만든다. */
export interface DeterminismCaseObservation {
  readonly caseId: string;
  readonly caseName: string;
  /** callTool 케이스의 툴 이름. listTools 케이스는 null. 케이스 블록 머리글에 쓴다. */
  readonly toolName: string | null;
  readonly status: TestCaseResult["status"];
  readonly assertionStatuses: readonly AssertionResult["status"][];
  /**
   * 캡처한 원본 응답(callTool 의 ToolResult 또는 listTools 의 ToolDef[]).
   * 호출이 오류·타임아웃으로 끝나 응답이 없으면 키를 만들지 않는다.
   */
  readonly response?: unknown;
}

export interface CheckDeterminismOptions {
  readonly first: readonly DeterminismCaseObservation[];
  readonly second: readonly DeterminismCaseObservation[];
  /** `--reset-cmd` 가 지정돼 각 회차 전에 복원이 실행됐는가. 결론 강도(§8)를 가른다. */
  readonly stateRestored: boolean;
  /**
   * 표시 값에 적용할 redaction. 비교는 원본으로 하고 **표시만** 가린다(§6).
   *
   * 가리는 근거는 두 가지다. 차이 지점까지 내려온 **조상 키**(`redactByPath`)와, 값이 객체·배열일
   * 때의 **직속 키**(`sanitizeJsonValue`)다.
   *
   * **가리지 못하는 자리가 있다.** 서버가 결과를 JSON 으로 직렬화해 text 블록 문자열 하나로 싣는
   * 형태(`content[0].text`)가 그렇다. 이때 비밀값은 그 문자열 **안**에 있고 경로상의 키는
   * `text` 뿐이라 키 기반 판정이 닿지 않는다. 남는 방어는 `sensitiveValues` 의 정확 일치뿐인데,
   * 서버가 실행마다 새로 발급하는 값은 미리 알 수 없다. 이 한계는 ADR-0033 의 E3(치환 대신
   * 명시)을 따라 `--determinism` 안내 문구에도 적혀 있어야 한다.
   */
  readonly redaction?: RunnerRedactionOptions;
}

/** 휴리스틱 원인 추정(§6). 확정이 아니라 추정이므로 문장에도 "보입니다" 로 쓴다. */
export type DeterminismHint = "timestamp" | "randomId" | "numericDrift";

export interface DeterminismDifference {
  readonly caseId: string;
  readonly caseName: string;
  /** 케이스 블록 머리글에 쓴다. 관찰의 toolName 을 그대로 옮긴다. */
  readonly toolName: string | null;
  /** 무엇이 달랐나. status 가 다르면 그것만 보고하고 응답 비교는 하지 않는다. */
  readonly kind: "status" | "assertion" | "response";
  /**
   * kind 가 "response" 일 때 첫 차이 지점. 예: "content[0].text". 비교 대상이 원본
   * ToolResult 이므로 경로도 그 형태를 따른다. text 블록 안 JSON 을 파싱해 더 깊이
   * 들어가지 않는다. 파싱하면 공백·키 순서 차이가 흡수돼 바이트 비결정을 놓친다.
   */
  readonly path?: string;
  /** 표시용 값. clampObservedText 를 거친 문자열이다(§6 비교·표시 분리). */
  readonly firstValue: string;
  readonly secondValue: string;
  readonly hint?: DeterminismHint;
}

export interface DeterminismResult {
  /** 비교를 수행한 케이스 수. */
  readonly compared: number;
  /** 양쪽 모두 notRun·cancelled 라 비교에서 제외한 케이스 수. */
  readonly skipped: number;
  readonly differences: readonly DeterminismDifference[];
  /**
   * - "deterministic": 차이 0 + 복원 있음. 결정론성 확인됨.
   * - "consistentWithoutReset": 차이 0 + 복원 없음. "같았다" 까지만 말할 수 있다.
   * - "nondeterministic": 차이 1건 이상. 복원 유무와 무관하게 유효한 신호다.
   */
  readonly conclusion: "deterministic" | "consistentWithoutReset" | "nondeterministic";
}

/** 한쪽에만 존재하는 자리를 나타내는 내부 표지. 공개 API 밖으로 나가지 않는다. */
const MISSING: unique symbol = Symbol("missing");
type MaybeMissing = unknown;

type ValueKind = "missing" | "null" | "boolean" | "number" | "string" | "array" | "object";

const kindOf = (value: MaybeMissing): ValueKind => {
  if (value === MISSING) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const primitive = typeof value;
  if (primitive === "boolean" || primitive === "number" || primitive === "string") return primitive;
  return "object";
};

interface DiffHit {
  readonly path: string;
  /**
   * 루트에서 이 자리까지 내려오며 지난 **객체 키**만 순서대로 모은 것. 배열 인덱스는 넣지 않는다
   * (`diagnostics.ts` 의 `pathKeys` 와 같은 규칙). 표시값 마스킹이 이것을 본다.
   *
   * `path` 를 다시 파싱하지 않고 순회 중에 모으는 이유는, 경로 문자열 형식이 진단마다 다르기
   * 때문이다. 여기는 `content[0].text` 처럼 루트 키에 점이 없고 `pathKeys` 는 `$.a.b` 를 받는다.
   */
  readonly keys: readonly string[];
  readonly first: MaybeMissing;
  readonly second: MaybeMissing;
}

/**
 * 두 값을 병행 순회해 첫 차이 지점을 찾는다. 순회 순서는 정렬된 객체 키, 배열 인덱스 순으로
 * canonicalJson 의 직렬화 순서와 같다. **재귀를 쓰지 않는다.** canonical.ts 가 깊이 1500
 * 입력에서 재귀로 죽은 전례가 있고, 여기도 같은 입력을 받는다(설계 §4.2).
 */
const findFirstDifference = (firstRoot: unknown, secondRoot: unknown): DiffHit | null => {
  type Frame = {
    readonly first: MaybeMissing;
    readonly second: MaybeMissing;
    readonly path: string;
    readonly keys: readonly string[];
  };
  const frames: Frame[] = [{ first: firstRoot, second: secondRoot, path: "", keys: [] }];
  while (frames.length > 0) {
    const frame = frames.pop();
    if (frame === undefined) break;
    const { first, second, path, keys: ancestorKeys } = frame;
    const firstKind = kindOf(first);
    if (firstKind !== kindOf(second)) return { path, keys: ancestorKeys, first, second };
    if (firstKind === "missing" || firstKind === "null") continue;
    if (firstKind === "boolean" || firstKind === "number" || firstKind === "string") {
      if (!Object.is(first, second)) return { path, keys: ancestorKeys, first, second };
      continue;
    }
    // LIFO 스택이므로 뒤 자식부터 push 해야 앞 자식을 먼저 방문한다.
    if (firstKind === "array") {
      const left = first as readonly unknown[];
      const right = second as readonly unknown[];
      const longest = Math.max(left.length, right.length);
      for (let index = longest - 1; index >= 0; index -= 1) {
        frames.push({
          first: index < left.length ? left[index] : MISSING,
          second: index < right.length ? right[index] : MISSING,
          path: `${path}[${index}]`,
          keys: ancestorKeys,
        });
      }
      continue;
    }
    const left = first as Record<string, unknown>;
    const right = second as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      if (key === undefined) continue;
      frames.push({
        first: Object.hasOwn(left, key) ? left[key] : MISSING,
        second: Object.hasOwn(right, key) ? right[key] : MISSING,
        path: path === "" ? key : `${path}.${key}`,
        keys: [...ancestorKeys, key],
      });
    }
  }
  return null;
};

/**
 * 표시용 문자열. 비교는 원본으로 하고 표시만 가리고 자른다(설계 §6).
 *
 * **마스킹이 `canonicalJson` 보다 먼저다.** 순서를 뒤집으면 값이 문자열 한 덩어리가 되면서 키
 * 정보가 사라져, 키로 판정하는 `sanitizeJsonValue` 가 아무것도 못 집는다. `sensitiveValues` 도
 * 마찬가지다. `canonicalJson("s-1")` 은 따옴표가 붙은 `"s-1"` 이라 원래 값과 더는 같지 않다.
 *
 * 가려진 값은 따옴표 없이 `[REDACTED]` 로 적는다. 이것은 서버가 돌려준 값이 아니라 자리를
 * 가렸다는 표지이고, 따옴표를 붙이면 값이 실제로 그 문자열이었던 것처럼 읽힌다.
 */
const formatValue = (
  value: MaybeMissing,
  keys: readonly string[],
  redaction?: RunnerRedactionOptions,
): string => {
  if (value === MISSING) return "(없음)";
  const safe = redactByPath(value as JsonValue, keys, redaction);
  if (safe === REDACTED) return REDACTED;
  return clampObservedText(canonicalJson(safe), redaction);
};

/** 마스크가 본문과 겹칠 때 덧붙이는 문자. 비문자라 서버 본문에 나올 일이 거의 없다. */
const MASK_FILLER = "\uFFFF";

/**
 * §6 휴리스틱. 패턴은 **앵커 없이** 찾는다 — 실서버는 결과를 JSON 으로 만들어 text 블록에
 * 문자열로 감싸 보내는 것이 기본이고, 그러면 비교 지점이 값 하나가 아니라 JSON 전문 한
 * 덩어리다(#293). 앵커를 걸면 그 기본 형태에서 힌트가 통째로 죽는다.
 *
 * 넓힌 만큼 판정은 좁혔다. "패턴이 있다"(`test`)가 아니라 **뽑은 자리 값이 실제로 달라졌는가**
 * 를 본다. 부분 일치로 `test` 만 하면 숫자를 품은 모든 JSON 이 numericDrift 가 되고, 시간은
 * 그대로인데 옆자리가 변한 응답이 "시간 의존" 으로 오귀속된다.
 *
 * `mask` 는 앞 패턴이 집은 자리를 뒤 패턴에서 가린다. 안 가리면 숫자 패턴이 타임스탬프·UUID
 * 안의 숫자를 다시 집는다. 우선순위는 배열 순서다.
 */
const HINT_PATTERNS = [
  {
    hint: "timestamp",
    pattern: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g,
    mask: "\uFFFFt",
  },
  {
    hint: "randomId",
    pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    mask: "\uFFFFr",
  },
  { hint: "numericDrift", pattern: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, mask: "\uFFFFn" },
] as const satisfies readonly {
  readonly hint: DeterminismHint;
  readonly pattern: RegExp;
  readonly mask: string;
}[];

/**
 * 두 문자열의 차이를 패턴 하나로 설명할 수 있으면 그 이름을 낸다.
 *
 * 마스크가 비문자 U+FFFF 로 시작하는 것은 서버 본문과 겹치지 않기 위해서다. 다만 시작 문자만으로는
 * 모자란다 — 그 토큰이 실제로 본문에 실려 있으면 마스킹한 두 문자열이 우연히 같아져 없는 원인을
 * 지목한다. 그래서 치환 전에 **양쪽 본문에 없는 토큰이 될 때까지** 늘린다. 문자열이 유한하므로
 * 늘리기는 반드시 끝난다.
 *
 * `match`·`replace` 는 g 플래그 정규식의 `lastIndex` 를 매번 0 으로 되돌리므로 모듈 상수를
 * 공유해도 호출 순서에 결과가 걸리지 않는다. 결정론성이 핵심 가치라 기대는 성질을 적어 둔다.
 */
const detectStringHint = (first: string, second: string): DeterminismHint | undefined => {
  let left = first;
  let right = second;
  let hint: DeterminismHint | undefined;
  for (const candidate of HINT_PATTERNS) {
    const leftHits = left.match(candidate.pattern) ?? [];
    const rightHits = right.match(candidate.pattern) ?? [];
    let mask = candidate.mask;
    while (left.includes(mask) || right.includes(mask)) mask += MASK_FILLER;
    // 후보로 잡지 않은 패턴도 가린다. 뒤 패턴이 이 자리를 다시 집는 것을 막는 것이 목적이다.
    left = left.replace(candidate.pattern, mask);
    right = right.replace(candidate.pattern, mask);
    if (hint !== undefined) continue;
    // 자리 수가 다르면 값이 대응되지 않는다. 정렬을 추정하지 않고 이 패턴은 넘긴다.
    if (leftHits.length !== rightHits.length) continue;
    if (leftHits.some((value, index) => value !== rightHits[index])) hint = candidate.hint;
  }
  // 패턴을 모두 가린 뒤에도 다르면 패턴 밖 무언가가 함께 변했다는 뜻이다. 그때는 원인을 단정하지
  // 않는다 — 짚어준 값을 고쳐도 여전히 다르면 안내가 사용자를 엉뚱한 곳으로 보낸다.
  return left === right ? hint : undefined;
};

const detectHint = (first: MaybeMissing, second: MaybeMissing): DeterminismHint | undefined => {
  if (typeof first === "string" && typeof second === "string")
    return detectStringHint(first, second);
  // MCP text content 는 언제나 string 이지만 structuredContent·listTools 는 숫자를 그대로 싣는다.
  if (typeof first === "number" && typeof second === "number") return "numericDrift";
  return undefined;
};

const firstAssertionMismatch = (
  first: readonly string[],
  second: readonly string[],
): number | null => {
  const longest = Math.max(first.length, second.length);
  for (let index = 0; index < longest; index += 1) if (first[index] !== second[index]) return index;
  return null;
};

export function checkDeterminism(options: CheckDeterminismOptions): DeterminismResult {
  const { first, second, stateRestored, redaction } = options;
  if (first.length !== second.length)
    throw new Error(
      `관찰한 케이스 수가 다릅니다: 1회차 ${first.length}개, 2회차 ${second.length}개. ` +
        "같은 스위트를 두 번 실행했다면 일어날 수 없는 일입니다.",
    );
  let compared = 0;
  let skipped = 0;
  const differences: DeterminismDifference[] = [];
  for (let index = 0; index < first.length; index += 1) {
    const left = first[index];
    const right = second[index];
    if (left === undefined || right === undefined) continue; // 길이 검사로 도달 불가. 인덱스 접근 방어.
    const excluded = left.status === "notRun" || left.status === "cancelled";
    if (left.status === right.status && excluded) {
      skipped += 1;
      continue;
    }
    compared += 1;
    const identity = { caseId: left.caseId, caseName: left.caseName, toolName: left.toolName };
    if (left.status !== right.status) {
      differences.push({
        ...identity,
        kind: "status",
        firstValue: left.status,
        secondValue: right.status,
      });
      continue;
    }
    const mismatch = firstAssertionMismatch(left.assertionStatuses, right.assertionStatuses);
    if (mismatch !== null) {
      differences.push({
        ...identity,
        kind: "assertion",
        path: `assertions[${mismatch}]`,
        firstValue: left.assertionStatuses[mismatch] ?? "(없음)",
        secondValue: right.assertionStatuses[mismatch] ?? "(없음)",
      });
      continue;
    }
    const leftHas = left.response !== undefined;
    const rightHas = right.response !== undefined;
    if (leftHas !== rightHas) {
      differences.push({
        ...identity,
        kind: "response",
        firstValue: leftHas ? formatValue(left.response, [], redaction) : "(응답 없음)",
        secondValue: rightHas ? formatValue(right.response, [], redaction) : "(응답 없음)",
      });
      continue;
    }
    if (!leftHas) continue;
    if (canonicalJson(left.response) === canonicalJson(right.response)) continue;
    const hit = findFirstDifference(left.response, right.response);
    if (hit === null)
      throw new Error(
        "정규화 결과가 다른데 차이 지점을 찾지 못했습니다. determinism.ts 의 결함입니다.",
      );
    const hint = detectHint(hit.first, hit.second);
    differences.push({
      ...identity,
      kind: "response",
      path: hit.path === "" ? "(루트)" : hit.path,
      firstValue: formatValue(hit.first, hit.keys, redaction),
      secondValue: formatValue(hit.second, hit.keys, redaction),
      ...(hint !== undefined ? { hint } : {}),
    });
  }
  return {
    compared,
    skipped,
    differences,
    conclusion:
      differences.length > 0
        ? "nondeterministic"
        : stateRestored
          ? "deterministic"
          : "consistentWithoutReset",
  };
}

/**
 * 차이 1건을 사람 문장으로. 설계 §8의 케이스 블록 형식을 만든다. status 차이의 안내 문장이
 * 복원 유무로 갈리므로(§8) stateRestored 를 받는다.
 */
export function describeDeterminismDifference(
  difference: DeterminismDifference,
  options: { readonly stateRestored: boolean },
): string {
  const header =
    difference.toolName === null
      ? `  ${difference.caseName} (${difference.caseId})`
      : `  ${difference.toolName} / ${difference.caseName} (${difference.caseId})`;
  if (difference.kind === "status") {
    const guidance = options.stateRestored
      ? "  → 상태를 복원하고도 판정이 갈렸으므로, 서버가 같은 입력에 다른 판정을 냈습니다."
      : "  → 이 케이스는 이전 실행이 남긴 상태에 의존할 수 있습니다. --reset-cmd 로 상태를\n" +
        "    복원하거나, 상태 비의존 케이스로 바꾸세요.";
    return [
      header,
      `  → 판정이 다릅니다: 1회차 ${difference.firstValue}, 2회차 ${difference.secondValue}`,
      guidance,
    ].join("\n");
  }
  const lines = [
    header,
    `  → 다른 지점: ${difference.path ?? "(응답 유무)"}`,
    `     1회차: ${difference.firstValue}`,
    `     2회차: ${difference.secondValue}`,
  ];
  if (difference.kind === "assertion")
    lines.push("  → 같은 판정 절차가 다른 결과를 냈습니다. 응답이 실행마다 달라졌는지 확인하세요.");
  else if (difference.hint === "timestamp")
    lines.push("  → 시간 의존으로 보입니다. 이 값은 실행마다 바뀌므로 단언 기준이 될 수 없습니다.");
  else if (difference.hint === "randomId")
    lines.push("  → 실행마다 새로 발급되는 식별자로 보입니다. 이 값은 단언 기준이 될 수 없습니다.");
  else if (difference.hint === "numericDrift")
    lines.push("  → 측정값 변동으로 보입니다. 이 값은 단언 기준이 될 수 없습니다.");
  return lines.join("\n");
}
