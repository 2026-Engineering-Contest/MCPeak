# 실패 케이스 요약 절 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` 로 태스크
> 단위 실행한다. 스텝은 `- [ ]` 체크박스다.

**Goal:** 시험 실행 보고서의 요약 줄 바로 앞에 실패·타임아웃 케이스만 모은 절을 넣어, 케이스가
수십 개인 서버에서도 실패를 스크롤 없이 찾게 한다(#446).

**Architecture:** `packages/runner/src/reporter.ts` 안에서 끝난다. `renderReport` 의 꼬리에
`failedRecapLines` 한 줄을 끼우고, 그 함수가 `report.cases` 에서 `failed`·`timedOut` 만 골라
케이스 블록이 이미 찍은 진단 줄 하나를 옮겨 온다. 새 문안도 새 파일도 새 의존성도 없다.

**Tech Stack:** TypeScript (ESM), vitest, biome, turbo, pnpm workspace, changesets.

**Spec:** `docs/superpowers/specs/2026-09-10-failed-case-recap-design.md`

## 전역 제약

프로젝트 지침 파일(`CLAUDE.md`)의 금지 항목을 그대로 옮긴 것이다. 모든 태스크의 요구사항에
이 절이 암묵적으로 포함된다.

- **다른 오너의 패키지를 수정하지 마라.** 이 계획의 허용 범위는 `packages/runner/` 와
  `docs/` 와 `.changeset/` 이다. `packages/cli`·`packages/core`·`packages/generate`·
  `packages/record`·`packages/mock`·`packages/dashboard` 는 읽기만 한다. 수정이 필요해 보이면
  고치지 말고 `BLOCKED` 로 보고한다.
- **`core/src/types.ts` 의 `McpClient` / `ToolResult` 인터페이스를 바꾸지 마라.** 제안까지만 한다.
- **`@modelcontextprotocol/sdk` 버전을 올리지 마라.** 1.x 고정이다. `^` 를 붙이지 마라.
- **목록에 없는 의존성을 추가하지 마라.** 이 작업에 새 의존성은 없다. 필요해 보이면 멈추고 보고한다.
- **커밋·푸시는 사람이 한다.** 서브에이전트는 git 명령을 실행하지 않는다(worktree 진입 제외).
- 의존 방향은 단방향이다: `dashboard` → `cli` → `runner`/`generate`/`record`/`mock` → `core`.
  역참조·순환 금지.
- 유닛테스트는 인메모리와 `packages/runner/tests/fixtures/` 만 쓴다. `examples/` 의 실제 서버
  프로세스를 띄우는 검증은 직렬 웨이브(W2)로 분리한다.
- 산문에 대시(`—`)를 쓰지 않는다. 문장을 나누거나 쉼표·괄호로 푼다.
- 주석·문서·커밋 메시지는 한국어다. Conventional Commits, scope 필수.
- **`packages/*` 를 건드린 PR 은 `.changeset/*.md` 를 그 브랜치에서 새로 추가해야 한다.**
  이 작업은 릴리스 노트가 필요한 변경이므로 `pnpm changeset` 으로 만든다(빈 changeset 아님).

## 실행 모델

- 이 세션은 **오케스트레이터**다. 구현·테스트는 서브에이전트가 한다.
- 모델 배분(`CLAUDE.local.md` 표): 이 작업은 **실패 메시지 문안 설계**에 해당하므로 예외 항목이다.
  T1·T2 모두 **상위 모델**로 스폰한다. 사유는 절의 문안·기호·자르기 판단이 계획서에 코드로
  적혀 있어도 그 적용 지점(어떤 진단이 어떤 줄을 내는가)이 실측 데이터에 걸려 있기 때문이다.
- 자식이 끝나면 보고서와 diff와 테스트 결과를 직접 열어 확인한 뒤에만 통합한다.

## 터미널 분할

**터미널 1개다.** 단일 패키지·단일 파일 작업이고 T2 가 T1 의 결과 문안을 문서에 옮기므로
병렬 이득이 없다. 터미널 1개 = worktree 1개 = 브랜치 1개 안에서 T1 → T2 를 순차 실행한다.

| 웨이브 | 태스크 | 터미널 | 선행 |
|---|---|---|---|
| W1 | T1 리포터 구현과 테스트 | 터미널 1 | 없음 |
| W1 | T2 설계 문서·ADR·changeset | 터미널 1 | T1 통합 |
| W2 | 실환경 검증 (직렬, 오케스트레이터가 수행) | 터미널 1 | T2 통합 |

- worktree: `.claude/worktrees/mcpeak-failed-case-recap`
- 브랜치: `feat/runner-failed-case-recap`
- 통합 대장: `docs/task-integration-ledger.tsv`

## 사람 몫 사전 조건 (터미널을 열기 전에 프로젝트 루트에서)

계획서와 설계 문서가 untracked 면 새 worktree 에 딸려가지 않는다. **아래 두 줄을 먼저 확인한다.**

```sh
git log --oneline -1                       # 기점 커밋을 눈으로 기록한다
git status --short docs/superpowers        # 두 문서가 커밋돼 있어야 한다 (출력이 비어야 한다)
```

`docs/superpowers/specs/2026-09-10-failed-case-recap-design.md` 와
`docs/superpowers/plans/2026-09-10-failed-case-recap-implementation.md` 가 untracked 로 보이면
먼저 별도 문서 커밋으로 보존한 뒤 터미널을 연다.

---

## 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `packages/runner/src/reporter.ts` | 보고서 하나를 사람이 읽는 문자열로 그린다. 절 전체가 여기 안이다 | T1 |
| `packages/runner/tests/reporter.test.ts` | 렌더러가 무엇을 어디에 놓는지 고정한다 | T1 |
| `docs/superpowers/specs/2026-08-13-cli-report-rendering-design.md` | 출력 계약의 원본. §5.1 갱신, §5.7 신설 | T2 |
| `docs/adr/0092-…md` | 절의 위치와 진단 줄 선택 결정을 남긴다 | T2 |
| `.changeset/*.md` | 릴리스 노트 | T2 |

새 파일은 ADR 과 changeset 둘뿐이다. `reporter.ts` 는 265줄이고 책임이 하나라 분할하지 않는다.

---

### Task T1: 리포터에 실패 요약 절을 넣는다

**Files:**
- Modify: `packages/runner/src/reporter.ts` (`bulletLine` 리팩터 + 새 절)
- Test: `packages/runner/tests/reporter.test.ts` (새 describe 추가 + 기존 단언 4건 갱신)

**Interfaces:**
- Consumes: `RunnerReport`·`TestCaseResult`·`RunnerDiagnostic` (`packages/runner/src/executor.ts`,
  `diagnostics.ts`). 이 타입들을 **바꾸지 않는다.**
- Produces: 없다. 모듈 밖으로 새 export 가 나가지 않는다. `renderReport` 의 시그니처도 그대로다.

**허용 Files 밖 금지.** 위 두 파일 외에는 읽기만 한다.

- [ ] **Step 1: 실패가 0건이면 절이 없다는 테스트를 쓴다**

`packages/runner/tests/reporter.test.ts` 의 `describe("renderReport", ...)` 안 맨 끝에 새
describe 를 연다.

```ts
  describe("실패한 케이스 절", () => {
    const failing = (
      id: string,
      diagnosticValue: RunnerDiagnostic,
      status: TestCaseResult["status"] = "failed",
    ): TestCaseResult =>
      testCase({
        id,
        name: `${id} 이름`,
        status,
        assertions: [assertion("isError", "failed", diagnosticValue)],
      });

    it("실패도 타임아웃도 없으면 절을 내지 않는다", () => {
      const report = makeReport([
        testCase({ id: "a", name: "첫 번째", status: "passed" }),
        testCase({ id: "b", name: "두 번째", status: "passed" }),
      ]);

      expect(renderReport(report)).not.toContain("실패한 케이스");
    });
  });
```

- [ ] **Step 2: 돌려서 통과하는지 본다**

Run: `pnpm --filter @mcpeak/runner test -- reporter --run`
Expected: PASS. 아직 절이 없으므로 이 하나는 원래 통과한다. 러너가 새 describe 를 실제로
수집했는지 출력에서 테스트 이름을 눈으로 확인한다(수집 0개가 초록으로 보이는 거짓 신호).

- [ ] **Step 3: 절의 위치와 형태를 고정하는 실패 테스트를 쓴다**

같은 describe 안에 잇는다.

```ts
    it("요약 줄 바로 앞에 절을 낸다", () => {
      const report = makeReport([
        testCase({ id: "ok", name: "통과", status: "passed" }),
        failing("city-number", {
          code: "IS_ERROR_MISMATCH",
          message: "정상 응답을 기대했지만 오류 응답을 받았습니다.",
          hint: "툴 입력값과 서버의 오류 응답을 확인하세요.",
          notes: ["Repository path 'example' is outside the allowed repository"],
        }),
      ]);

      expect(renderReport(report)).toBe(
        [
          "날씨 스위트  (2 cases)",
          "",
          "✓ ok           통과",
          "✗ city-number  city-number 이름",
          "    isError  정상 응답을 기대했지만 오류 응답을 받았습니다.",
          "    → Repository path 'example' is outside the allowed repository",
          "    해결: 툴 입력값과 서버의 오류 응답을 확인하세요.",
          "",
          "실패한 케이스",
          "  ✗ city-number  → Repository path 'example' is outside the allowed repository",
          "",
          "1 passed, 1 failed  (2 total)",
          "",
        ].join("\n"),
      );
    });
```

- [ ] **Step 4: 돌려서 실패하는지 본다**

Run: `pnpm --filter @mcpeak/runner test -- reporter --run`
Expected: FAIL. 기대 문자열에 있는 `실패한 케이스` 두 줄이 실제 출력에 없다.

- [ ] **Step 5: 최소 구현을 넣는다**

`packages/runner/src/reporter.ts` 를 고친다. 먼저 `bulletLine`(현행 70~75줄)을 아래로 바꾼다.
외부 동작은 바뀌지 않는다. 기존 JSDoc 본문은 그대로 두고 마지막 문단만 아래처럼 정리한다.

```ts
/**
 * 글머리를 붙인 본문. **줄이 이미 `→` 로 시작하면 우리 글머리를 붙이지 않는다.** 붙이면
 * `→ → ...` 가 된다(#280). 들여쓰기는 호출부가 정한다. 케이스 블록은 4칸, 실패 요약 절은 2칸이다.
 *
 * 인자는 **이미 이스케이프된 글**이다. 이스케이프가 먼저, 판정이 나중이다(설계 문서 §6).
 */
const bulletBody = (escaped: string): string =>
  escaped.trimStart().startsWith(BULLET) ? escaped : `${BULLET} ${escaped}`;

/**
 * 위반·notes 의 글머리 줄 하나를 만든다.
 *
 * **서버 문장 자체는 고치지 않는다.** 여기서 하는 일은 우리 글머리를 안 붙이는 것뿐이고,
 * `note` 원문은 그대로 나간다. 원문에 의존하는 곳이 셋이다 — `rejection-basis` 의 목 거절
 * 지문이 `→` 글머리를 완전 일치로 요구하고(ADR-0060), `--json` 의 `notes` 가 이 값이며,
 * cli 의 교정 요청 문안이 이 줄을 그대로 싣는다(`diagnostics.ts` 의 `responseBodyNotes`).
 *
 * 선행 공백은 보존한다. 서버가 하위 항목을 들여쓴 것이므로 우리가 펴면 계층이 사라진다.
 * 화살표가 둘 이상이면 그대로 둔다 — 우리가 하나를 안 붙이는 데까지가 이 함수의 몫이다.
 */
const bulletLine = (text: string): string => `${INDENT}${bulletBody(escapeTerminalText(text))}`;
```

그다음 `payloadNoticeLines` 정의 바로 뒤에 절을 더한다.

```ts
/** 실패 요약 절의 행 들여쓰기. 케이스 줄(0칸)과 진단 블록(4칸) 사이의 중간 층위다. 설계 문서 §4.2. */
const RECAP_INDENT = "  ";

/** 실패 요약 절의 머리글. 설계 문서 §3.2. */
const RECAP_HEADING = "실패한 케이스";

/**
 * 실패 요약 절에 싣는 케이스 상태. `cancelled` 는 사용자가 멈춘 사실이라 중단 줄이 이미
 * 말하고, `notRun` 은 옮길 진단이 없다(`executor.ts` 가 `operation` 에 진단을 안 넣는다).
 * 설계 문서 §3.2.
 *
 * 유니온을 손으로 복제하지 않는다. 복제해 두면 상태가 늘어도 여기는 모르고, vitest 는
 * 초록인데 typecheck 만 빨강인 상태가 만들어진다.
 */
const RECAP_STATUSES: ReadonlySet<TestCaseResult["status"]> = new Set(["failed", "timedOut"]);

/**
 * 요약 행 한 줄에 싣는 진단 글의 상한(코드 포인트). 넘으면 99자에서 자르고 `…` 를 붙인다.
 *
 * 100 은 리허설 실측에서 나온 가장 긴 실패 첫 줄(`Repository path 'example' is outside the
 * allowed repository '<절대경로>'`, 약 95자)이 잘리지 않는 값이다. 진단 값 자체는
 * `MAX_VALUE_STRING_CHARS`(200)로 한 번 잘려 오므로 여기 상한은 그 절반이다.
 *
 * **자르기가 정보를 잃지 않는다.** 원본은 같은 화면 위 케이스 블록에 온전히 있다. 이 행은
 * 가리키는 자리이지 판정 근거가 아니다(#447 과 다른 점이다). 설계 문서 §4.4.
 */
const MAX_RECAP_TEXT_CHARS = 100;

/** 코드 포인트 기준으로 자른다. slice 는 서로게이트 페어를 쪼갠다. */
const clampRecapText = (escaped: string): string =>
  width(escaped) <= MAX_RECAP_TEXT_CHARS
    ? escaped
    : `${Array.from(escaped)
        .slice(0, MAX_RECAP_TEXT_CHARS - 1)
        .join("")}…`;

/**
 * 케이스 블록이 그 케이스에 대해 찍은 줄 중 가장 구체적인 하나를 고른다. 설계 문서 §4.3.
 *
 * **새 문안을 만들지 않는다.** 고르기만 한다. `message` 는 판정의 참거짓만 말하는 고정 문안인
 * 경우가 많아(`IS_ERROR_MISMATCH`) 실패 여러 건이 전부 같은 문장이 된다. 서버가 준 이유와
 * 우리가 낸 위반이 케이스를 구분하므로 그쪽을 먼저 본다(ADR-0027 의 순서와 같다).
 *
 * 반환값은 이스케이프하지 않은 원문이다. 이스케이프는 호출부가 한다.
 */
const recapText = (result: TestCaseResult): string | undefined => {
  const source = result.operation.diagnostic ?? result.assertions.find(isDrawn)?.diagnostic;
  if (source === undefined) return undefined;
  return source.violations?.[0]?.message ?? source.notes?.[0] ?? source.message;
};

/**
 * 실패한 케이스만 모은 절(#446). 설계 문서 §4.
 *
 * **0건이면 아무 줄도 안 낸다.** 거절 고지·크기 고지와 같은 규칙이고, 그래야 전부 통과한
 * 실행의 출력이 이 변경 전과 바이트 그대로다.
 *
 * **요약 줄 앞이다.** 뒤에 두면 거절 근거 미확인 고지가 실패 목록의 각주로 읽힌다. 그 고지는
 * 통과한 케이스에 대한 말이다(ADR-0092).
 *
 * 반환 배열은 머리글, 행들, 빈 줄 하나로 끝난다. 그 빈 줄이 요약 줄과의 간격이다.
 */
const failedRecapLines = (report: RunnerReport, color: boolean): readonly string[] => {
  const members = report.cases.filter((result) => RECAP_STATUSES.has(result.status));
  if (members.length === 0) return [];
  // 이스케이프한 뒤의 폭으로 열을 맞춘다. 절에 실린 케이스끼리만 맞춘다(설계 문서 §4.2).
  const idColumn = members.reduce(
    (max, result) => Math.max(max, width(escapeTerminalText(result.spec.id))),
    0,
  );
  return [
    RECAP_HEADING,
    ...members.map((result) => {
      const mark = sgr(MARKS[result.status].sgr, MARKS[result.status].glyph, color);
      const id = pad(escapeTerminalText(result.spec.id), idColumn);
      const text = recapText(result);
      return text === undefined
        ? `${RECAP_INDENT}${mark} ${id}`
        : `${RECAP_INDENT}${mark} ${id}${GAP}${bulletBody(clampRecapText(escapeTerminalText(text)))}`;
    }),
    "",
  ];
};
```

마지막으로 `renderReport` 의 꼬리(현행 255~262줄)에 한 줄을 끼운다.

```ts
  lines.push("");
  if (report.stopReason !== undefined) {
    lines.push(stopReasonLine(report.stopReason, escapeTerminalText));
    lines.push("");
  }
  lines.push(...failedRecapLines(report, color));
  lines.push(summaryLine(report.summary));
  lines.push(...rejectionNoticeLines(report.summary));
  lines.push(...payloadNoticeLines(report.payload));
```

- [ ] **Step 6: 돌려서 새 테스트가 통과하는지 본다**

Run: `pnpm --filter @mcpeak/runner test -- reporter --run`
Expected: 새 테스트 2건 PASS. **기존 테스트 4건은 여기서 빨강이 된다.** 다음 스텝이 그것이다.

- [ ] **Step 7: 절이 생겨서 깨지는 기존 단언 4건을 갱신한다**

전부 같은 파일이다. 절이 생긴 것이 의도이므로 기대값을 늘린다. 판정 로직은 손대지 않는다.

**(1) `it("실패 케이스의 진단과 힌트를 그린다")`** 의 기대 배열에서 마지막 `""` 와 요약 줄
사이에 두 줄을 넣는다.

```ts
        "",
        "실패한 케이스",
        "  ✗ weather  → 진단 메시지",
        "",
        "1 failed  (1 total)",
```

`diagnostic("진단 메시지", "진단 힌트")` 는 `violations` 도 `notes` 도 없으므로 `message` 가
실린다(설계 문서 §4.3 의 3순위).

**(2) `it("케이스 레벨 진단을 단언 이름 없이 그린다")`** 도 같은 자리에 두 줄을 넣는다. 이
케이스는 `operation.diagnostic` 이 출처이므로 그 진단의 `message` 가 실린다. 실제 출력을
보고 기대 문자열을 맞춘다.

**(3) `it("다섯 상태 기호를 각각 쓴다")`** 는 `✗` 와 `⧖` 가 절에서 한 번씩 더 나온다.
기대를 상태별로 나눈다.

```ts
    const output = renderReport(report);
    // 절에 다시 실리는 것은 실패와 타임아웃뿐이다(설계 문서 §3.2).
    for (const glyph of ["✓", "⊘", "·"]) {
      expect(countOf(output, glyph)).toBe(1);
    }
    for (const glyph of ["✗", "⧖"]) {
      expect(countOf(output, glyph)).toBe(2);
    }
```

**(4) `it("화살표가 둘 이상이면 그대로 둔다")`** 는 절이 같은 `notes[0]` 을 한 번 더 실어
화살표가 4개가 된다. 세는 대상을 케이스 블록으로 좁힌다.

```ts
      // 절도 같은 줄을 한 번 더 싣는다(#446). 이 단언이 보는 것은 케이스 블록이다.
      const blockLines = rendered.split("\n").filter((line) => line.startsWith(INDENT_FOR_TEST));
      expect(countOf(blockLines.join("\n"), "→")).toBe(2);
      expect(rendered).toContain("    → → 서버가 두 개를 보냈다");
```

`INDENT_FOR_TEST` 는 파일 위쪽 상수 자리에 함께 둔다.

```ts
/** `renderReport` 가 케이스 본문 줄에 쓰는 들여쓰기. reporter.ts 의 INDENT 와 같은 값이다. */
const INDENT_FOR_TEST = "    ";
```

- [ ] **Step 8: 파일 전체를 돌려 초록인지 본다**

Run: `pnpm --filter @mcpeak/runner test -- reporter --run`
Expected: 전부 PASS. 실패가 남으면 기대값이 아니라 구현을 의심한다.

- [ ] **Step 9: 선택 규칙 4갈래를 고정하는 테스트를 쓴다**

설계 문서 §4.3 의 완료 조건 C5 다. 같은 describe 안에 잇는다.

```ts
    it("위반이 있으면 위반 첫 줄을 싣는다", () => {
      const report = makeReport([
        failing("schema", diagnostic("응답이 기대 스키마와 다릅니다. 위반 2건.", "힌트", [
          "$.temp: 필수 필드가 없습니다. 발견된 필드: 'temperature'",
          "$.unit: 스키마에 없는 필드입니다.",
        ])),
      ]);

      expect(lineWith(renderReport(report), "  ✗ schema")).toBe(
        "  ✗ schema  → $.temp: 필수 필드가 없습니다. 발견된 필드: 'temperature'",
      );
    });

    it("위반이 없고 notes 가 있으면 notes 첫 줄을 싣는다", () => {
      const report = makeReport([
        failing("iserror", {
          code: "IS_ERROR_MISMATCH",
          message: "정상 응답을 기대했지만 오류 응답을 받았습니다.",
          hint: "힌트",
          notes: ["ENOENT: no such file or directory", "두 번째 줄"],
        }),
      ]);

      expect(lineWith(renderReport(report), "  ✗ iserror")).toBe(
        "  ✗ iserror  → ENOENT: no such file or directory",
      );
    });

    it("위반도 notes 도 없으면 진단 message 를 싣는다", () => {
      const report = makeReport([failing("plain", diagnostic("메시지만 있다", "힌트"))]);

      expect(lineWith(renderReport(report), "  ✗ plain")).toBe("  ✗ plain  → 메시지만 있다");
    });

    it("케이스 레벨 진단이 단언 진단보다 앞선다", () => {
      const report = makeReport([
        testCase({
          id: "op",
          name: "이름",
          status: "failed",
          operationDiagnostic: diagnostic("케이스 레벨 문장", "힌트"),
          assertions: [assertion("isError", "failed", diagnostic("단언 문장", "힌트"))],
        }),
      ]);

      expect(lineWith(renderReport(report), "  ✗ op")).toBe("  ✗ op  → 케이스 레벨 문장");
    });
```

- [ ] **Step 10: 상태 선별과 열 맞춤을 고정하는 테스트를 쓴다**

```ts
    it("타임아웃 케이스도 절에 넣고 ⧖ 로 찍는다", () => {
      const report = makeReport([
        testCase({
          id: "slow",
          name: "느린 호출",
          status: "timedOut",
          operationDiagnostic: diagnostic("제한 시간 안에 완료되지 않았습니다.", "힌트"),
        }),
      ]);

      expect(lineWith(renderReport(report), "  ⧖ slow")).toBe(
        "  ⧖ slow  → 제한 시간 안에 완료되지 않았습니다.",
      );
    });

    it("취소와 미실행은 절에 넣지 않는다", () => {
      const report = makeReport([
        failing("real-failure", diagnostic("메시지", "힌트")),
        testCase({
          id: "aborted",
          name: "취소",
          status: "cancelled",
          operationDiagnostic: diagnostic("외부 요청으로 취소되었습니다.", "힌트"),
        }),
        testCase({ id: "skipped-case", name: "미실행", status: "notRun" }),
      ]);

      const recap = renderReport(report)
        .split("\n")
        .slice(renderReport(report).split("\n").indexOf("실패한 케이스") + 1)
        .filter((line) => line.startsWith("  "));

      expect(recap).toEqual(["  ✗ real-failure  → 메시지"]);
    });

    it("절의 행 수가 failed 와 timedOut 의 합이다", () => {
      const report = makeReport([
        testCase({ id: "p", name: "통과", status: "passed" }),
        failing("f1", diagnostic("메시지1", "힌트")),
        failing("f2", diagnostic("메시지2", "힌트")),
        testCase({
          id: "t1",
          name: "타임아웃",
          status: "timedOut",
          operationDiagnostic: diagnostic("메시지3", "힌트"),
        }),
      ]);

      const lines = renderReport(report).split("\n");
      const start = lines.indexOf("실패한 케이스");
      const rows = lines.slice(start + 1).filter((line) => line.startsWith("  ✗") || line.startsWith("  ⧖"));

      expect(rows).toHaveLength(report.summary.failed + report.summary.timedOut);
    });

    it("id 열은 절에 실린 케이스끼리만 맞춘다", () => {
      const report = makeReport([
        testCase({ id: "a-very-long-passing-id", name: "통과", status: "passed" }),
        failing("f1", diagnostic("메시지1", "힌트")),
        failing("longer-id", diagnostic("메시지2", "힌트")),
      ]);

      const rendered = renderReport(report);
      expect(lineWith(rendered, "  ✗ f1")).toBe("  ✗ f1         → 메시지1");
      expect(lineWith(rendered, "  ✗ longer-id")).toBe("  ✗ longer-id  → 메시지2");
    });
```

- [ ] **Step 11: 이스케이프·화살표·자르기·색상을 고정하는 테스트를 쓴다**

```ts
    it("절의 id 와 글도 제어 문자를 이스케이프한다", () => {
      const report = makeReport([
        failing(`c1${ESC}[2J`, diagnostic(`메시지${ESC}[2J`, "힌트")),
      ]);

      const rendered = renderReport(report);
      const row = lineWith(rendered, "  ✗ c1");
      expect(row).toContain(`c1${ESCAPED_ESC}[2J`);
      expect(row).toContain(`메시지${ESCAPED_ESC}[2J`);
      expect(row).not.toContain(`${ESC}[2J`);
    });

    it("서버 줄이 이미 → 로 시작하면 절에서도 겹치지 않는다", () => {
      const report = makeReport([
        failing("arrowed", {
          code: "IS_ERROR_MISMATCH",
          message: "메시지",
          hint: "힌트",
          notes: ["→ 서버가 붙인 글머리"],
        }),
      ]);

      const rendered = renderReport(report);
      expect(rendered).not.toContain("→ →");
      expect(lineWith(rendered, "  ✗ arrowed")).toBe("  ✗ arrowed  → 서버가 붙인 글머리");
    });

    it("100자를 넘는 글은 99자에서 자르고 … 를 붙인다", () => {
      const long = "가".repeat(150);
      const report = makeReport([failing("long", diagnostic(long, "힌트"))]);

      const row = lineWith(renderReport(report), "  ✗ long");
      const text = row.slice("  ✗ long  → ".length);
      expect(Array.from(text)).toHaveLength(100);
      expect(text.endsWith("…")).toBe(true);
      expect(text.startsWith("가".repeat(99))).toBe(true);
    });

    it("100자 이하인 글은 자르지 않는다", () => {
      const exact = "나".repeat(100);
      const report = makeReport([failing("exact", diagnostic(exact, "힌트"))]);

      expect(lineWith(renderReport(report), "  ✗ exact")).toBe(`  ✗ exact  → ${exact}`);
    });

    it("절은 기호에만 색을 넣는다", () => {
      const report = makeReport([failing("colored", diagnostic("메시지", "힌트"))]);

      const row = lineWith(renderReport(report, { color: true }), "colored  →");
      expect(row).toBe(`  ${ESC}[31m✗${ESC}[0m colored  → 메시지`);
    });

    it("중단 줄이 있으면 절은 중단 줄 뒤, 요약 줄 앞이다", () => {
      const report = makeReport(
        [
          failing("f1", diagnostic("메시지", "힌트")),
          testCase({ id: "n1", name: "미실행", status: "notRun" }),
        ],
        { stopReason: { type: "timeout", caseId: "f1" } },
      );

      const lines = renderReport(report).split("\n");
      const stopIndex = lines.findIndex((line) => line.startsWith("중단:"));
      const recapIndex = lines.indexOf("실패한 케이스");
      const summaryIndex = lines.findIndex((line) => line.includes("total)"));

      expect(stopIndex).toBeGreaterThanOrEqual(0);
      expect(recapIndex).toBeGreaterThan(stopIndex);
      expect(summaryIndex).toBe(recapIndex + 3);
    });
```

- [ ] **Step 12: 파일 전체를 돌린다**

Run: `pnpm --filter @mcpeak/runner test -- reporter --run`
Expected: 전부 PASS. 출력에서 수집된 테스트 수가 늘었는지 확인한다.

- [ ] **Step 13: 패키지 전체 회귀를 본다**

Run: `pnpm --filter @mcpeak/runner test --run`
Expected: 전부 PASS. 특히 `junit.test.ts`(C10)와 `report-payload-notice.test.ts`(§6.1)가
**수정 없이** 통과해야 한다. 이 둘이 빨강이면 구현이 요약 줄 뒤에 절을 넣은 것이다.

- [ ] **Step 14: 저장소 전체 판정과 타입·린트를 본다**

```sh
pnpm build --force
pnpm test
pnpm typecheck --force
pnpm lint
```

Expected: 전부 PASS. `typecheck` 와 `build` 출력에서 `Cached: 0 cached` 를 확인한다.
`packages/cli/tests/dry-run.test.ts` 와 `repair-bundle-write.test.ts` 가 **수정 없이** 통과해야
한다(C11). 여기서 `cli` 테스트가 빨강이면 **고치지 말고 `BLOCKED` 로 보고한다.** 그 패키지는
다른 오너 소유이고, 빨강 자체가 설계 §6.2 의 전제가 틀렸다는 뜻이다.

- [ ] **Step 15: 보고한다**

`status: READY_FOR_REVIEW` 또는 `status: BLOCKED` 로 시작하는 보고를 낸다. 변경 파일, 실행한
검증 명령과 그 출력, 남은 위험을 적는다. **커밋하지 않는다.**

---

### Task T2: 설계 문서·ADR·changeset

**Files:**
- Modify: `docs/superpowers/specs/2026-08-13-cli-report-rendering-design.md`
- Create: `docs/adr/0092-실패-요약-절은-요약-줄-앞에-두고-가장-구체적인-진단-줄을-옮긴다.md`
- Create: `.changeset/<changesets 가 정한 이름>.md`
- Modify: `docs/adr/README.md` (색인이 있으면 한 줄 추가)

**Interfaces:**
- Consumes: T1 이 확정한 출력 형태. **실제 렌더 출력을 보고 예시를 적는다.** 계획서의 예시를
  베끼지 않는다.
- Produces: 없다.

**선행:** T1 이 통합돼 있어야 한다. 통합 SHA 가 `docs/task-integration-ledger.tsv` 에 있고
`git cat-file -e` 와 `git merge-base --is-ancestor` 로 확인돼야 한다.

- [ ] **Step 1: 렌더링 설계 §5.1 의 전체 구조 그림을 갱신한다**

`docs/superpowers/specs/2026-08-13-cli-report-rendering-design.md` 의 §5.1 코드 블록을 아래로
바꾼다.

```
{suite.name}  ({N} cases)
                                  <- 빈 줄
{케이스 줄}
{케이스 줄}
...
                                  <- 빈 줄
{중단 줄}                          <- stopReason 이 있을 때만, 그 뒤 빈 줄
{실패 요약 절}                      <- failed + timedOut > 0 일 때만, 그 뒤 빈 줄 (§5.7)
{요약 줄}
```

- [ ] **Step 2: 렌더링 설계에 §5.7 을 신설하고 기존 §5.7 색상을 §5.8 로 민다**

새 §5.7 은 `docs/superpowers/specs/2026-09-10-failed-case-recap-design.md` §4.2~§4.5 를 요약해
옮긴다. 최소한 아래를 담는다. 문서 안의 `§5.7` 참조가 다른 곳에 있으면 함께 고친다
(`grep -rn "§5.7" docs/ packages/` 로 확인한다. `reporter.ts` 의 주석도 대상이다).

- 행의 형태 `{두 칸}{mark} {caseId 패딩}{두 칸}→ {진단 글}`
- 실리는 상태는 `failed` 와 `timedOut` 뿐이라는 것과 그 이유
- 진단 글 선택 규칙 3순위(`violations[0]` → `notes[0]` → `message`)
- `MAX_RECAP_TEXT_CHARS` 100 과 그 근거
- `caseId` 열은 절에 실린 케이스끼리만 맞춘다는 것
- 0건이면 한 줄도 내지 않는다는 것

§5.8 색상 표에는 절의 `✗`·`⧖` 가 케이스 줄과 같은 SGR 을 쓰고 머리글·id·글에는 색이 없다는
행을 더한다.

- [ ] **Step 3: ADR-0092 을 쓴다**

다섯 항목(배경 / 선택지 / 결정 / 이유 / 결과)이다. 내용은 설계 문서 §9 초안을 그대로 옮기되,
선택지 절에는 §3.1 의 표(A·B·C)와 §3.3 의 표(R1·R2)를 싣는다. 한 페이지면 충분하다.
기존 ADR 의 머리말 형식(`docs/adr/0090-…md`)을 그대로 따른다.

- [ ] **Step 4: 색인을 갱신한다**

Run: `grep -n "0091" docs/adr/README.md`
색인 줄이 있으면 같은 형식으로 0092 줄을 더한다. 없으면 이 스텝을 건너뛴다.

- [ ] **Step 5: changeset 을 만든다**

Run: `pnpm changeset`

`@mcpeak/runner` 를 고르고 `minor` 를 고른다. 새 기능이고 기존 출력의 파괴적 변경이 아니다.
본문은 아래로 한다.

```
시험 실행 보고서의 요약 줄 앞에 실패한 케이스만 모은 절이 나옵니다. 케이스가 수십 개인 서버에서
실패를 스크롤로 찾지 않아도 됩니다. 각 행은 케이스 id 와 그 케이스에 대해 화면이 이미 찍은
진단 줄 하나를 담고, 새 문안을 만들지 않습니다. 실패와 타임아웃이 0건이면 절 자체가 나오지
않으므로 전부 통과한 실행의 출력은 이전과 같습니다.
```

- [ ] **Step 6: 문서만 바뀌었는지 확인한다**

Run: `git status --short`
Expected: `docs/` 와 `.changeset/` 아래 파일만. `packages/` 아래가 보이면 잘못 건드린 것이다.

- [ ] **Step 7: 전체 판정을 다시 본다**

```sh
pnpm test
pnpm lint
```

Expected: 전부 PASS. 문서 변경이라 깨질 것이 없지만, changeset 파일 형식 오류를 여기서 잡는다.

- [ ] **Step 8: 보고한다**

`status: READY_FOR_REVIEW` 또는 `status: BLOCKED` 로 시작하는 보고를 낸다. **커밋하지 않는다.**

---

## 통합 게이트

각 태스크의 자식 보고를 받은 뒤 오케스트레이터가 직접 확인한다. 자식의 "완료" 선언은 단서일
뿐이다.

**T1 게이트**

1. `git diff` 로 변경 파일이 `packages/runner/src/reporter.ts` 와
   `packages/runner/tests/reporter.test.ts` 둘뿐인지 확인한다.
2. `pnpm test`, `pnpm typecheck --force`, `pnpm lint` 를 오케스트레이터가 **다시** 돌린다.
   `typecheck` 출력에서 `Cached: 0 cached` 를 확인한다.
3. 완료 조건 C1~C12 를 diff 와 테스트 목록에 대응시킨다. 대응이 없는 조건이 있으면 통합하지 않는다.
4. 통합한 뒤 SHA 를 `docs/task-integration-ledger.tsv` 에 `T1-failed-case-recap-runner` 로
   기록하고 별도 문서 커밋으로 보존한다.

**T2 게이트**

1. `git diff` 로 `packages/` 아래가 하나도 없는지 확인한다.
2. `.changeset/` 에 이 브랜치가 **새로** 추가한 파일이 있는지 확인한다.
   `git diff --name-only origin/main...HEAD -- .changeset/` 의 출력이 비어 있으면 CI 의
   `changeset-check` 가 떨어진다.
3. 렌더링 설계 §5.7 의 서술이 T1 의 실제 출력과 일치하는지 눈으로 대조한다.
4. 완료 조건 C14 를 확인한다.
5. 통합 SHA 를 `T2-failed-case-recap-docs` 로 대장에 기록한다.

**W2 게이트 (실환경 검증, 직렬)**

설계 문서 §7 을 그대로 수행한다. 프리플라이트가 하나라도 불명확하면 아무것도 바꾸지 않고
`BLOCKED` 다. 샌드박스는 저장소 밖 임시 디렉터리에만 만들고 저장소 파일을 바꾸지 않는다.
결과를 `W2-failed-case-recap-live` 로 대장에 기록하고, 관측을 `docs/adoption.md` 에 한 항목으로
남긴다. 완료 조건 C13·C15 가 여기서 판정된다.

**최종 리뷰 게이트**

PR 을 열기 전에 완료 조건 C1~C15 전부를 다시 훑는다. 하나라도 판정 근거가 없으면 PR 을 열지
않는다. PR 본문은 `.github/pull_request_template.md` 를 그대로 따르고 `Closes #446` 을 넣는다.

---

## 실행 프롬프트

### 터미널 1 (T1 → T2)

**권장 실행 설정:** 모델은 **상위 모델**(`CLAUDE.local.md` 모델 표의 예외 항목: 실패 메시지 문안
설계), 추론 수준은 높게, 에이전트 종류는 일반 구현 에이전트. 아래 블록을 프로젝트 루트에서 연
터미널에 그대로 붙여넣는다.

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

  git worktree add .claude/worktrees/mcpeak-failed-case-recap -b feat/runner-failed-case-recap HEAD

를 실행한 뒤 그 경로로 세션을 옮겨라(EnterWorktree 도구에 path 로
.claude/worktrees/mcpeak-failed-case-recap 을 넘긴다. name 으로 새로 만들게 하지 마라).

진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 status: BLOCKED 로 보고해라:
  - pwd 가 <저장소 루트>/.claude/worktrees/mcpeak-failed-case-recap 인지
  - git log --oneline -1 이 프로젝트 루트에서 본 기점 커밋과 같은지
  - docs/superpowers/plans/2026-09-10-failed-case-recap-implementation.md 가 존재하는지
  - docs/superpowers/specs/2026-09-10-failed-case-recap-design.md 가 존재하는지
  - docs/superpowers/specs/2026-08-13-cli-report-rendering-design.md 가 존재하는지
  - git status --short 가 비어 있는지
  - pnpm install 을 돌린 뒤 pnpm build 가 성공하는지
    (새 worktree 는 node_modules 를 상속하지 않는다. 이걸 건너뛰면 테스트가 실패하는 게
     아니라 자식 프로세스가 시작조차 못 해 타임아웃처럼 보인다)
  - pnpm --filter @mcpeak/runner test -- reporter --run 이 실제로 실행되고 테스트를
    수집하는지 (수집 0개가 초록으로 보이는 거짓 신호를 여기서 배제한다)

[2단계: 실행]

너는 구현 에이전트다. 아래 두 태스크를 순서대로 실행한다.

  Task T1: 리포터에 실패 요약 절을 넣는다
  Task T2: 설계 문서·ADR·changeset

계획서는 docs/superpowers/plans/2026-09-10-failed-case-recap-implementation.md 이고,
설계 문서는 docs/superpowers/specs/2026-09-10-failed-case-recap-design.md 다. 둘 다 먼저
전부 읽어라. 계획서의 「전역 제약」 절은 두 태스크 모두에 적용된다.

T1 의 허용 Files 는 이 둘뿐이다:
  packages/runner/src/reporter.ts
  packages/runner/tests/reporter.test.ts

T2 의 허용 Files 는 이것들뿐이다:
  docs/superpowers/specs/2026-08-13-cli-report-rendering-design.md
  docs/adr/0092-실패-요약-절은-요약-줄-앞에-두고-가장-구체적인-진단-줄을-옮긴다.md (신규)
  docs/adr/README.md
  .changeset/ 아래 새 파일 하나

수정 금지 공유 계약이다. 어긋나 보여도 고치지 말고 status: BLOCKED 로 보고해라:
  - 다른 오너의 패키지 (packages/cli, packages/core, packages/generate, packages/record,
    packages/mock, packages/dashboard). 읽기만 한다
  - packages/core/src/types.ts 의 McpClient · ToolResult 인터페이스
  - 루트 빌드 설정 (package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json)

특히 T1 Step 14 에서 packages/cli 의 테스트가 빨강이면 그것을 고치지 마라. 설계 문서 §6.2 가
"cli 는 영향받지 않는다" 를 근거와 함께 주장하고 있으므로, 빨강은 그 주장이 틀렸다는 뜻이고
사람이 판단해야 한다. 그대로 status: BLOCKED 로 보고해라.

그 밖의 규칙:
  - 의존 방향은 단방향이다: cli → runner/generate/record/mock → core. 역참조·순환 금지
  - @modelcontextprotocol/sdk 는 1.x 고정이다. 목록 밖 의존성 추가 금지
  - 커밋·푸시·머지를 하지 마라. git 명령은 1단계의 worktree 생성·진입이 전부다
  - 백그라운드 실행을 하지 마라
  - 하위 에이전트를 스폰하지 마라
  - 다른 작업자의 변경을 되돌리지 마라
  - 유닛테스트는 인메모리와 packages/runner/tests/fixtures/ 만 쓴다. examples/ 의 실제 서버
    프로세스를 띄우지 마라. 그 검증은 별도 직렬 웨이브다
  - 산문에 대시(—)를 쓰지 마라. 주석과 문서는 한국어로 쓴다

테스트 명령:
  표적    pnpm --filter @mcpeak/runner test -- reporter --run
  패키지  pnpm --filter @mcpeak/runner test --run
  전체    pnpm build --force && pnpm test && pnpm typecheck --force && pnpm lint

turbo 캐시가 이전 녹색을 재생한다. 전체 판정에서는 --force 로 돌리고 출력에서
"Cached: 0 cached" 를 확인해라. 그 줄을 못 봤으면 판정한 것이 아니다.

보고서는 .claude/worktrees/mcpeak-failed-case-recap/docs/reports/task-failed-case-recap.md 에
쓴다. 태스크별로 절을 나눈다.

완료 형식. 최종 응답의 첫 줄은 반드시 다음 중 하나로 시작한다:
  status: READY_FOR_REVIEW
  status: BLOCKED
그 아래에 변경 파일 목록, 실행한 검증 명령과 실제 출력(특히 "Cached: 0 cached" 줄과 테스트
통과 수), 보고서 절대 경로, 남은 위험을 적는다. 커밋은 하지 않는다.
```

---

## 자체 검토

- **완료 조건 대응.** C1·C3·C4·C5·C6·C7·C8 은 T1 Step 1·9·10·11 의 테스트가, C2 는 Step 3 과
  Step 11 마지막 테스트가, C9·C11 은 T1 Step 14 가, C10 은 T1 Step 13 이, C12 는 T1 Step 14 가,
  C14 는 T2 Step 1·2 가, C13·C15 는 W2 게이트가 받는다. 대응 없는 조건은 없다.
- **공유 계약.** 이 작업은 공유 계약을 만들지 않는다. `RunnerReport` 계열 타입을 읽기만 하고
  `renderReport` 의 시그니처가 그대로다. 그래서 선행 태스크로 분리할 것이 없다.
- **파일 소유권.** T1 과 T2 의 쓰기 파일이 겹치지 않는다. 순차 실행이므로 충돌 자체가 없다.
- **모델.** 두 태스크 모두 상위 모델이고 사유를 실행 모델 절에 적었다. 하위 모델에 설계 판단을
  넘기지 않았다.
- **테스트 격리.** 유닛테스트는 인메모리 픽스처만 쓴다. `examples/` 를 띄우는 검증은 W2 로
  분리했다.
- **리뷰 루프.** T1 게이트, T2 게이트, W2 게이트, 최종 리뷰 게이트 넷이 있다.
- **타입 일관성.** `bulletBody`·`clampRecapText`·`recapText`·`failedRecapLines` 의 이름과
  시그니처가 설계 문서 §5.3 과 계획서 T1 Step 5 에서 동일하다. `RECAP_STATUSES` 는
  `TestCaseResult["status"]` 를 참조하고 유니온을 복제하지 않는다.
