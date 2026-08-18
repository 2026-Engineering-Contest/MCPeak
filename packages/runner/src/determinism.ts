import type { AssertionResult } from "./assertions.js";
import { canonicalJson } from "./canonical.js";
import { clampObservedText } from "./diagnostics.js";
import type { TestCaseResult } from "./executor.js";
import type { RunnerRedactionOptions } from "./sanitization.js";

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
  /** 표시 값에 적용할 redaction. `clampObservedText` 에 그대로 넘긴다. */
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
  };
  const frames: Frame[] = [{ first: firstRoot, second: secondRoot, path: "" }];
  while (frames.length > 0) {
    const frame = frames.pop();
    if (frame === undefined) break;
    const { first, second, path } = frame;
    const firstKind = kindOf(first);
    if (firstKind !== kindOf(second)) return { path, first, second };
    if (firstKind === "missing" || firstKind === "null") continue;
    if (firstKind === "boolean" || firstKind === "number" || firstKind === "string") {
      if (!Object.is(first, second)) return { path, first, second };
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
      });
    }
  }
  return null;
};

/** 표시용 문자열. 비교는 원본으로 하고 표시만 자른다(설계 §6). */
const formatValue = (value: MaybeMissing, redaction?: RunnerRedactionOptions): string =>
  value === MISSING ? "(없음)" : clampObservedText(canonicalJson(value), redaction);

/** §6 휴리스틱. 양쪽 모두 패턴에 맞을 때만 힌트를 단다. 넓히지 않는다. */
const TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const detectHint = (first: MaybeMissing, second: MaybeMissing): DeterminismHint | undefined => {
  if (typeof first === "string" && typeof second === "string") {
    if (TIMESTAMP_PATTERN.test(first) && TIMESTAMP_PATTERN.test(second)) return "timestamp";
    if (UUID_PATTERN.test(first) && UUID_PATTERN.test(second)) return "randomId";
    return undefined;
  }
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
        firstValue: leftHas ? formatValue(left.response, redaction) : "(응답 없음)",
        secondValue: rightHas ? formatValue(right.response, redaction) : "(응답 없음)",
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
      firstValue: formatValue(hit.first, redaction),
      secondValue: formatValue(hit.second, redaction),
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
