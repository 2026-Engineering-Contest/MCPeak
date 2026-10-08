# generate 검토 메뉴 `show` 도구별 요약 구현계획 (2026-10-08)

`mcpeak generate` 검토 메뉴의 `show` 가 찍는 명세 요약을 도구별로 묶고, 케이스마다 종류와 정상
입력 대비 차이만 적는 형식으로 바꾼다. 저장되는 명세 파일은 바뀌지 않는다. 바뀌는 패키지는
`cli` 하나다.

통합 브랜치는 `feat/generate-show-summary`(기점 `00bf0bf`, origin/main)이고 이 계획서가 그 브랜치에
커밋돼 있어야 한다. 태스크 브랜치는 통합 브랜치에서 따고 통합 브랜치로 병합한다. main 은 건드리지
않는다. 커밋·푸시·PR 은 사람이 한다.

## 0. 목표, 비범위, 완료 조건

**배경.** 지금 `show` 는 케이스를 번호순으로 한 줄씩 찍고, 매 줄에 `callTool <도구> <입력 JSON 전체>
→ isError=<값>` 을 반복한다. 케이스 ID 에 이미 도구와 종류가 들어 있어 같은 정보가 세 번 나오고,
도구별 묶음이 없어 21건이 한 덩어리로 보이며, 정상 값까지 전부 찍혀 "무엇이 다른 케이스인지"를
눈으로 찾아야 한다. 긴 문자열은 `xxxx…` 로 잘려 아무 정보도 주지 않는다.

**목표 (검증 가능한 문장)**

- G1. `show` 출력이 도구별 그룹으로 나뉘고, 그룹 헤더가 `<도구명> (<N>건)` 이다. 그룹 순서는 명세에서
  도구가 처음 나온 순서, 그룹 안 순서는 명세 순서다.
- G2. 각 케이스 줄이 `종류  ID  차이  → 실패` 네 열이고, 종류는 ID 접미 규칙에서, 차이는 같은 도구의
  기준 정상 케이스 입력과 비교해 계산한다. `→ 실패` 는 `isError` 단언의 expected 가 `true` 일 때만 적는다.
- G3. 40자를 넘는 문자열 값은 내용 대신 `길이 N` 으로 적어, 상한 경계(100)와 상한 초과(101) 케이스가
  한눈에 구분된다.
- G4. 입력이 빈 객체인 정상 케이스 하나만 가진 도구들은 개별 그룹 대신 맨 끝 한 줄
  `<도구1>, <도구2>  정상 1건씩, 입력 없음` 으로 합친다.
- G5. 헤더(`현재 명세: …`), 푸터(`저장하면 이 내용이 … 에 쓰입니다.`), 미반영 후보 안내 문구는 그대로다.
- G6. 같은 명세를 두 번 그리면 바이트까지 같다.

**비범위**

- 명세 파일 형식, generate 의 케이스 생성 규칙, 케이스 ID 규칙. 전부 건드리지 않는다.
- 검토 메뉴의 다른 항목(diff 표시, select, json 편집)의 출력.
- `show <도구>` 처럼 인자를 받아 한 도구만 펼치는 기능. 케이스가 50건을 넘는 명세가 실제로 나오면
  그때 별도 계획으로 한다.
- 대시보드. 대시보드의 터미널 출력은 CLI stdout 을 그대로 보여 주며 이 문구를 파싱하지 않는다
  (`packages/dashboard` 에 `현재 명세`·`isError=` 문자열 없음, 2026-10-08 확인).

**완료 조건 (전체)**

- C1. T1 이 `docs/task-integration-ledger.tsv` 에 통합 SHA 로 기록된다.
- C2. 통합 브랜치의 프로젝트 루트에서 `pnpm build --force`, `pnpm typecheck --force`, `pnpm lint`,
  `pnpm test` 가 전부 초록이고, 앞의 둘은 출력에 `Cached: 0 cached` 가 있다.
