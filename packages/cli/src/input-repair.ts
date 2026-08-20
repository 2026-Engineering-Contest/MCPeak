import type { ToolDef } from "@mcpeak/core";
import type { JsonValue, TestSuiteSpec } from "@mcpeak/runner";
import type { ReviewIO } from "./generate-command.js";
import type { RepairAttempt, RepairTarget } from "./repair-target.js";

/**
 * 교정 대상 케이스의 입력값을 사람에게 받아 고치고 다시 실행한다.
 * 단계 구조는 설계 문서 §4.1, 사람 입력은 §4.5, 값 재사용은 §4.6, 되돌리기는 §4.7 이다.
 * 화면 문안은 §8.6, §8.6.1, §8.6.2, §8.6.3 이 전량 고정한다. 문장을 새로 만들지 않는다.
 *
 * 서버를 직접 부르지 않는다. 재실행과 AI 제안은 호출 측이 넘긴 함수다.
 */

type Input = Readonly<Record<string, JsonValue>>;

export interface RepairOutcome {
  readonly caseId: string;
  /** 통과로 끝났는가. false 면 값이 되돌려진 상태다. */
  readonly repaired: boolean;
  /** 통과한 경우의 최종 입력값. repaired 가 false 면 undefined 다. */
  readonly input?: Input;
  /** 시도 이력. 분류 화면이 쓴다. 순서는 시도 순이다. */
  readonly attempts: readonly RepairAttempt[];
}

export interface RepairInputsOptions {
  readonly io: ReviewIO;
  readonly suite: TestSuiteSpec;
  readonly targets: readonly RepairTarget[];
  /** 케이스 하나를 다시 실행한다. 호출 측이 runDryRun 을 감싸 넘긴다. */
  readonly rerun: (
    caseId: string,
    input: Input,
  ) => Promise<{ readonly passed: boolean; readonly detail: string }>;
  /** AI 제안. 없으면 사람 입력만 쓴다. */
  readonly propose?: (target: RepairTarget) => Promise<Input | undefined>;
  /** 입력 스키마. 타입 검사에 쓴다. 툴 이름으로 찾는다. */
  readonly tools: readonly ToolDef[];
}

/** 케이스 머리글 들여쓰기. 분류 화면(§8.3)과 같은 값이라 번호가 이어 읽힌다. */
const HEAD = "  ";
/** 본문 들여쓰기. 설계 문서 §8.6 의 모든 본문 줄이 이 폭이다. */
const BODY = "      ";

/**
 * 교정 대상의 실패 사유는 항상 이 한 줄이다. 대상 판별이 `isError` 단언의 `expected` 가
 * true 가 아닌 실패만 통과시키므로(§4.2), 진단 문장이 이것 말고 나올 수 없다.
 * `RepairTarget` 이 `detail` 을 나르지 않아 여기서 다시 적는다.
 */
const FAILURE_LINE = `${BODY}isError  정상 응답을 기대했지만 오류 응답을 받았습니다.`;

const PROPOSED_LEAD = `${BODY}입력값이 거절된 것으로 보입니다. 서버 응답에서 값을 찾았습니다.`;
const MANUAL_LEAD = `${BODY}입력값이 거절된 것으로 보입니다. 서버 응답에 쓸 만한 값이 없어 직접 받습니다.`;
const RERUN_LINE = `${BODY}▸ 다시 실행 중... 1건`;
const PASSED_LINE = `${BODY}✓ 통과`;
const EXHAUSTED_LINE = `${BODY}✗ 여전히 실패합니다. 입력값 문제가 아닐 수 있습니다.`;

/** JSON Schema 가 부르는 타입 이름. 값에서 뽑아 선언과 맞춰 본다. */
const jsonTypeOf = (value: JsonValue): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
};

/**
 * 선언 타입과 값이 맞는가. 선언이 없으면 검사하지 않는다(§4.5).
 * `integer` 는 `number` 의 부분집합이라 정수 여부까지 본다.
 */
const matchesDeclaredType = (declared: string | undefined, value: JsonValue): boolean => {
  if (declared === undefined) return true;
  if (declared === "integer") return typeof value === "number" && Number.isInteger(value);
  if (declared === "number") return typeof value === "number";
  return jsonTypeOf(value) === declared;
};

const plainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * 툴 선언에서 필드의 `type` 을 읽는다. 스키마는 서버가 주는 값이라 `unknown` 이다.
 * 우리가 아는 모양이 아니면 선언이 없는 것으로 본다. 추측해서 되묻으면 사람이 못 넘어간다.
 */
