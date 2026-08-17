import type { ToolDef } from "@ohmymcp/core";
import { type ContractAxis, type ContractDeclaredType, deriveContractAxes } from "@ohmymcp/runner";
import { fieldSlug } from "./filename.js";
import type { JsonObject, JsonValue } from "./schema.js";

/**
 * 생성한 케이스 한 개. render.ts 의 지역 타입을 이 이름으로 승격시켜 두 파일이 공유한다.
 *
 * assertions 의 expected 를 boolean 으로 넓히지 않는다. 넓히면 정상 케이스에 true 를 넣는
 * 실수를 컴파일러가 못 잡는다.
 */
export interface GeneratedCase {
  readonly id: string;
  readonly name: string;
  readonly operation: {
    readonly type: "callTool";
    readonly tool: string;
    readonly input: JsonObject;
  };
  /**
   * 튜플의 배열 자체에는 readonly 를 걸지 않는다. baseline.ts 가 이 케이스를 runner 의
   * TestSuiteSpec(`cases: TestCaseSpec[]`, 그 안의 `assertions` 도 가변 배열)에 그대로 싣는데,
   * 읽기 전용 배열은 가변 배열에 대입되지 않아 거기서 컴파일이 깨진다.
   * expected 는 요구대로 두 리터럴의 유니온으로 남는다. boolean 으로 넓히면 정상 케이스에
   * true 를 넣는 실수를 컴파일러가 못 잡는다.
   */
  readonly assertions:
    | [IsErrorAssertion]
    | [{ readonly type: "isError"; readonly expected: true }, ErrorBodyAssertion];
}

type IsErrorAssertion =
  | { readonly type: "isError"; readonly expected: true }
  | { readonly type: "isError"; readonly expected: false };

/**
 * 오류 본문에 위반 필드 이름이 실렸는지 보는 단언 (#89 · ADR-0037).
 *
 * `isError: true` 하나만으로는 **"서버가 입력을 거절했다" 와 "서버가 다른 이유로 죽었다" 가
 * 구분되지 않는다.** 둘 다 `isError` 라 초록불이고, 후자가 더 나쁜 결함인데 통과로 찍힌다.
 * 본문에 그 필드 이름이 있는지를 함께 보면 갈린다.
 *
 * 새 단언 종류를 만들지 않고 기존 `bodyMatchesSchema` 를 쓴다. `extractResponseBody` 가 JSON
 * 파싱에 실패한 본문을 문자열로 그대로 주므로(`form: "text"`) 오류 본문에 그대로 걸린다.
 * `stringContains` 는 `type` 없이 쓰면 명세가 `SCHEMA_KEYWORD_REQUIRES_TYPE` 로 무효라
 * `type: "string"` 을 함께 박는다.
 */
type ErrorBodyAssertion = {
  readonly type: "bodyMatchesSchema";
  readonly schema: { readonly type: "string"; readonly stringContains: string };
};

/**
 * 이 길이 미만의 필드 이름에는 본문 단언을 붙이지 않는다.
 *
 * `'a'` 같은 한두 글자는 **크래시 스택트레이스에도 우연히 들어 있다.** 실측으로 확인했다 —
 * `TypeError: Cannot read properties of undefined` 에 `a` 가 있어서 크래시가 통과로 찍혔다.
 * 짧은 이름에서는 이 단언이 구분에 쓸모가 없으므로 아예 안 만든다. 그 축은 `isError` 하나만
 * 남아 지금과 같아지고, 없던 오탐이 생기지 않는다. ADR-0015 의 "오탐 1건이 미탐 1건보다
 * 비싸다" 를 따른 선택이다.
 */
const MIN_FIELD_NAME_LENGTH_FOR_BODY_ASSERTION = 3;

/** 필드 이름이 충분히 길면 본문 단언을 만든다. 짧으면 `null`. */
function errorBodyAssertion(field: string): ErrorBodyAssertion | null {
  if (field.length < MIN_FIELD_NAME_LENGTH_FOR_BODY_ASSERTION) return null;
  return { type: "bodyMatchesSchema", schema: { type: "string", stringContains: field } };
}

/**
 * enum 위반값에 쓰는 예약 문자열. 어떤 서버도 이것을 유효한 값으로 선언하지 않을 것을 노린
 * 이름이고, 그래도 겹치면 접미사를 붙여 피한다.
 */
const INVALID_ENUM_VALUE = "__ohmymcp_invalid_enum__";

/**
 * 선언 type 을 어기는 값. 표로 고정한다. 값이 흔들리면 지문이 흔들린다.
 *
 * integer 만 1.5 다. "example" 을 넣으면 `typeof value === "number"` 검사만 있는 서버도
 * 잡히지만, 1.5 는 그 검사를 통과하고 정수 검사가 없는 것까지 잡는다. 더 예리한 위반이다.
 */
const TYPE_VIOLATION_VALUE: Readonly<Record<ContractDeclaredType, JsonValue>> = {
  string: 0,
  number: "example",
  integer: 1.5,
  boolean: "example",
  object: "example",
  array: "example",
  null: "example",
};