- C3. 사람이 `examples/audit-target-server` 를 대상으로 `mcpeak generate` 를 띄워 `show` 를 누르면 §2.4 의
  예시와 같은 꼴이 찍힌다(값은 서버 상태에 따라 달라도 꼴은 같다).

## 1. 실행 모델

구현과 테스트는 서브에이전트(또는 다른 세션)가 하고, 이 계획을 완주시키는 세션은 오케스트레이터로만
남는다. 모델 배분은 `CLAUDE.local.md` 표를 따른다.

| 태스크 | 모델 | 사유 |
|---|---|---|
| T1 cli `show` 요약 | 표준 모델 | 출력 형식과 테스트 단언이 이 계획서에 글자 그대로 있다. 실패 메시지가 아니라 요약 화면이고, 판단이 갈리는 지점(종류 판정, 기준 케이스 선택)은 §2 에 못 박았다 |

터미널은 하나, 태스크도 하나다. 파일 소유권이 겹칠 상대가 없다.

## 2. 사양 (T1 의 계약)

### 2.1 바뀌는 함수와 새 helper

모두 `packages/cli/src/generate-command.ts` 안에 둔다. 테스트가 직접 부르도록 아래 넷을 `export` 한다.
helper 는 순수 함수다. 입력 외에 아무것도 읽지 않는다(시각, 환경변수, 난수 금지).

```ts
import type { JsonObject, JsonValue } from "@mcpeak/core";
import type { TestCaseSpec, TestSuiteSpec } from "@mcpeak/runner";

/** 케이스 ID 접미 규칙에서 읽은 종류. 규칙 밖 ID 는 "기타". 두 글자 라벨이라 열 폭이 고정된다. */
export type CaseKind =
  | "정상" | "누락" | "타입" | "열거" | "범위" | "경계" | "분기" | "선언밖" | "생성" | "기타";

/**
 * generate 가 ID 를 만드는 규칙(`packages/generate/src/render.ts`·`violation-cases.ts`·
 * `valid-branches.ts`)을 거꾸로 읽는다.
 *   `<base>-success` → 정상, `<base>-generated` → 생성, `<base>-undeclared` → 선언밖 (끝 일치)
 *   그 외에는 ID 에서 `-missing-`, `-type-`, `-enum-`, `-range-`, `-bound-`, `-branch-` 중
 *   **가장 앞에 나오는 것** 하나로 판정한다. 기준 이름 바로 뒤에 종류가 오고 필드 슬러그는 그 뒤라,
 *   `translate-text-branch-enum-target-2` 는 분기다.
 *   어느 것도 없으면 기타. AI 나 사람이 넣은 케이스가 여기 해당한다.
 * 알려진 한계: 도구 이름 슬러그 자체에 `-type-` 같은 토큰이 들어 있으면 라벨이 틀릴 수 있다. 옆의
 * 차이 열은 데이터에서 계산하므로 라벨이 틀려도 무엇을 보내는 케이스인지는 맞게 보인다.
 */
export function caseKindOf(id: string): CaseKind;

/**
 * 기준 입력 대비 이 케이스 입력의 차이 한 줄.
 *   reference 가 없거나 두 입력이 깊은 비교로 같으면 입력 전체: `{a:0, b:0}`. 빈 객체면 `입력 없음`.
 *   빠진 키: `a 없음`. 더해진 키: `extra=1 (추가)`. 바뀐 키: `a="example" (number 자리)`.
 *     괄호의 타입은 기준 값의 JSON 타입(string/number/boolean/object/array/null)이고, 바뀐 값이 같은
 *     타입이면 괄호를 생략한다(`target="ko"`).
 *   여러 차이는 기준 입력의 키 순서로 `, ` 로 잇는다. 추가된 키는 그 뒤에 이 케이스의 키 순서로.
 *   최상위 키만 본다. 중첩 객체는 값 전체를 한 덩어리로 비교·표시한다.
 * 값 표기(`formatValue`): 문자열은 JSON 따옴표, 40자(MAX_SHOW_VALUE_CHARS) 초과면 `길이 N` 으로
 *   따옴표 없이. 그 외는 `JSON.stringify`. 객체 전체 표기는 `{` + `키:값` 을 `, ` 로 이어 + `}`.
 * 결과가 80자(MAX_SHOW_DELTA_CHARS)를 넘으면 79자 + `…` 로 자른다. 전체는 저장 후 파일에서 본다.
 */
export function describeInputDelta(input: JsonObject, reference: JsonObject | undefined): string;

export interface SuiteSummaryGroup {
  /** callTool 의 도구 이름. listTools 케이스는 "listTools". */
  readonly tool: string;
  readonly cases: readonly TestCaseSpec[];
  /** 이 도구에서 명세 순서로 첫 번째인, isError expected=false 단언을 가진 callTool 케이스의 입력. 없으면 undefined. */
  readonly reference: JsonObject | undefined;
}

/** 도구별 그룹. 순서는 명세에서 도구가 처음 나온 순서. 정렬하지 않는다. */
export function groupCasesByTool(cases: readonly TestCaseSpec[]): readonly SuiteSummaryGroup[];

/** 시그니처는 지금과 같다. 호출부(1829행 부근)는 바꾸지 않는다. */
export function renderSuiteSummary(options: {
  readonly suite: TestSuiteSpec;
  readonly revision: number;
  readonly outPath: string;
  readonly pendingCandidate: boolean;
}): string;
```