const declaredTypeOf = (
  tools: readonly ToolDef[],
  tool: string,
  field: string,
): string | undefined => {
  const schema = tools.find((candidate) => candidate.name === tool)?.inputSchema;
  if (!plainObject(schema)) return undefined;
  const properties = schema.properties;
  if (!plainObject(properties)) return undefined;
  const declared = properties[field];
  if (!plainObject(declared)) return undefined;
  return typeof declared.type === "string" ? declared.type : undefined;
};

/**
 * 사람이 친 글을 값으로 바꾼다. JSON 으로 읽어 보고 안 되면 문자열 그대로 쓴다(§4.5).
 * `서울` 은 문자열, `42` 는 숫자, `{"a":1}` 은 객체가 된다.
 */
const parseAnswer = (answer: string): JsonValue => {
  try {
    return JSON.parse(answer) as JsonValue;
  } catch {
    return answer;
  }
};

/** §8.6 의 기본값 표시. 문자열은 따옴표 없이 그대로 보여준다. */
const renderDefault = (value: JsonValue): string =>
  typeof value === "string" ? value : JSON.stringify(value);

/** §8.6.1 의 현재값 표시. 값의 경계가 보여야 해서 JSON 으로 적는다. */
const renderCurrent = (value: JsonValue): string => JSON.stringify(value) ?? "null";

/** `(tool, 필드명)` 캐시 키. 필드 이름에 점이 있어도 툴 이름과 섞이지 않게 앞을 길이로 가른다. */
const cacheKey = (tool: string, field: string): string => `${tool.length}:${tool}.${field}`;

/**
 * 한 필드를 사람에게 받는다. 선언 타입과 안 맞으면 같은 질문을 다시 한다(§4.5).
 * `proposed` 가 있으면 §8.6 형식, 없으면 §8.6.1 형식이다.
 */
const askField = async (
  io: ReviewIO,
  options: {
    readonly field: string;
    readonly current: JsonValue;
    readonly proposed: JsonValue | undefined;
    readonly declared: string | undefined;
  },
): Promise<JsonValue> => {
  const fallback = options.proposed ?? options.current;
  // 선언 타입을 모르는 필드는 괄호에서 타입만 뺀다. 없는 타입을 지어내지 않는다.
  const declared = options.declared === undefined ? "" : `${options.declared}, `;
  const question =
    options.proposed === undefined
      ? `${BODY}${options.field} (${declared}현재 ${renderCurrent(options.current)}): `
      : `${BODY}${options.field}: [${renderDefault(options.proposed)}]`;
  for (;;) {
    const answer = await io.input(question);
    // 엔터는 기본값을 고른 것이다. 기본값은 이미 선언을 만족한다고 보고 검사하지 않는다.
    if (answer.trim() === "") return fallback;
    const value = parseAnswer(answer);
    if (matchesDeclaredType(options.declared, value)) return value;
  }
};

interface Round {
  /** 이번 회차에 쓸 입력값. */
  readonly input: Input;
  /** 사람에게 새로 받은 필드. 이 값만 캐시에 담는다(§4.6). */
  readonly asked: readonly string[];
  /** 아무 값도 바뀌지 않았는가. 그러면 재실행하지 않는다(§4.5). */
  readonly unchanged: boolean;
}

/**
 * 한 회차의 입력값을 만든다. `reuse` 에 값이 있는 필드는 묻지 않고 그대로 쓴다(§4.6).
 * 키 순서는 `current` 의 순서를 그대로 지킨다.
 */
const askRound = async (
  io: ReviewIO,
  target: RepairTarget,
  options: {
    readonly current: Input;
    readonly proposed: Input | undefined;
    readonly reuse?: ReadonlyMap<string, JsonValue>;
    readonly tools: readonly ToolDef[];
  },
): Promise<Round> => {
  const next: Record<string, JsonValue> = {};
  const asked: string[] = [];
  let unchanged = true;
  for (const [field, value] of Object.entries(options.current)) {
    const cached = options.reuse?.get(field);
    const answered =
      cached === undefined
        ? await askField(io, {
            field,
            current: value,
            proposed: options.proposed?.[field],
            declared: declaredTypeOf(options.tools, target.tool, field),
          })
        : cached;
    if (cached === undefined) asked.push(field);
    next[field] = answered;
    if (JSON.stringify(answered) !== JSON.stringify(value)) unchanged = false;
  }
  return { input: next, asked, unchanged };
};

