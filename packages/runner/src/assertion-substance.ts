import type { AssertionSpec, ResponseSchema, TestSuiteSpec } from "./spec/types.js";
import type { SpecFinding, SpecFindingCode, SpecFindingsResult } from "./spec-findings.js";
import { MAX_FINDINGS_PER_CASE } from "./spec-findings.js";

/**
 * 같은 케이스 안에서의 검사 종류 순서. 설계 문서 §9.2의 순서를 단언 실질성 코드로 이은 것이다.
 * 낮은 값이 앞에 온다.
 */
const CODE_ORDER: Readonly<Partial<Record<SpecFindingCode, number>>> = {
  VACUOUS_MIN_LENGTH: 0,
  VACUOUS_MIN_ITEMS: 1,
};

/** UTF-16 코드 단위 안정 비교. 로캘에 의존하지 않는다. `schema-match.ts`의 것과 같다. */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** 프레임 스택의 원소. 스키마 한 개와 그것이 놓인 경로다. */
interface Frame {
  readonly schema: ResponseSchema;
  readonly path: string;
}

/**
 * 통과가 보장된 단언을 찾는다. 명세만 보고 판정하며 서버도 tools도 필요하지 않다.
 *
 * `bodyMatchesSchema` 단언만 대상이다. `isError`와 `toolExists`는 검사하지 않고,
 * 단언 0개는 `validateMcpSuite`가 `EMPTY_ASSERTIONS`로 이미 잡으므로 여기서 다시 잡지 않는다.
 * 설계 문서 §5.7 · §9.
 */
export function checkAssertionSubstance(suite: TestSuiteSpec): SpecFindingsResult {
  const findings: SpecFinding[] = [];
  let totalFindings = 0;

  // suite.cases의 순회 순서가 곧 케이스 인덱스 오름차순이다. 설계 문서 §9.2의 1번 기준이다.
  for (const testCase of suite.cases) {
    /** 이 케이스에서 모은 것. 정렬한 뒤 상한을 적용한다. */
    const perCase: SpecFinding[] = [];

    const add = (code: SpecFindingCode, path: string): void => {
      perCase.push({ code, severity: "advisory", caseId: testCase.id, path });
    };

    /**
     * 스키마 하나와 그 아래 중첩(`properties.*`, `items`)을 훑는다.
     * 재귀가 아니라 명시적 프레임 스택이다. `schema-match.ts`의 `matchResponseSchema`가
     * 같은 중첩을 같은 방식으로 도는 이유와 같다. 중첩 깊이는 `validateMcpSuite`가 제한하지
     * 않으므로 재귀로 두면 깊이 수천짜리 명세에서 스택이 넘친다. 같은 명세를
     * `matchResponseSchema`는 처리하는데 이쪽만 죽는 비대칭이 생긴다.
     */
    const walk = (rootSchema: ResponseSchema, rootPath: string): void => {
      const frames: Frame[] = [{ schema: rootSchema, path: rootPath }];

      while (frames.length > 0) {
        const frame = frames.pop();
        if (frame === undefined) break;
        const { schema, path } = frame;

        // 제약 유무를 따지지 않는다. minLength: 0 · minItems: 0 은 그 자체로 통과가 보장된
        // 단언이고, 그 사실은 같은 스키마에 다른 제약이 있든 없든 참이다.
        if (schema.minLength === 0) add("VACUOUS_MIN_LENGTH", `${path}.minLength`);
        if (schema.minItems === 0) add("VACUOUS_MIN_ITEMS", `${path}.minItems`);

        // 역순으로 push해 pop 순서가 properties(키 오름차순), items 가 되게 한다.
        if (schema.items !== undefined) {
          frames.push({ schema: schema.items, path: `${path}.items` });
        }
        if (schema.properties !== undefined) {
          // Object.keys 순회 순서에 기대지 않는다. 키를 모아 정렬한 뒤 순회한다. 설계 문서 §9.2.
          const entries = Object.entries(schema.properties).sort(([a], [b]) => byCodeUnit(a, b));
          for (let index = entries.length - 1; index >= 0; index--) {
            const entry = entries[index];
            if (entry !== undefined) {
              frames.push({ schema: entry[1], path: `${path}.properties.${entry[0]}` });
            }
          }
        }
      }
    };

    // 케이스 종류에 따라 단언 배열의 타입이 갈리므로 한 번 넓혀서 받는다.
    const assertions: AssertionSpec[] = testCase.assertions;
    assertions.forEach((assertion, assertionIndex) => {
      if (assertion.type !== "bodyMatchesSchema") return;
      walk(assertion.schema, `assertions[${assertionIndex}].schema`);
    });

    perCase.sort((a, b) => {
      const byCode = (CODE_ORDER[a.code] ?? 0) - (CODE_ORDER[b.code] ?? 0);
      if (byCode !== 0) return byCode;
      return byCodeUnit(a.path, b.path);
    });

    totalFindings += perCase.length;
    // 상한은 케이스마다 적용하고 totalFindings는 자르기 전 총합을 센다. 설계 문서 §9.3.
    findings.push(...perCase.slice(0, MAX_FINDINGS_PER_CASE));
  }

  return { findings, totalFindings };
}