상수는 둘이다. 기존 `MAX_SHOW_INPUT_CHARS`(80, 한 줄의 입력 JSON 상한)는 지우고 아래로 바꾼다.

```ts
/** 이 길이를 넘는 문자열 값은 내용 대신 `길이 N` 으로 적는다. 경계 케이스는 길이가 곧 정보다. */
const MAX_SHOW_VALUE_CHARS = 40;
/** 차이 열 한 줄 상한. 중첩 객체가 길면 여기서 자른다. 전체는 저장 후 파일에서 본다. */
const MAX_SHOW_DELTA_CHARS = 80;
```

### 2.2 `renderSuiteSummary` 의 출력 규칙

1. 첫 줄은 지금과 같은 헤더. 그 다음 빈 줄 하나.
2. `groupCasesByTool` 결과를 순서대로 돈다. 단, **입력 없는 정상 1건 그룹**(케이스가 하나이고 그
   케이스가 callTool 이며 입력이 `{}` 이고 `caseKindOf` 가 정상)은 건너뛰고 따로 모은다.
3. 그룹마다 `<tool> (<N>건)` 헤더 한 줄, 케이스 줄들, 빈 줄 하나.
4. 케이스 줄: 두 칸 들여쓰기 + 종류 + 두 칸 + ID(그룹 안 최장 ID 길이로 오른쪽 패딩) + 두 칸 + 차이 +
   단언. 단언은 `isError` expected=true 면 ` → 실패`, expected=false 면 아무것도 붙이지 않는다.
   `toolExists` 는 ` → toolExists <tool>`, 그 밖의 단언 타입은 ` → <type>`. 단언이 여럿이면 `, ` 로 잇고
   `→` 는 한 번만. isError=false 만 있으면 `→` 자체를 안 적는다.
   listTools 케이스의 차이 열은 `listTools` 로 적는다.
   종류 라벨은 전부 두 글자 폭으로 보이도록 `선언밖`·`기타` 뒤 패딩 없이 그대로 둔다. 열 맞춤은 ID 열이
   담당한다(종류 라벨 폭 차이는 허용. 셋 이상 글자인 라벨은 `선언밖` 하나뿐이다).
5. 따로 모은 도구가 있으면 `<도구1>, <도구2>  정상 1건씩, 입력 없음` 한 줄과 빈 줄. 도구 순서는 명세
   등장 순서.
