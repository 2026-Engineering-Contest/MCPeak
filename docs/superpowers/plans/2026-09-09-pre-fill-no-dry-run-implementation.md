# AI 사전보완의 `--no-dry-run` 준수 구현 계획 (이슈 #397)

> **실행자에게:** 이 계획은 태스크 단위로 실행한다. 터미널은 하나이고 §7 의 실행 프롬프트를
> 그대로 붙여넣어 시작한다. 스텝은 체크박스(`- [ ]`)로 추적한다.

**목표:** `--no-dry-run` 에서는 AI 사전보완을 포함해 `callTool` 이 0회가 되게 하고, 사전보완이
실제 서버를 부른다는 사실을 전송 확인 화면에 적는다.

**접근:** `runPreFill` 에 `input.dryRun` 분기 하나를 넣어 전송 확인 앞에서 건너뛴다. 실행 없이
채택하는 모드는 만들지 않는다(설계 §3.2). 화면 문안 두 줄과 도움말·README 한 문장을 더한다.
채택 규칙과 기본 경로는 건드리지 않는다.

**기술 스택:** TypeScript, vitest, pnpm workspace. 새 의존성 없음.

**설계 문서:** `docs/superpowers/specs/2026-09-09-pre-fill-no-dry-run-design.md`
(실행자는 계획서와 설계 문서를 함께 읽는다.)

## 전역 제약

모든 태스크에 적용된다.

- **`core/src/types.ts` 의 `McpClient` · `ToolResult` 를 수정하지 않는다.** 필요해 보이면 제안만
  하고 보고한다.
- **`@modelcontextprotocol/sdk` 는 1.x 고정.** `^` 를 붙이지 않는다.
- **목록에 없는 의존성을 추가하지 않는다.** 이 계획은 새 의존성이 필요 없다.
- **의존 방향은 단방향이다:** `cli` → `runner`/`generate`/`record`/`mock` → `core`. 역참조·순환
  금지.
- **자기 태스크의 Files 목록 밖 파일을 수정하지 않는다.** 이 계획은 `packages/cli` 와 문서만
  건드린다. `packages/generate` 의 `preparePreFillRequest` 등 다른 패키지는 읽기만 한다.
- **커밋·푸시는 사람이 한다.** 서브에이전트는 git 명령을 실행하지 않는다.
- **유닛테스트는 인메모리와 `fixtures/` 만 쓴다.** 실제 서버 프로세스는 W3 에서만 띄운다.
- 산문에 대시(—)를 쓰지 않는다. 커밋 메시지는 한국어, Conventional Commits, scope 필수.

## 1. 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `packages/cli/src/generate-command.ts` | `runPreFill` 의 `dryRun` 분기, `showPreFillRequest` 의 실행 고지 줄 | T1 |
| `packages/cli/src/help.ts` | `--no-dry-run` 도움말 둘째 줄 | T1 |
| `packages/cli/tests/pre-fill-command.test.ts` | 명령 수준 테스트 5개 추가, 기존 2개에 단언 추가 | T1 |
| `packages/cli/tests/help.test.ts` | 도움말 단언 1개 추가 | T1 |
| `README.md` (루트) | `generate` 절에 한 문장 | T2 |
| `docs/adr/0089-시험-실행이-꺼지면-사전보완도-건너뛴다.md` | ADR 초안 | T2 |
| `docs/adr/README.md` | 색인 한 줄 | T2 |
| `.changeset/cli-pre-fill-no-dry-run.md` | `@mcpeak/cli` patch | T2 |

## 2. 태스크

### Task T1: `--no-dry-run` 분기와 화면 문안 (`cli`)

**Files**
- 수정: `packages/cli/src/generate-command.ts` (`showPreFillRequest` 약 1889-1910행, `runPreFill`
  약 2034-2100행. 줄 번호는 심볼로 다시 찾는다)
- 수정: `packages/cli/src/help.ts` (`--no-dry-run` 설명, 약 88-89행)
- 수정: `packages/cli/tests/pre-fill-command.test.ts`
- 수정: `packages/cli/tests/help.test.ts`

