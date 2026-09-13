import type { ToolDef } from "@mcpeak/core";
import type { JsonValue, TestSuiteSpec } from "@mcpeak/runner";
import { canonicalJson } from "@mcpeak/runner";
import type { ReviewIO } from "./generate-command.js";
import type { ProposalOutcome } from "./repair-proposal.js";
import type { RepairAttempt, RepairTarget } from "./repair-target.js";

/**
 * 교정 대상 케이스의 입력값을 사람에게 받아 고치고 다시 실행한다.
 * 단계 구조는 설계 문서 §4.1, 사람 입력은 §4.5, 값 재사용은 §4.6, 되돌리기는 §4.7 이다.
 * 화면 문안은 2026-09-13 설계 §4.3 · §4.4 · §4.5 와 §8.6.2 · §8.6.3 이 전량 고정한다.
 * 문장을 새로 만들지 않는다.
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
  /** AI 제안. 없으면 사람 입력만 쓴다. 값이 없을 때 **왜 없는지**를 함께 돌려준다(#286). */
  readonly propose?: (target: RepairTarget) => Promise<ProposalOutcome>;
  /**
   * 제안한 provider 표기(`codex(gpt-5.6-luna)`). 화면이 값의 출처를 정확히 말하는 데만 쓴다.
   *
   * 이 값이 없던 동안 화면은 provider 가 만든 값을 "서버 응답에서 값을 찾았습니다" 라고
   * **서버에 귀속**했다. 사용자는 AI 가 관여한 사실 자체를 알 수 없었다(#286).
   */
  readonly proposedBy?: string;
  /** 입력 스키마. 타입 검사에 쓴다. 툴 이름으로 찾는다. */
  readonly tools: readonly ToolDef[];
}

/** 케이스 머리글 들여쓰기. 분류 화면(§8.3)과 같은 값이라 번호가 이어 읽힌다. */
const HEAD = "  ";
/** 본문 들여쓰기. 교정 화면의 모든 본문 줄이 이 폭이다. */
const BODY = "      ";

/**
 * 제안값의 출처를 말한다. `propose` 는 provider 가 있을 때만 배선되므로 여기 오는 값은
 * **항상 provider 가 만든 것**이다 — 그런데 전에는 서버에 귀속했다(#286).
 * 표기를 못 받은 경우에도 서버라고 말하지 않는다.
 */
const proposedLead = (by: string | undefined): string =>
  `${BODY}입력값이 거절된 것으로 보입니다. ${
    by === undefined ? "AI 가" : `${by} 가`
  } 서버 응답을 보고 제안한 값입니다.`;
const MANUAL_LEAD = `${BODY}입력값이 거절된 것으로 보입니다. 서버 응답에 쓸 만한 값이 없어 직접 받습니다.`;
/**
 * 전송을 거절한 갈래. **`MANUAL_LEAD` 를 쓰면 안 된다** — 서버 응답은 있었고 보내지 않기로
 * 한 것뿐인데 "쓸 만한 값이 없다" 는 거짓 사유가 된다(#286).
 */
/** `propose` 가 아예 없는 경우. 요청조차 하지 않았으니 근거 부재와 같다. */
const UNAVAILABLE_OUTCOME: ProposalOutcome = { kind: "unavailable" };

const DECLINED_LEAD = `${BODY}입력값이 거절된 것으로 보입니다. AI 전송을 거절했으므로 값을 직접 받습니다.`;
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

/** `(tool, 필드명)` 캐시 키. 필드 이름에 점이 있어도 툴 이름과 섞이지 않게 앞을 길이로 가른다. */
const cacheKey = (tool: string, field: string): string => `${tool.length}:${tool}.${field}`;

/**
 * 한 필드를 사람에게 받는다. 선언 타입과 안 맞으면 같은 질문을 다시 한다(§4.5).
 *
 * 형식은 제안 유무와 **무관하게 하나다**(2026-09-13 설계 §4.5). 갈래가 둘이면 같은 화면이
 * 회차마다 다른 모양이 되고, 사용자가 무엇을 누르면 무엇이 들어가는지를 두 번 배운다.
 */