6. 푸터. 미반영 후보 안내는 지금과 같은 문장·위치.
7. 지금처럼 **줄 단위로** `escapeTerminalText` 를 건다. 통째로 걸면 줄바꿈이 `\u000a` 가 된다.
8. 끝에 개행 하나. 패딩에 쓰는 ID 길이는 `String.prototype.length` 로 센다(ID 는 ASCII 슬러그다).

### 2.3 `groupCasesByTool` 규칙

- 도구 키는 `operation.type === "callTool"` 이면 `operation.tool`, 아니면 `"listTools"`.
- `reference` 는 그 그룹에서 명세 순서로 처음 만나는, `assertions` 에 `{ type: "isError", expected: false }`
  가 있는 callTool 케이스의 `operation.input`. 기준 케이스 자신의 차이 열은 `describeInputDelta` 의
  "같으면 전체" 규칙으로 자연히 입력 전체가 된다.

### 2.4 기대 출력 예시 (`examples/audit-target-server` 명세 21건)

```
현재 명세: server (id server) · 케이스 21건 · revision 0

add_numbers (5건)
  정상  add-numbers-success    {a:0, b:0}
  누락  add-numbers-missing-a  a 없음 → 실패
  누락  add-numbers-missing-b  b 없음 → 실패
  타입  add-numbers-type-a     a="example" (number 자리) → 실패
  타입  add-numbers-type-b     b="example" (number 자리) → 실패

translate_text (12건)
  정상  translate-text-success                  {text:"example", target:"en", api_key:"example"}
  경계  translate-text-bound-upper-text         text=길이 100
  분기  translate-text-branch-enum-target-2     target="ko"
  분기  translate-text-branch-enum-target-last  target="ja"
  누락  translate-text-missing-api-key          api_key 없음 → 실패
  누락  translate-text-missing-target           target 없음 → 실패
  누락  translate-text-missing-text             text 없음 → 실패
  타입  translate-text-type-api-key             api_key=0 (string 자리) → 실패
  타입  translate-text-type-target              target=0 (string 자리) → 실패
  타입  translate-text-type-text                text=0 (string 자리) → 실패
  열거  translate-text-enum-target              target="__mcpeak_invalid_enum__" → 실패
  범위  translate-text-range-upper-text         text=길이 101 → 실패

gettime, delete_all, echo_env, get_tip  정상 1건씩, 입력 없음

저장하면 이 내용이 examples/audit-target-server/server.suite.json 에 쓰입니다.
```

차이 열을 고정 폭으로 맞추지 않는다. `→ 실패` 는 차이 뒤에 한 칸 띄우고 붙는다. 이 예시는 §3 의
`fullSuite` 픽스처가 그대로 재현해야 하는 바이트열이다(공백 포함).

## 3. T1 태스크

**Files**

- 수정: `packages/cli/src/generate-command.ts` (§2.1 helper 추가·export, `renderSuiteSummary` 본문,
  상수 교체. 다른 함수는 건드리지 않는다)
- 수정: `packages/cli/tests/generate-command.test.ts` (기존 show 테스트 2개 갱신 + 새 describe 블록)
- 생성: `.changeset/generate-show-summary.md`
- 그 밖의 파일은 수정하지 않는다. 다른 패키지에 고칠 것이 보이면 멈추고 보고한다.

**changeset 본문** (`"@mcpeak/cli": minor`)

```
`mcpeak generate` 검토 메뉴의 `show` 가 명세를 도구별로 묶어 보여 줍니다. 케이스 줄에는 종류
(정상·누락·타입·열거·범위·경계·분기)와 정상 입력 대비 달라진 필드만 적고, 40자를 넘는 문자열은
내용 대신 길이로 적어 경계 케이스와 범위 초과 케이스가 구분됩니다. 입력 없는 정상 1건짜리 도구는
한 줄로 합칩니다. 저장되는 명세 파일은 바뀌지 않습니다.
```