/**
 * 선언 enum 밖 값. 선언 type 이 수 계열이면 타입까지 지킨 값을 고르려 최댓값 + 1 을 쓴다.
 * 안전 정수 경계를 넘으면 그 값이 정확히 표현되지 않아 "enum 밖" 이 보장되지 않으므로
 * 문자열 규칙으로 떨어진다.
 */
function enumViolationValue(axis: ContractAxis): JsonValue {
  const allowed = axis.declaredEnum ?? [];
  if (axis.declaredType === "number" || axis.declaredType === "integer") {
    const numbers = allowed.filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    if (numbers.length > 0) {
      const next = Math.max(...numbers) + 1;
      if (Number.isSafeInteger(next)) return next;
    }
  }
  let candidate = INVALID_ENUM_VALUE;
  for (let suffix = 2; allowed.includes(candidate); suffix++)
    candidate = `${INVALID_ENUM_VALUE}_${suffix}`;
  return candidate;
}

/** 한 도구의 위반 케이스 전량. 정상 케이스는 포함하지 않는다. */
export function buildViolationCases(options: {
  readonly tool: ToolDef;
  /** 정상 경로 입력. render.ts 의 synthesizeValue 결과를 그대로 받는다. */
  readonly happyInput: JsonObject;
  /** 케이스 id 접두사. render.ts 의 baseName 과 같은 값이다. */
  readonly baseName: string;
}): readonly GeneratedCase[] {
  const { tool, happyInput, baseName } = options;
  const { axes } = deriveContractAxes(tool);
  // ENUM_VIOLATION 축의 declaredType 은 설계상 null 이라 같은 필드의 TYPE_VIOLATION 축에서
  // 가져온다. ContractAxis 는 runner 공개 타입이므로 여기서 의미를 늘리지 않는다.
  const declaredTypeByField = new Map<string, ContractDeclaredType>();
  for (const axis of axes)
    if (axis.kind === "TYPE_VIOLATION" && axis.field !== null && axis.declaredType !== null)
      declaredTypeByField.set(axis.field, axis.declaredType);

  const usedIds = new Set<string>();
  const uniqueId = (prefix: string, field: string): string => {
    const initial = `${baseName}-${prefix}-${fieldSlug(field)}`;
    let id = initial;
    for (let occurrence = 2; usedIds.has(id); occurrence++) id = `${initial}-${occurrence}`;
    usedIds.add(id);
    return id;
  };
  const violation = (id: string, name: string, input: JsonObject, field: string): GeneratedCase => {
    const body = errorBodyAssertion(field);
    return {
      id,
      name,
      operation: { type: "callTool", tool: tool.name, input },
      assertions:
        body === null
          ? [{ type: "isError", expected: true }]
          : [{ type: "isError", expected: true }, body],
    };
  };

  const cases: GeneratedCase[] = [];
  for (const axis of axes) {
    const field = axis.field;
    if (field === null) continue; // HAPPY_PATH 는 render.ts 가 만든다
    if (axis.kind === "REQUIRED_OMITTED") {
      // 정상 입력에 그 키가 없으면 뺄 것이 없다. 그대로 만들면 정상 케이스와 입력이 같은데
      // 단언만 isError: true 인 케이스가 되어 항상 실패한다. 서버가 옳은데 우리가 틀린 것이다.
      // 이 축은 케이스 없이 남고 커버리지가 미검증으로 보고한다. 그것이 정직한 상태다.
      //
      // 이 상황은 required 에 있지만 properties 에 없는 필드에서 나온다. generate 의
      // validateSchema 는 그런 스키마를 거부하지만(schema.ts 의 required 검사) runner 의 축
      // 도출은 허용하므로 손으로 쓴 명세나 AI 경로에서 도달할 수 있다.
      if (!Object.hasOwn(happyInput, field)) continue;
      const input = { ...happyInput };
      delete input[field];
      cases.push(
        violation(
          uniqueId("missing", field),
          `${tool.name}가 필수 필드 '${field}' 누락을 거절한다`,
          input,
          field,
        ),
      );
    } else if (axis.kind === "TYPE_VIOLATION") {
      const value = TYPE_VIOLATION_VALUE[axis.declaredType as ContractDeclaredType];
      cases.push(
        violation(
          uniqueId("type", field),
          `${tool.name}가 '${field}' 타입 위반을 거절한다`,
          { ...happyInput, [field]: value },
          field,
        ),
      );
    } else if (axis.kind === "ENUM_VIOLATION") {
      const value = enumViolationValue({
        ...axis,
        declaredType: declaredTypeByField.get(field) ?? null,
      });
      cases.push(
        violation(
          uniqueId("enum", field),
          `${tool.name}가 '${field}' 의 선언되지 않은 값을 거절한다`,
          { ...happyInput, [field]: value },
          field,
        ),
      );
    }
  }
  return cases;
}