const askField = async (
  io: ReviewIO,
  options: {
    readonly tool: string;
    readonly field: string;
    /** 이번 회차에 실제로 묻는 필드 중 몇 번째인가. 1부터. 캐시로 건너뛴 필드는 안 센다. */
    readonly index: number;
    /** 이번 회차에 묻는 필드 수. */
    readonly total: number;
    readonly current: JsonValue;
    readonly proposed: JsonValue | undefined;
    readonly declared: string | undefined;
  },
): Promise<JsonValue> => {
  const fallback = options.proposed ?? options.current;
  const parts = [`필드 ${options.index}/${options.total}`];
  // 선언 타입을 모르는 필드는 괄호에서 타입만 뺀다. 없는 타입을 지어내지 않는다.
  if (options.declared !== undefined) parts.push(options.declared);
  if (options.current !== undefined) parts.push(`현재 ${JSON.stringify(options.current)}`);
  parts.push(
    options.proposed === undefined
      ? "엔터 = 현재 값 유지"
      : `엔터 = 제안 값 ${JSON.stringify(options.proposed)}`,
  );
  const question = `${BODY}${options.tool}.${options.field} (${parts.join(", ")}): `;
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
  // 진행도는 **이번 회차에 실제로 묻는** 필드만 센다. 캐시로 건너뛴 필드를 세면 사용자가
  // 보지도 못한 번호가 화면에서 사라진 것처럼 보인다(설계 §4.5).
  const total = Object.keys(options.current).filter(
    (field) => options.reuse?.get(field) === undefined,
  ).length;
  let index = 0;
  for (const [field, value] of Object.entries(options.current)) {
    const cached = options.reuse?.get(field);
    if (cached === undefined) index += 1;
    const answered =
      cached === undefined
        ? await askField(io, {
            tool: target.tool,
            field,
            index,
            total,
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
  const cache = new Map<
    string,
    { readonly value: JsonValue; readonly origin: RepairAttempt["origin"] }
  >();

  /**
   * 이 값을 누가 정했는가(#390 사양 0).
   *
   * 캐시에서 재사용한 필드는 **값을 준 케이스의 출처를 그대로 물려받는다.** 캐시가 값만
   * 담으면 사람이 AI 제안을 고쳐 넣은 값이 뒤 케이스에서 "AI 제안" 으로 찍혀 화면이
   * 거짓말을 한다.
   *
   * 비교는 `===` 가 아니라 `canonicalJson` 이다. 제안값이 객체나 배열일 수 있다.
   */
  const originOf = (
    tool: string,
    field: string,
    value: JsonValue,
    proposed: Readonly<Record<string, JsonValue>> | undefined,
  ): RepairAttempt["origin"] => {
    const cached = cache.get(cacheKey(tool, field));
    if (cached !== undefined && canonicalJson(cached.value) === canonicalJson(value))
      return cached.origin;
    // 1회차는 제안값을 채워 놓고 사람에게 묻는다. 사람이 그대로 두기로 한 값만 여기 온다.
    // 사람이 못 본 값이 `aiProposed` 로 찍히지 않는다.
    //
    // 키의 유무를 먼저 본다. `canonicalJson` 은 `undefined` 를 받으면 던지는데, 1회차는
    // `first.input` 전체를 돌므로 AI 가 제안하지 않은 필드가 섞여 있다. 그 필드에서
    // `proposed[field]` 가 `undefined` 가 되어 대화형 검토가 통째로 죽는다.
    // 제안한 적이 없다는 것은 의미상으로도 `humanRepaired` 다.
    if (
      proposed !== undefined &&
      Object.hasOwn(proposed, field) &&
      canonicalJson(proposed[field] as JsonValue) === canonicalJson(value)
    )
      return "aiProposed";
    return "humanRepaired";
  };
  /** §8.6.3 을 이미 찍은 키. 같은 안내를 케이스마다 되풀이하지 않는다. */
  const announced = new Set<string>();

  for (const [index, target] of options.targets.entries()) {
    options.io.write(`${HEAD}[${index + 1}/${options.targets.length}] ${target.caseName}\n`);
    // 실패 줄은 고정 문장이 아니라 그 케이스의 실제 진단이다(설계 §4.3).
    options.io.write(`${BODY}${target.failureLine}\n`);
    for (const line of target.serverMessage.split("\n").filter((line) => line !== "")) {
      options.io.write(`${BODY}→ ${line}\n`);
    }
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
    const outcome =
      askable.length === 0 ? undefined : ((await options.propose?.(target)) ?? UNAVAILABLE_OUTCOME);
    const proposed = outcome?.kind === "proposed" ? outcome.input : undefined;
    if (askable.length > 0) {
      // 값이 없는 두 갈래는 사람에게 할 말이 다르다. 거절은 근거 부재가 아니다.
      options.io.write(
        `${
          outcome?.kind === "proposed"
            ? proposedLead(options.proposedBy)
            : outcome?.kind === "declined"
              ? DECLINED_LEAD
              : MANUAL_LEAD
        }\n`,
      );
    }
    const first = await askRound(options.io, target, {
      current: target.input,
      proposed,
      reuse: new Map(
        reused.map((field) => [
          field,
          (cache.get(cacheKey(target.tool, field)) as { value: JsonValue }).value,
        ]),
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
      attempts.push({
        field,
        value,
        passed: firstVerdict.passed,
        origin: originOf(target.tool, field, value, proposed),
      });
    }
    // 통과한 값만 캐시에 담는다(§4.6). 안 통하는 값을 뒤 케이스에 퍼뜨리면 그 케이스들이
    // 자기 몫의 교정 기회를 한 번도 못 쓰고 같은 이유로 죽는다.
    if (firstVerdict.passed) {
      for (const field of first.asked) {
        const value = first.input[field] as JsonValue;
        cache.set(cacheKey(target.tool, field), {
          value,
          origin: originOf(target.tool, field, value, proposed),
        });
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
      // 2회차는 제안 없이 사람에게만 묻는다(`proposed: undefined`). 재사용 필드만 출처를
      // 물려받고 나머지는 사람이 입력한 값이다.
      attempts.push({
        field,
        value,
        passed: secondVerdict.passed,
        origin: originOf(target.tool, field, value, undefined),
      });
    }
    if (secondVerdict.passed) {
      // 1회차와 같은 규칙이다. 통과한 값만 뒤 케이스로 넘어간다.
      for (const field of second.asked) {
        const value = second.input[field] as JsonValue;
        cache.set(cacheKey(target.tool, field), {
          value,
          origin: originOf(target.tool, field, value, undefined),
        });
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