**기존 테스트 갱신** (`generate-command.test.ts` 1042행·1055행 부근)

- `show 는 입력 없이 현재 명세를 케이스당 한 줄로 찍고 메뉴로 돌아온다`: 이름을
  `show 는 입력 없이 현재 명세를 도구별로 묶어 찍고 메뉴로 돌아온다` 로 바꾸고, 번호 매김을 가정한 단언
  `expect(shown).toMatch(/\(id weather\)[^\n]*\n {2}1\. /)` 를
  `expect(shown).toMatch(/\(id weather\)[^\n]*\n\nweather \(\d+건\)\n {2}/)` 로 바꾼다. 나머지 단언은 유지.
- `show 는 반영한 변경이 들어간 명세를 보여주고 미반영 후보가 있으면 알린다`: 그대로 통과해야 한다. 바꾸지
  않는다.

**새 테스트** (`describe("show 요약 형식")`, 같은 파일 끝에 추가. `renderSuiteSummary`·`caseKindOf`·
`describeInputDelta`·`groupCasesByTool` 을 `../src/generate-command.js` 에서 import)

픽스처는 파일 안의 인메모리 객체로 만든다. `fullSuite` 는 §2.4 의 21건을 명세 순서 그대로 담는다.
입력값은 §2.4 와 붙여 둔 원문 그대로다: `translate-text-bound-upper-text` 의 text 는 `"example"` 뒤에
`x` 93개(합 100자), `range-upper` 는 94개(합 101자), `enum-target` 의 target 은
`"__mcpeak_invalid_enum__"`. 단언은 전부 `[{ type: "isError", expected: <값> }]` 하나씩. suite 의
`name` 은 `"server"`, `id` 는 `"server"`. `addNumbersCases` 는 그중 앞 5건, `noInputTools` 는 뒤 4건
(gettime, delete_all, echo_env, get_tip 순).

