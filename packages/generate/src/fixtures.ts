/**
 * 생성용 픽스처 계약(이슈 #390).
 *
 * **`tests/fixtures/` 와 이름만 같고 뜻이 다르다.** 그쪽은 테스트가 읽는 표본 파일이고,
 * 이 파일이 가리키는 것은 사용자가 "실재하는 자원" 을 알려 주는 입력 계약이다.
 *
 * 스키마가 `string` 이라는 사실만으로 유효한 도시·존재하는 파일·실재하는 DB 레코드 ID 를
 * 알 수 없다. 우리는 `"example"` 을 넣고 서버는 그것을 거절한다. 그 거절을 서버 결함으로
 * 보여 주던 것이 이 이슈의 증상이다(설계 §1).
 *
 * **이 모듈은 파일을 읽지 않는다.** `readFixtureFile` 은 텍스트만 받는다. 읽는 것은 `cli` 가
 * 자기 주입점으로 한다. `generate` 가 `node:fs` 를 알면 이 패키지를 테스트에서 쓰는 모든
 * 자리가 파일 시스템을 타게 된다.
 */

import type { JsonValue } from "./schema.js";

/**
 * 이 값이 어디서 왔는가. 실패 진단이 "서버 결함인가 데이터 문제인가" 를 가르는 근거다.
 *
 * **이름이 `ValueProvenance` 가 아니다.** 그 이름은 `provenance.ts` 가 이미 쓰고 있고
 * (`declared` · `placeholder` · `unknownFormat`) `index.ts` 로 나가 있다. 그쪽은 "스키마에
 * 근거가 얼마나 있는가" 이고 이쪽은 "값이 어디서 왔는가" 다. 뜻이 다르므로 같은 이름을
 * 둘 수 없다(#390 구현 중 발견).
 */
export type ValueOrigin =
  /** 사용자가 픽스처 파일에 적었다. 실재하는 자원을 가리킨다고 사용자가 보증한 값. */
  | "userFixture"
  /** 서버 선언의 const · default · examples · enum 에서 왔다. 서버가 준 값이다. */
  | "schemaDeclared"
  /**
   * 우리가 type·format·pattern 만 보고 지어냈다. **어떤 자원도 가리키지 않는다.**
   *
   * 이 값 하나로 "서버 결함" 과 "데이터 준비 필요" 가 갈린다. `format` 표의 값
   * (`https://example.com` · `00000000-0000-4000-8000-000000000000`)도 여기다. 문서용으로
   * 예약된 값이라 형식은 맞지만 실재하지 않는다.
   */
  | "schemaHint"
  /**
   * AI 가 제안했고 사람이 확인했다.
   *
   * **T1 에서는 정의만 하고 내지 않는다.** T2·T3 이 쓴다. 죽은 값이 아니라 다음 태스크의
   * 자리다. 지우지 마라.
   */
  | "aiProposed"
  /** 사람이 교정 화면에서 직접 입력했다. T1 에서는 내지 않는다. `aiProposed` 와 같은 사정이다. */
  | "humanRepaired";

/** 픽스처 파일 형식. **JSON 만 받는다.** YAML·TOML 파서를 들여오지 않는다. */
export interface FixtureFile {
  readonly schemaVersion: 1;
  /** tools[도구][최상위 필드] = 값. */
  readonly tools?: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>;
  /** notes[도구][필드] = 사람이 읽을 메모. 값에 영향을 주지 않는다. */
  readonly notes?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export type FixtureRead =
  | { readonly status: "ok"; readonly file: FixtureFile }
  | { readonly status: "invalid"; readonly reason: string };

/** 한 필드의 값 출처. 케이스와 함께 낸다. */
export interface FieldOrigin {
  readonly tool: string;
  readonly field: string;
  readonly origin: ValueOrigin;
}

const plainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * 픽스처 파일 내용을 읽어 검증한다. **던지지 않는다.** `reason` 은 화면에 그대로 찍는
 * 한 문장이다.
 *
 * 형식이 깨진 파일을 조용히 무시하지 않는다. 무시하면 사용자는 자기가 적은 값이 왜 안
 * 들어가는지 모른 채 실패 화면만 본다.
 */
export function readFixtureFile(text: string): FixtureRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      status: "invalid",
      reason: `픽스처 파일이 JSON 이 아닙니다. ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!plainObject(parsed))
    return { status: "invalid", reason: "픽스처 최상위가 JSON 객체가 아닙니다." };
  if (parsed.schemaVersion !== 1)
    return {
      status: "invalid",
      reason: `픽스처 schemaVersion 이 1 이 아닙니다: ${JSON.stringify(parsed.schemaVersion)}`,
    };

  if (parsed.tools !== undefined) {
    if (!plainObject(parsed.tools))
      return { status: "invalid", reason: "픽스처의 'tools' 가 객체가 아닙니다." };
    for (const [tool, fields] of Object.entries(parsed.tools))
      if (!plainObject(fields))
        return { status: "invalid", reason: `픽스처의 'tools.${tool}' 가 객체가 아닙니다.` };
  }

  if (parsed.notes !== undefined) {
    if (!plainObject(parsed.notes))
      return { status: "invalid", reason: "픽스처의 'notes' 가 객체가 아닙니다." };
    for (const [tool, fields] of Object.entries(parsed.notes)) {
      if (!plainObject(fields))
        return { status: "invalid", reason: `픽스처의 'notes.${tool}' 가 객체가 아닙니다.` };
      for (const [field, note] of Object.entries(fields))
        if (typeof note !== "string")
          return {
            status: "invalid",
            reason: `픽스처의 'notes.${tool}.${field}' 가 문자열이 아닙니다.`,
          };
    }
  }

  return { status: "ok", file: parsed as unknown as FixtureFile };
}

/** 한 도구에 적용할 픽스처 값. 없으면 빈 객체다. */
export const fixtureValuesFor = (
  file: FixtureFile | undefined,
  tool: string,
): Readonly<Record<string, JsonValue>> => file?.tools?.[tool] ?? {};