**인터페이스**
- 소비: `GenerateCommandInput.dryRun: boolean`(이미 있다), `PreFillRequestPreview.request.cases`.
- 산출: 없음. 공개 시그니처를 바꾸지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/cli/tests/pre-fill-command.test.ts` 의 `describe("사전보완 채택")` 뒤에 새 `describe`
를 더하고, 기존 두 테스트에 단언을 더한다. 헬퍼(`needsHelp` · `allDeclared` · `fakeConnection`
· `reviewIO` · `deps` · `argv`)는 파일에 이미 있는 것을 그대로 쓴다.

```ts
describe("--no-dry-run 과 사전보완", () => {
  it("--no-dry-run 이면 사전보완을 건너뛰고 서버를 한 번도 부르지 않는다", async () => {
    const events: string[] = [];
    const connection = fakeConnection(events);
    const stdout: string[] = [];
    const io = reviewIO(true, stdout);
    // 검토 메뉴에서 취소한다(reviewIO 의 choose 기본값). 이슈의 재현 절차 그대로다.
    const preFill = vi.fn(async () => ({
      proposals: [{ caseId: "needs-help-success", field: "timezone", valueJson: '"Asia/Seoul"' }],
    }));
    const sessionSpy = vi.fn(createAuthoringSession);

    const code = await runGenerateCommand(
      argv("/tmp/mcpeak-pre-fill-8.json", ["--no-dry-run", "--provider", "codex", "--model", "m"]),
      deps({
        tools: [needsHelp],
        connection,
        stdout,
        io,
        sessionSpy: sessionSpy as never,
        provider: { id: "codex", model: "m", preFill },
      }),
    );

    expect(code).toBe(0);
    // 이슈 #397 의 핵심 단언. 시험 실행을 끈 경로에서 툴 호출은 0회다.
    expect(events).toEqual([]);
    expect(connection.client.callTool).not.toHaveBeenCalled();
    // provider 도 부르지 않는다. 채택을 정할 실행이 없으면 제안을 받을 이유가 없다.
    expect(preFill).not.toHaveBeenCalled();

    const text = stdout.join("");
    expect(text).toContain("시험 실행이 꺼져 있어(--no-dry-run) AI 사전보완을 건너뜁니다.");
    expect(text).toContain("AI 사전보완이 필요하면 --no-dry-run 없이 실행하세요.");
    // 전송 확인 화면까지 가지 않는다.
    expect(text).not.toContain("AI 사전보완 요청");

    // baseline 케이스를 잃지 않고, 출처도 baseline 그대로다.
    const [passed, sessionOptions] = sessionSpy.mock.calls[0] ?? [];
    expect(passed?.suite.cases.some((item) => item.id === "needs-help-success")).toBe(true);
    expect(sessionOptions?.preFilledCaseIds).toEqual([]);
  });

  it("--no-dry-run 에서 채울 빈틈이 없으면 건너뜀 고지를 찍지 않는다", async () => {
    const events: string[] = [];
    const connection = fakeConnection(events);
    connection.client.listTools = vi.fn(async () => [allDeclared]) as never;
    const stdout: string[] = [];
    const preFill = vi.fn(async () => ({ proposals: [] }));

    const code = await runGenerateCommand(
      argv("/tmp/mcpeak-pre-fill-9.json", ["--no-dry-run", "--provider", "codex", "--model", "m"]),
      deps({
        tools: [allDeclared],
        connection,
        stdout,
        io: reviewIO(true, stdout),
        provider: { id: "codex", model: "m", preFill },
      }),
    );

    expect(code).toBe(0);
    expect(events).toEqual([]);
    expect(preFill).not.toHaveBeenCalled();
    // 원래 돌지 않을 회차를 "건너뛴다" 고 하면 거짓이다.
    expect(stdout.join("")).not.toContain("AI 사전보완을 건너뜁니다");
  });

  it("--no-dry-run --baseline-only 는 저장까지 서버를 부르지 않는다", async () => {
    const events: string[] = [];
    const connection = fakeConnection(events);
    const preFill = vi.fn(async () => ({ proposals: [] }));

    const code = await runGenerateCommand(
      argv("/tmp/mcpeak-pre-fill-10.json", ["--no-dry-run", "--baseline-only", "--provider", "codex"]),
      deps({
        tools: [needsHelp],
        connection,
        provider: { id: "codex", model: "m", preFill },
      }),
    );

    expect(code).toBe(0);
    expect(events).toEqual([]);
    expect(preFill).not.toHaveBeenCalled();
  });

  it("전송 확인 화면이 실제 서버 실행을 확인 전에 고지한다", async () => {
    const events: string[] = [];
    const connection = fakeConnection(events);
    const stdout: string[] = [];
    const io = reviewIO(true, stdout);
    /** confirm 이 불린 순간까지의 화면. 확인 뒤에 찍히면 승인 근거가 못 된다. */
    let seenAtConfirm = "";
    io.confirm = vi.fn(async () => {
      if (seenAtConfirm === "") seenAtConfirm = stdout.join("");
      return true;
    });

    await runGenerateCommand(
      argv("/tmp/mcpeak-pre-fill-11.json", ["--provider", "codex", "--model", "m"]),
      deps({
        tools: [needsHelp],
        connection,
        stdout,
        io,
        provider: {
          id: "codex",
          model: "m",
          preFill: vi.fn(async () => ({
            proposals: [
              { caseId: "needs-help-success", field: "timezone", valueJson: '"Asia/Seoul"' },
            ],
          })),
        },
      }),
    );

    // 케이스 수는 같은 화면의 `대상:` 줄과 같은 값이라 숫자를 고정하지 않는다.
    expect(seenAtConfirm).toMatch(
      /채택 판정: 제안을 받으면 대상 케이스 \d+개를 baseline 값과 제안 값으로 실제 서버에 각각 한 번씩\n {2}실행합니다\. 상태를 바꾸는 툴이면 그 부작용이 남습니다\./,
    );
    // 고지가 실행 앞에 있었다는 뜻이다. 확인 시점에는 결과 요약이 아직 없다.
    expect(seenAtConfirm).not.toContain("AI 사전보완: 툴");
    expect(events.length).toBeGreaterThan(0);
  });
});
```

기존 테스트 두 곳에 단언을 더한다.

`전송을 승인하지 않으면 baseline 값 그대로 간다` 의 마지막에:

```ts
    // 전송 거절이 실제 호출을 막는 지점이다(설계 §3.3).
    expect(events).toEqual([]);