```ts
const options = (suite: TestSuiteSpec) => ({
  suite, revision: 0, outPath: "examples/audit-target-server/server.suite.json", pendingCandidate: false,
});

it("도구별로 묶고 그룹 헤더에 건수를 적으며 그룹 순서는 명세 등장 순서다", () => {
  const out = renderSuiteSummary(options(suiteWith([...translateCases, ...addNumbersCases])));
  expect(out).toContain("\ntranslate_text (12건)\n");
  expect(out).toContain("\nadd_numbers (5건)\n");
  expect(out.indexOf("translate_text (12건)")).toBeLessThan(out.indexOf("add_numbers (5건)"));
});

it("ID 접미 규칙에서 종류를 읽고 규칙 밖 ID 는 기타로 둔다", () => {
  expect(caseKindOf("add-numbers-success")).toBe("정상");
  expect(caseKindOf("add-numbers-missing-a")).toBe("누락");
  expect(caseKindOf("add-numbers-type-a")).toBe("타입");
  expect(caseKindOf("translate-text-enum-target")).toBe("열거");
  expect(caseKindOf("translate-text-range-upper-text")).toBe("범위");
  expect(caseKindOf("translate-text-bound-upper-text")).toBe("경계");
  expect(caseKindOf("translate-text-branch-enum-target-2")).toBe("분기");
  expect(caseKindOf("weather-undeclared")).toBe("선언밖");
  expect(caseKindOf("weather-generated")).toBe("생성");
  expect(caseKindOf("ai-added-negative-city")).toBe("기타");
});

it("기준 입력 대비 빠진 키·바뀐 키·더해진 키만 적는다", () => {
  const ref = { a: 0, b: 0 };
  expect(describeInputDelta({ b: 0 }, ref)).toBe("a 없음");
  expect(describeInputDelta({ a: "example", b: 0 }, ref)).toBe('a="example" (number 자리)');
  expect(describeInputDelta({ a: 1, b: 0 }, ref)).toBe("a=1");
  expect(describeInputDelta({ a: 0, b: 0, c: true }, ref)).toBe("c=true (추가)");
  expect(describeInputDelta({ b: "x" }, ref)).toBe('a 없음, b="x" (number 자리)');
});

it("기준이 없거나 기준과 같으면 입력 전체를 적고 빈 입력은 입력 없음이다", () => {
  expect(describeInputDelta({ a: 0, b: 0 }, { a: 0, b: 0 })).toBe("{a:0, b:0}");
  expect(describeInputDelta({ a: 1, b: 2 }, undefined)).toBe("{a:1, b:2}");
  expect(describeInputDelta({}, undefined)).toBe("입력 없음");
  expect(describeInputDelta({}, {})).toBe("입력 없음");
});

it("긴 문자열은 내용 대신 길이로 적어 경계와 범위 초과가 구분된다", () => {
  const ref = { text: "example" };
  expect(describeInputDelta({ text: "x".repeat(40) }, ref)).toBe(`text="${"x".repeat(40)}"`);
  expect(describeInputDelta({ text: "x".repeat(41) }, ref)).toBe("text=길이 41");
  expect(describeInputDelta({ text: "x".repeat(100) }, ref)).toBe("text=길이 100");
  expect(describeInputDelta({ text: "x".repeat(101) }, ref)).toBe("text=길이 101");
  expect(describeInputDelta({ text: "x".repeat(100) }, undefined)).toBe("{text:길이 100}");
});

it("차이 열이 80자를 넘으면 79자와 말줄임표로 자른다", () => {
  const nested = { payload: { items: Array.from({ length: 30 }, (_, i) => ({ id: i })) } };
  const out = describeInputDelta(nested, { payload: {} });
  expect(out).toHaveLength(80);
  expect(out.endsWith("…")).toBe(true);
});

it("기준 케이스는 그 도구에서 첫 isError=false 케이스다", () => {
  const groups = groupCasesByTool(fullSuite.cases);
  expect(groups.map((g) => g.tool)).toEqual([
    "add_numbers", "gettime", "translate_text", "delete_all", "echo_env", "get_tip",
  ]);
  expect(groups[2]?.reference).toEqual({ text: "example", target: "en", api_key: "example" });
  expect(groups[2]?.cases).toHaveLength(12);
});

it("isError=true 만 → 실패로 적고 정상 케이스는 비운다", () => {
  const out = renderSuiteSummary(options(suiteWith(addNumbersCases)));
  expect(out).toContain("  누락  add-numbers-missing-a  a 없음 → 실패\n");
  expect(out).toContain("  정상  add-numbers-success    {a:0, b:0}\n");
  expect(out).not.toContain("isError=");
});

it("입력 없는 정상 1건짜리 도구는 끝에 한 줄로 합친다", () => {
  const out = renderSuiteSummary(options(suiteWith([...addNumbersCases, ...noInputTools])));
  expect(out).toContain("\ngettime, delete_all, echo_env, get_tip  정상 1건씩, 입력 없음\n");
  expect(out).not.toContain("gettime (1건)");
});

it("입력 없는 정상 케이스라도 같은 도구에 다른 케이스가 있으면 그룹으로 남는다", () => {
  const undeclared = { ...noInputTools[0], id: "get-time-undeclared",
    operation: { type: "callTool", tool: "gettime", input: { extra: 1 } },
    assertions: [{ type: "isError", expected: true }] };
  const out = renderSuiteSummary(options(suiteWith([noInputTools[0], undeclared])));
  expect(out).toContain("\ngettime (2건)\n");
  expect(out).toContain("  선언밖  get-time-undeclared  extra=1 (추가) → 실패\n");
  expect(out).not.toContain("정상 1건씩");
});

it("listTools 케이스와 isError 외 단언은 타입 이름으로 적는다", () => {
  const listCase = { id: "tools-listed", name: "목록", operation: { type: "listTools" },
    assertions: [{ type: "toolExists", tool: "weather" }] };
  const out = renderSuiteSummary(options(suiteWith([listCase])));
  expect(out).toContain("\nlistTools (1건)\n");
  expect(out).toContain("  기타  tools-listed  listTools → toolExists weather\n");
});

it("21건 예시 명세의 전체 출력이 계획서 §2.4 와 바이트까지 같다", () => {
  const out = renderSuiteSummary(options(fullSuite));
  expect(out).toBe(EXPECTED_FULL_OUTPUT); // §2.4 코드 블록을 그대로 옮긴 문자열 상수. 끝 개행 포함
});

it("같은 명세를 두 번 그리면 바이트가 같다", () => {
  expect(renderSuiteSummary(options(fullSuite))).toBe(renderSuiteSummary(options(fullSuite)));
});

it("제어 문자는 줄 단위로 이스케이프돼 줄바꿈이 살아 있다", () => {
  const evil = { ...addNumbersCases[0], id: "add-numbers-success",
    operation: { type: "callTool", tool: "add_numbers", input: { a: "x\u001b[31m", b: 0 } } };
  const out = renderSuiteSummary(options(suiteWith([evil])));
  expect(out).toContain("\\u001b");
  expect(out).not.toContain("\\u000a");
  expect(out.split("\n").length).toBeGreaterThan(3);
});
```