export async function repairInputs(
  options: RepairInputsOptions,
): Promise<readonly RepairOutcome[]> {
  const outcomes: RepairOutcome[] = [];
  /**
   * 사람이 확인했고 재실행까지 통과한 값. `(tool, 필드명)` 하나당 하나다.
   * 이 호출이 끝나면 사라진다(§4.6).
   */
  const cache = new Map<string, JsonValue>();
  /** §8.6.3 을 이미 찍은 키. 같은 안내를 케이스마다 되풀이하지 않는다. */
  const announced = new Set<string>();

  for (const [index, target] of options.targets.entries()) {
    options.io.write(`${HEAD}[${index + 1}] ${target.caseName}\n`);
    options.io.write(`${FAILURE_LINE}\n`);
    options.io.write("\n");

    const attempts: RepairAttempt[] = [];
    const fields = Object.keys(target.input);
    // 캐시가 있는 필드는 묻지 않는다(§4.6). 나머지만 사람에게 받는다.
    const reused = fields.filter((field) => cache.has(cacheKey(target.tool, field)));
    const askable = fields.filter((field) => !cache.has(cacheKey(target.tool, field)));

    for (const field of reused) {
      const key = cacheKey(target.tool, field);
      if (announced.has(key)) continue;
      announced.add(key);
      // 이 값을 함께 받을 케이스 수. 지금 케이스부터 센다. 값을 준 앞 케이스는 빠진다.
      const shared = options.targets
        .slice(index)
        .filter((other) => other.tool === target.tool && field in other.input).length;
      options.io.write(
        `${BODY}같은 값을 ${target.tool}.${field} 를 쓰는 케이스 ${shared}건에 함께 적용합니다.\n`,
      );
    }

    // 1회차. 물어볼 필드가 하나도 없으면 제안을 요청하지도, 안내 줄을 찍지도 않는다.
    const proposed = askable.length === 0 ? undefined : await options.propose?.(target);
    if (askable.length > 0) {
      options.io.write(proposed === undefined ? `${MANUAL_LEAD}\n` : `${PROPOSED_LEAD}\n`);
    }
    const first = await askRound(options.io, target, {
      current: target.input,
      proposed,
      reuse: new Map(
        reused.map((field) => [field, cache.get(cacheKey(target.tool, field)) as JsonValue]),
      ),
      tools: options.tools,
    });

    if (first.unchanged) {
      // 같은 값으로 다시 실행하면 결과가 같다. 묻지도 실행하지도 않고 끝낸다(§4.5).
      outcomes.push({ caseId: target.caseId, repaired: false, attempts: [] });
      continue;
    }
    options.io.write(`${RERUN_LINE}\n`);
    const firstVerdict = await options.rerun(target.caseId, first.input);
    for (const [field, value] of Object.entries(first.input)) {
      attempts.push({ field, value, passed: firstVerdict.passed });
    }
    // 통과한 값만 캐시에 담는다(§4.6). 안 통하는 값을 뒤 케이스에 퍼뜨리면 그 케이스들이
    // 자기 몫의 교정 기회를 한 번도 못 쓰고 같은 이유로 죽는다.
    if (firstVerdict.passed) {
      for (const field of first.asked) {
        cache.set(cacheKey(target.tool, field), first.input[field] as JsonValue);
      }
      options.io.write(`${PASSED_LINE}\n`);
      outcomes.push({
        caseId: target.caseId,
        repaired: true,
        input: first.input,
        attempts,
      });
      continue;
    }

    // 2회차는 1회차가 AI 제안이었을 때만 있다. 같은 사람에게 같은 질문을 두 번 하지 않는다(§4.1).
    if (proposed === undefined) {
      options.io.write(`${EXHAUSTED_LINE}\n`);
      outcomes.push({ caseId: target.caseId, repaired: false, attempts });
      continue;
    }

    const second = await askRound(options.io, target, {
      current: first.input,
      proposed: undefined,
      tools: options.tools,
    });
    if (second.unchanged) {
      options.io.write(`${EXHAUSTED_LINE}\n`);
      outcomes.push({ caseId: target.caseId, repaired: false, attempts });
      continue;
    }
    options.io.write(`${RERUN_LINE}\n`);
    const secondVerdict = await options.rerun(target.caseId, second.input);
    for (const [field, value] of Object.entries(second.input)) {
      attempts.push({ field, value, passed: secondVerdict.passed });
    }
    if (secondVerdict.passed) {
      // 1회차와 같은 규칙이다. 통과한 값만 뒤 케이스로 넘어간다.
      for (const field of second.asked) {
        cache.set(cacheKey(target.tool, field), second.input[field] as JsonValue);
      }
      options.io.write(`${PASSED_LINE}\n`);
      outcomes.push({
        caseId: target.caseId,
        repaired: true,
        input: second.input,
        attempts,
      });
      continue;
    }
    // 되돌리기(§4.7). 이 모듈은 명세를 소유하지 않으므로 통과한 값을 안 돌려주는 것이
    // 곧 되돌림이다. 실패한 값이 명세에 실릴 경로가 없다.
    options.io.write(`${EXHAUSTED_LINE}\n`);
    outcomes.push({ caseId: target.caseId, repaired: false, attempts });
  }

  return outcomes;
}