```

`provider 가 죽어도 툴을 건너뛰지 않고 baseline 으로 진행한다` 는 `fakeConnection([])` 을
`const events: string[] = []; const connection = fakeConnection(events);` 로 바꾸고 마지막에:

```ts
    // 제안이 없으면 실행할 후보도 없다. 서버를 부르지 않는다.
    expect(events).toEqual([]);
```

`packages/cli/tests/help.test.ts` 의 `--no-dry-run` 단언(약 34행) 바로 뒤에:

```ts
    expect(help).toContain("않은 채 저장되고, 실행이 필요한 AI 사전보완도 건너뜁니다");
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run --root . packages/cli/tests/pre-fill-command.test.ts packages/cli/tests/help.test.ts`
Expected: 새 테스트 4개와 도움말 단언이 실패한다. 첫 테스트는 `events` 가
`['callTool:{"timezone":"example"}', 'callTool:{"timezone":"Asia/Seoul"}']` 로 나와 실패해야
한다. 이것이 이슈의 재현이다. 기존 테스트에 더한 `events` 단언 두 개는 지금도 통과한다(제안이
없거나 거절하면 원래 호출이 없다).

- [ ] **Step 3: `runPreFill` 에 분기를 넣는다**

`packages/cli/src/generate-command.ts` 의 `runPreFill` 에서 `if (request === null) return skip;`
바로 뒤, `let view: PreFillRequestPreview;` 앞에 넣는다.

```ts
  // 채택은 실제 실행이 정한다(설계서 §4.4). 시험 실행을 끈 경로에는 그 실행이 없으므로 제안을
  // 받을 이유도 없다. 실행 없이 채택하는 모드는 만들지 않는다(#397, ADR-0089). 대상 판정 뒤에
  // 두는 이유는 채울 빈틈이 없는 서버에서 "건너뜁니다" 가 거짓이 되기 때문이다.
  if (!input.dryRun) {
    io.write(
      "▸ 시험 실행이 꺼져 있어(--no-dry-run) AI 사전보완을 건너뜁니다. 제안 값의 채택은 실제 서버\n" +
        "  실행이 정하는데 그 실행이 없습니다. baseline 값으로 진행합니다.\n" +
        "  AI 사전보완이 필요하면 --no-dry-run 없이 실행하세요.\n",
    );
    return skip;
  }