**표적 검증**: `pnpm --filter @mcpeak/cli test -- generate-command`
**회귀 검증**: 프로젝트 루트에서 `pnpm build --force && pnpm typecheck --force && pnpm lint && pnpm test`.
`typecheck`·`build` 출력에 `Cached: 0 cached` 가 있어야 한다. 테스트는 인메모리 픽스처만 쓴다.
`examples/` 서버를 띄우는 E2E 는 전체 `pnpm test` 에 이미 들어 있는 것 외에 더하지 않는다.

**보고 경계**: 다음이면 멈추고 `BLOCKED` 로 보고한다. `@mcpeak/runner` 의 `TestCaseSpec` 이 §2.1 의
가정(`operation.type` 이 `listTools`|`callTool`, `assertions` 배열)과 다르다. 다른 패키지의 테스트가
`show` 의 옛 형식 문자열을 단언한다. `escapeTerminalText` 가 `repair-render.ts` 에서 export 되지 않는다.

## 4. 터미널 분할

터미널 1개, worktree 1개, 브랜치 1개(`feat/generate-show-summary-T1`). 웨이브는 하나다.

## 5. 사람 몫 사전 조건

1. 프로젝트 루트에서 `git switch -c feat/generate-show-summary 00bf0bf` 뒤 이 계획서를 커밋한다
   (`docs(cli): generate show 도구별 요약 구현계획`). 지금 작업 중인 `feat/audit-steering` 의 미커밋
   변경은 그 브랜치에 그대로 둔다. 계획서 파일만 새 브랜치로 가져간다.
2. `git log --oneline -1` 로 기점이 계획서 커밋인지, `git status --short` 가 깨끗한지 본다.

## 6. 실행 프롬프트 (터미널 1)

권장 실행 설정: 표준 모델, 추론 보통, 에이전트 종류 general-purpose. 프로젝트 루트에서 세션을 열고 아래를
그대로 붙여넣는다.

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.
프로젝트 루트 /Users/doo._.hyun/Study/Project/OhMyMCP 에서
  BASE=$(git rev-parse feat/generate-show-summary)
  git worktree add /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-show-T1 -b feat/generate-show-summary-T1 feat/generate-show-summary
를 실행한 뒤 EnterWorktree 로 path=/Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-show-T1 에 진입해라.
진입 후 아래를 확인하고 하나라도 어긋나면 중단하고 `status: BLOCKED` 로 보고해라.
  - pwd 가 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-show-T1 인지
  - git rev-parse HEAD 가 위 BASE 와 같은지
  - docs/plans/2026-10-08-generate-show-도구별-요약-구현계획.md 가 존재하는지
  - git status --short 가 비었는지
  - pnpm install 뒤 pnpm build 가 성공하고, pnpm --filter @mcpeak/cli test -- generate-command 가 실행돼
    초록인지(기존 테스트가 돌아가는지 본다)

[2단계: 실행]
역할: Task T1 구현자. 계획서 docs/plans/2026-10-08-generate-show-도구별-요약-구현계획.md 의 §2·§3 을
그대로 구현한다. 설계를 바꾸지 않는다. 계획서가 틀렸다고 판단되면 고치지 말고 BLOCKED 로 보고한다.

허용 Files (이 밖의 파일은 소유자가 달라도 수정하지 말고 보고한다):
  - packages/cli/src/generate-command.ts
  - packages/cli/tests/generate-command.test.ts
  - .changeset/generate-show-summary.md (생성)

절대 하지 말 것 (팀 CLAUDE.md):
  - 다른 오너의 패키지를 수정하지 마라. 필요하면 멈추고 보고해라.
  - core/src/types.ts 의 McpClient / ToolResult 인터페이스를 바꾸지 마라.
  - @modelcontextprotocol/sdk 버전을 올리지 마라. ^ 붙이지 마라.
  - 목록에 없는 의존성을 추가하지 마라.
  - 커밋·푸시는 사람이 한다. 요청받지 않은 git 명령을 실행하지 마라(worktree 생성은 예외).
그 밖에: 백그라운드 실행, 커밋, 머지, 푸시, 하위 에이전트 스폰 금지. 다른 작업자의 변경을 되돌리지 마라.
유닛테스트는 인메모리 픽스처만 쓴다. examples/ 서버를 띄우는 테스트를 새로 만들지 마라.

순서:
  1. 테스트 먼저. 계획서 §3 의 기존 테스트 갱신과 새 describe 블록을 적고, 실패하는 것을 확인한다.
  2. §2.1 의 helper 넷을 export 로 추가하고 renderSuiteSummary 를 §2.2 규칙대로 다시 쓴다.
     MAX_SHOW_INPUT_CHARS 를 지우고 MAX_SHOW_VALUE_CHARS=40, MAX_SHOW_DELTA_CHARS=80 으로 바꾼다.
  3. §3 의 changeset 파일을 만든다.
  4. 표적 검증: pnpm --filter @mcpeak/cli test -- generate-command
  5. 회귀 검증: 프로젝트 worktree 루트에서 pnpm build --force && pnpm typecheck --force && pnpm lint && pnpm test
     build·typecheck 출력에 Cached: 0 cached 가 있는지 확인한다.
  6. 보고서를 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-show-T1/docs/reports/2026-10-08-show-T1.md 에 쓴다.
     pwd, git rev-parse HEAD, 기점 커밋, 실행한 검증 명령과 결과(통과·실패 수), 임의로 판단한 부분을 적는다.

완료 형식: 최종 응답은 `status: READY_FOR_REVIEW` 또는 `status: BLOCKED` 로 시작하고, 변경 파일 목록,
검증 명령과 결과, 보고서 절대 경로, 남은 위험을 포함한다.
```

## 7. 통합 게이트 (오케스트레이터)

1. 보고서와 허용 Files 의 diff 를 직접 본다. 허용 밖 파일이 바뀌었으면 되돌리게 한다.
2. §2.4 의 바이트 일치 테스트가 실제로 §2.4 문자열을 단언하는지 눈으로 확인한다(테스트가 구현 출력을 복사해
   기대값으로 넣었으면 의미가 없다).
3. 통합 브랜치에 병합한 뒤 루트에서 C2 를 돌린다.
4. C3 을 사람이 확인한다. 대시보드 터미널 출력에서도 같은 꼴인지 본다.
5. `docs/task-integration-ledger.tsv` 에 T1 통합 SHA 를 기록한다. worktree 제거 전에 그 안의 세션을 루트로
   내보낸다.