```

`runPreFill` 의 doc 주석 마지막 문단 뒤에 한 문단을 더한다.

```ts
 * **`--no-dry-run` 이면 돌지 않는다.** 채택을 정하는 것이 실제 서버 실행인데 그 경로에는 실행이
 * 없다. 이 분기가 빠져 있어 시험 실행을 끄고도 툴이 두 번 호출됐다(#397).
```

- [ ] **Step 4: 전송 확인 화면에 실행 고지 줄을 더한다**

`showPreFillRequest` 의 `io.write` 문자열에서 `"받는 것: 값 제안뿐입니다. ..."` 줄 다음에
한 줄을 더한다.

```ts
      "받는 것: 값 제안뿐입니다. 케이스를 더하거나 구조를 바꾸지 않습니다.\n" +
      `채택 판정: 제안을 받으면 대상 케이스 ${request.cases.length}개를 baseline 값과 제안 값으로 실제 서버에 각각 한 번씩\n` +
      "  실행합니다. 상태를 바꾸는 툴이면 그 부작용이 남습니다.\n",
```

함수 doc 주석에 한 문장을 더한다: `실제 서버 호출이 이 확인 뒤에 일어난다는 사실도 여기서
말한다. 저장 메뉴의 "계속할까요?" 만 보고 온 사용자가 그 앞의 호출을 모른 채 승인하면 안 된다(#397).`

- [ ] **Step 5: 도움말을 고친다**

`packages/cli/src/help.ts` 의 `--no-dry-run` 두 줄을 아래로 바꾼다. 첫 줄은 그대로다.

```
  --no-dry-run          승인 전 시험 실행을 건너뜁니다. 케이스가 실제 서버에서 확인되지
                        않은 채 저장되고, 실행이 필요한 AI 사전보완도 건너뜁니다
```

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm vitest run --root . packages/cli/tests/pre-fill-command.test.ts packages/cli/tests/help.test.ts packages/cli/tests/pre-fill-screen.test.ts`
Expected: 전부 통과. 특히 `baseline 이 실패하고 제안이 통과하면 AI 값을 쓰고 출처를 남긴다` 가
그대로 통과해야 한다(기본 경로 무변경).

- [ ] **Step 7: 패키지 전체 회귀**

Run: `pnpm --filter @mcpeak/cli test` 와 `pnpm typecheck --force` 와 `pnpm biome ci packages/cli`
Expected: 전부 통과. typecheck 출력에 `Cached: 0 cached`.

- [ ] **Step 8: 보고**

`docs/reports/task-t1-pre-fill-no-dry-run.md` 에 `pwd`, `git rev-parse HEAD`, 기점 커밋, 실행한
명령과 결과, Step 2 에서 관측한 실패 출력(이슈 재현 증거)을 적는다. 커밋은 사람이 한다.
메시지: `fix(cli): --no-dry-run 이면 AI 사전보완도 건너뛰어 툴 호출을 0회로 만든다`.

### Task T2: 문서 · ADR · changeset

**Files**
- 수정: `README.md` (루트, `generate` 절 "기본은 실제 서버에 한 번 돌려보고..." 문단, 약 102행)
- 생성: `docs/adr/0089-시험-실행이-꺼지면-사전보완도-건너뛴다.md`
- 수정: `docs/adr/README.md` (색인 표 마지막 줄 뒤)
- 생성: `.changeset/cli-pre-fill-no-dry-run.md`

**인터페이스**
- 소비: T1 의 화면 문안(설계 §3.1 · §3.3). 이 태스크는 코드를 만지지 않는다.
- 산출: 없음.

- [ ] **Step 1: ADR 번호를 확인한다**

Run: `ls docs/adr | grep -E '^[0-9]{4}' | sort | tail -1`
Expected: `0088-...`. 그보다 큰 번호가 이미 있으면 그 값 + 1 을 쓰고, 파일명과 색인과 T1 주석의
`ADR-0089` 를 그 번호로 맞춘 뒤 보고서에 적는다.

- [ ] **Step 2: ADR 을 쓴다**

`docs/adr/0089-시험-실행이-꺼지면-사전보완도-건너뛴다.md`. 형식은 ADR-0088 의 머리말을 따른다.

```markdown
# ADR-0089: 시험 실행이 꺼지면 AI 사전보완도 건너뛴다

- 상태: 제안
- 날짜: 2026-09-09
- 담당: cli
- 작성자: @seodduu
- 참조: ADR-0023(시험 실행 전 서버 초기화 훅), ADR-0025(입력값 교정 권한 경계),
  `docs/superpowers/specs/2026-08-17-schema-constraint-support-design.md` §4.4,
  `docs/superpowers/specs/2026-09-09-pre-fill-no-dry-run-design.md`, 이슈 #397, 이슈 #399

## 배경

`--no-dry-run` 은 승인 전 시험 실행을 끄는 옵션이고, 파서와 저장 화면은 그것을 "서버의 도구를
부르지 않는 경로" 로 다룬다. 그런데 AI 사전보완은 제안 값의 채택을 실제 서버 실행으로 정하므로
(설계서 §4.4), 그 회차가 `--no-dry-run` 을 보지 않으면 시험 실행을 껐는데도 대상 케이스가 baseline
값과 제안 값으로 각각 한 번씩 실행된다. #397 이 이것을 `mutate` 툴 2회 호출로 재현했다. 상태를
바꾸는 서버에서는 사용자가 생략했다고 믿은 실행의 부작용이 남는다.

## 선택지

(a) `--no-dry-run` 이면 사전보완 회차를 통째로 건너뛴다. provider 도 부르지 않고 baseline 값으로
간다. 화면에 건너뜀과 해결 수단을 적는다.

(b) `--no-dry-run` 에서도 provider 를 부르고, 실행 판정 없이 제안 값을 그대로 후보로 채택한다.
파일이 어차피 미검증이니 AI 추측이 자리값보다 낫다는 논리다.

(c) `--no-dry-run` 과 `--provider` 의 조합을 사용 오류로 거절한다.

## 결정

(a).

## 이유

채택 규칙 "둘 다 통과하면 baseline, 판정을 못 믿으면 baseline" 은 결정론적이고 재현 가능한
쪽을 기본값으로 둔 의도적 선택이다. 실행이 없는 경우는 "판정을 못 믿는다" 의 극단이다. 실측
(`server-filesystem` 에서 baseline 6/14, AI 1/14 통과)이 보여주듯 AI 값이 더 나쁜 툴이 실제로
있고, 실행 없이는 어느 쪽인지 알 수 없다. (b) 는 그 실측을 무시한다. (c) 는 provider 가 검토
메뉴의 `revise` 에도 쓰이므로 유효한 조합을 막는다.

## 결과

- `--no-dry-run` 에서 provider 는 검토 메뉴의 `revise` 에만 쓰인다. 사전보완은 돌지 않는다.
- 시험 실행이 켜진 경로에서는 전송 확인 화면이 "제안을 받으면 대상 케이스를 실제 서버에 실행한다"
  를 적는다. 실제 호출을 허락하는 지점이 그 확인임을 사용자가 안다.
- 사전보완의 실행 시점을 저장 시점의 시험 실행으로 옮겨 검토 메뉴 취소까지 호출 0회로 만드는
  재구성은 #399(같은 초기 상태에서 사전보완과 재검증)와 함께 다룬다.
```

- [ ] **Step 3: 색인에 한 줄을 더한다**

`docs/adr/README.md` 표의 0088 줄 뒤:

```markdown
| [0089](./0089-시험-실행이-꺼지면-사전보완도-건너뛴다.md) | 시험 실행이 꺼지면 AI 사전보완도 건너뛴다 | cli | 제안 |
```

- [ ] **Step 4: README 한 문장**

루트 `README.md` 에서 `--baseline-only` 를 설명하는 문장 바로 뒤에 한 문장을 더한다.

```markdown
`--no-dry-run` 은 시험 실행과 함께 AI 사전보완도 끕니다. 서버의 도구를 한 번도 부르지 않습니다.
```

- [ ] **Step 5: changeset**

`.changeset/cli-pre-fill-no-dry-run.md`:

```markdown
---
"@mcpeak/cli": patch
---

`generate --no-dry-run` 에서 AI 사전보완이 실제 도구를 호출하던 문제를 고칩니다(#397). 시험 실행을
끄면 사전보완도 건너뛰어 `callTool` 이 0회가 되고, 시험 실행이 켜진 경로의 전송 확인 화면은
제안을 받은 뒤 대상 케이스를 실제 서버에 실행한다는 사실을 적습니다.
```

- [ ] **Step 6: 확인과 보고**

Run: `pnpm changeset status --since=main` 과 `pnpm biome ci .`
Expected: changeset 이 `@mcpeak/cli` patch 로 잡힌다. biome 통과.
`docs/reports/task-t2-pre-fill-no-dry-run-docs.md` 에 결과를 적는다. 커밋은 사람이 한다.
메시지: `docs(cli): --no-dry-run 이 사전보완도 끈다는 사실을 README·ADR-0089·changeset 에 적는다`.

## 3. 의존성과 웨이브

```
T1 ──▶ T2 ──▶ W3(실환경 검증)
```

| 웨이브 | 태스크 | 병렬 | 선행 |
|---|---|---|---|
| W1 | T1 | 단독 | 없음 |
| W2 | T2 | 단독 | T1 (T1 의 주석이 ADR 번호를 가리키므로 번호 확정 뒤 같은 브랜치에서) |
| W3 | 실환경 검증 | 직렬 전용 | T2 |

파일이 겹치지 않아 병렬이 가능하지만 분량이 작아 터미널 하나, worktree 하나, 브랜치 하나
(`fix/pre-fill-no-dry-run`)로 순차 실행한다. PR 은 하나다.

## 4. 모델 배분

| 태스크 | 모델 | 근거 |
|---|---|---|
| T1 | 표준 | 화면 문안은 설계 §3.1 · §3.3 과 이 계획이 전량 고정했다. 남는 판단이 없다 |
| T2 | 표준 | 문서 전사다 |

## 5. 완료 조건 (통합 게이트)

설계 §2 완료 조건 1~9 는 T1 · T2 의 테스트와 파일로 판정한다. 아래는 오케스트레이터가 통합
직전에 직접 돌린다.

1. `pnpm typecheck --force` 가 `Cached: 0 cached` 로 통과한다.
2. `pnpm test` 전량 통과. 기존 사전보완 테스트의 케이스 이름과 단언이 삭제되지 않았다
   (`git diff main -- packages/cli/tests/pre-fill-command.test.ts` 에 `-` 로 시작하는 `it(` 줄이
   없다).
3. `pnpm biome ci .` 통과.
4. `pnpm build --force` 뒤 `pnpm --filter @mcpeak/cli test:e2e` 통과.
5. `pnpm changeset status --since=main` 에 `@mcpeak/cli` 가 잡힌다.
6. W3 의 관측이 §7 W3 의 기대와 같다.

## 6. 사람이 할 사전 확인 (2줄)

설계 문서와 이 계획서를 루트에서 먼저 커밋한 뒤 확인한다. untracked 문서는 worktree 에 딸려가지
않는다.

```sh
git log --oneline -1     # 기점 커밋 확인. 이 값이 <기점SHA> 다
git status --short       # 깨끗한지 확인
```

## 7. 실행 프롬프트

터미널 하나다. 프로젝트 루트에서 열고 그대로 붙여넣는다. `<기점SHA>` 는 §6 의 값으로 바꾼다.
오케스트레이터 세션이 이 프롬프트를 받아 T1 · T2 를 서브에이전트로 순서대로 스폰하고 사이에
리뷰한다.

### W1 · T1 (권장: 표준 모델, 추론 수준 중간, 구현 에이전트)

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.
  git worktree add .claude/worktrees/mcpeak-397 -b fix/pre-fill-no-dry-run <기점SHA>
를 실행한 뒤 그 경로로 세션을 옮겨라(EnterWorktree 에 path 로 넘긴다). 이어서 pnpm install 을
돌리고, 다른 패키지의 산출물을 읽도록 pnpm build 도 한 번 돌려라.
진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 BLOCKED 로 보고해라:
  - pwd 가 .claude/worktrees/mcpeak-397 로 끝나는지
  - git log --oneline -1 이 <기점SHA> 인지
  - docs/superpowers/plans/2026-09-09-pre-fill-no-dry-run-implementation.md 와
    docs/superpowers/specs/2026-09-09-pre-fill-no-dry-run-design.md 가 존재하는지
  - git status --short 가 비어 있는지
  - pnpm vitest --version 이 실행되는지

[2단계: 실행] 너는 Task T1 의 구현자다.
계획서의 Task T1 을 스텝 순서대로 수행해라. Step 1 의 테스트를 먼저 쓰고 Step 2 에서 실패를
눈으로 확인한 뒤에만 구현으로 넘어가라. 설계 문서 §3.1 · §3.3 · §4 가 문안의 사양이고 한 글자도
바꾸지 마라.
허용 Files 는 다음뿐이다:
  - 수정 packages/cli/src/generate-command.ts
  - 수정 packages/cli/src/help.ts
  - 수정 packages/cli/tests/pre-fill-command.test.ts
  - 수정 packages/cli/tests/help.test.ts
그 밖의 파일은 수정 금지다. 특히 core/src/types.ts, packages/generate, packages/runner, 루트
빌드 설정은 공유 계약이다. 필요해 보이면 수정하지 말고 보고해라. 기존 테스트의 케이스 이름과
단언을 지우지 마라. 단언은 더하기만 한다.
git 명령을 실행하지 마라. 커밋·푸시·머지는 사람이 한다. 백그라운드 실행과 하위 에이전트 스폰도
금지다. 다른 작업자의 변경을 되돌리지 마라.
검증 명령:
  pnpm vitest run --root . packages/cli/tests/pre-fill-command.test.ts packages/cli/tests/help.test.ts packages/cli/tests/pre-fill-screen.test.ts
  pnpm --filter @mcpeak/cli test
  pnpm typecheck --force   (출력에 Cached: 0 cached 가 있어야 한다)
  pnpm biome ci packages/cli
보고서를 docs/reports/task-t1-pre-fill-no-dry-run.md 에 써라. Step 2 에서 본 실패 출력(events 에
callTool 두 건이 찍힌 것)을 그대로 붙여라. 그것이 이슈 재현 증거다.
최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작하고, 변경 파일, 검증 명령과
결과, 보고서 경로, 남은 위험을 포함해라.
```

### W2 · T2 (권장: 표준 모델, 추론 수준 낮음, 구현 에이전트)

T1 을 리뷰해 통과시킨 뒤 같은 worktree 에서 스폰한다. T1 의 변경은 아직 커밋 전이어도 된다.
사람이 T1 을 먼저 커밋했다면 `git status --short` 확인 항목을 "T1 의 파일 외에는 비어 있는지" 로
읽는다.

```
[1단계: 작업 공간 확인] 이미 만들어진 worktree 를 쓴다. 새로 만들지 마라.
  .claude/worktrees/mcpeak-397 로 세션을 옮겨라(EnterWorktree 에 path 로 넘긴다).
진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 BLOCKED 로 보고해라:
  - pwd 가 .claude/worktrees/mcpeak-397 로 끝나는지
  - git log --oneline -1 이 <기점SHA> 이거나 그 위에 T1 커밋 하나가 얹힌 상태인지
  - docs/superpowers/plans/2026-09-09-pre-fill-no-dry-run-implementation.md 와
    docs/superpowers/specs/2026-09-09-pre-fill-no-dry-run-design.md 가 존재하는지
  - git status --short 에 T1 의 네 파일 외의 변경이 없는지
  - packages/cli/src/generate-command.ts 에 "AI 사전보완을 건너뜁니다" 문자열이 있는지
    (T1 이 반영된 상태여야 한다)

[2단계: 실행] 너는 Task T2 의 구현자다.
계획서의 Task T2 를 스텝 순서대로 수행해라. Step 1 에서 ADR 번호를 실제로 확인하고, 0089 가
아니면 파일명·색인·changeset 본문·T1 이 넣은 주석의 ADR 번호를 그 값으로 맞춘 뒤 보고서에
적어라. 그 경우에만 packages/cli/src/generate-command.ts 의 주석 한 줄을 고칠 수 있다.
허용 Files 는 다음뿐이다:
  - 수정 README.md (루트)
  - 생성 docs/adr/0089-시험-실행이-꺼지면-사전보완도-건너뛴다.md (번호는 Step 1 결과)
  - 수정 docs/adr/README.md
  - 생성 .changeset/cli-pre-fill-no-dry-run.md
  - (번호가 바뀐 경우에만) packages/cli/src/generate-command.ts 의 ADR 번호 주석
그 밖의 파일은 수정 금지다. 산문에 대시(—)를 쓰지 마라.
git 명령을 실행하지 마라. 커밋·푸시·머지는 사람이 한다. 백그라운드 실행과 하위 에이전트 스폰도
금지다. 다른 작업자의 변경을 되돌리지 마라.
검증 명령:
  pnpm changeset status --since=main
  pnpm biome ci .
보고서를 docs/reports/task-t2-pre-fill-no-dry-run-docs.md 에 써라.
최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작하고, 변경 파일, 검증 명령과
결과, 보고서 경로, 남은 위험을 포함해라.
```

### W3 · 실환경 검증 (직렬 전용, 오케스트레이터가 직접 수행)

서브에이전트에 넘기지 않는다. 실제 서버 프로세스를 띄우므로 직렬 웨이브다.

1. worktree 에서 `pnpm build --force` 뒤 `pnpm --filter @mcpeak/cli test:e2e`.
2. `codex` CLI 가 설치돼 있으면 사전보완 대상이 있는 공개 서버에 돌린다. `mcp-server-time` 이
   `timezone` 필드가 근거 없음이라 대상이다(실측 기록).
   ```sh
   node packages/cli/dist/index.js generate --out /tmp/mcpeak-397.json \
     --no-dry-run --provider codex -- uvx mcp-server-time
   ```
   기대: 화면에 `▸ 시험 실행이 꺼져 있어(--no-dry-run) AI 사전보완을 건너뜁니다.` 가 나오고
   `AI 사전보완 요청` 화면과 provider 호출이 없다. 검토 메뉴에서 `cancel` 로 나온다.
   같은 명령을 `--no-dry-run` 없이 돌리면 전송 확인 화면에 `채택 판정: 제안을 받으면 대상 케이스
   N개를 ...` 줄이 `이 요청을 전송할까요?` 앞에 나온다. 여기서 `n` 으로 거절한다.
   `codex` 가 없으면 2 는 건너뛰고 그 사실을 보고에 적는다. 유닛테스트가 같은 경로를 주입
   client 로 검증하므로 게이트를 막지는 않는다.
3. 결과를 `docs/adoption.md` 에 한 줄로 누적 기록한다.

## 8. 자체 검토

- 설계 완료 조건 1~10 이 각각 대응한다: 1·2·3·4·5·6·9 → T1 테스트, 7 → T1(help) + T2(README),
  8 → T2, 10 → 통합 게이트 1~4. 설계 §3.4(검토 메뉴 취소 뒤 호출 유지)는 변경이 없으므로 태스크가
  없고, 기존 채택 테스트 무변경(완료 조건 9)이 그것을 지킨다.
- 플레이스홀더 없음. 문안·테스트 케이스 이름·단언은 전량이다.
- T1 이 참조하는 `ADR-0089` 번호를 T2 Step 1 이 확정한다. 번호가 바뀌면 T2 가 T1 의 주석 한 줄을
  맞추도록 허용 Files 에 조건부로 넣었다.
- 병렬 태스크가 없다. 파일 겹침 없음.
- 실환경 검증은 W3 직렬이고 공개 서버는 상태 없는 `mcp-server-time` 만 쓴다.
