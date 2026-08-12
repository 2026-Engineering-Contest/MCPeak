# Task R4 보고서 — PR #37 리뷰 스레드 해소 (cli · docs)

## 작업 공간

- worktree: `<repo-root>/.claude/worktrees/ohmymcp-review2-cli`
- 브랜치: `fix/review2-cli`
- 기점 커밋: `33499b8 docs(generate): M1 통합 대장 기록`
- 진입 시 `git status --short` 비어 있음. `pnpm install` 후 `pnpm vitest run packages/cli`
  (93 passed) 실행 확인

## 변경 파일

| 파일 | 항목 |
|---|---|
| `packages/cli/src/generate-command.ts` | 1 |
| `packages/cli/tests/generate-command.test.ts` | 1 |
| `docs/reports/task-r1.md` | 3(a) |
| `docs/superpowers/plans/2026-08-12-ai-assisted-test-authoring-implementation.md` | 3(b) |
| `.changeset/cli-atomic-no-clobber-save.md` | 신규 |
| `docs/reports/task-r4.md` | 이 보고서 |

`packages/generate`는 열지 않았다. 2번은 지시대로 손대지 않았다.

## 1. 출력 저장을 원자적 no-clobber로 🟠

### 전제 실측

이 수정은 "`link`는 대상이 있으면 실패하고, `rename`은 덮어쓴다"는 전제 위에 있다. 유닛테스트는
전부 stub이므로 실제 파일시스템에서 먼저 확인했다.

```
link: code=EEXIST, 대상 내용=PRECIOUS
rename: 대상 내용=NEW
link(신규): 대상=NEW, 원본 남음=NEW
```

- `link`는 `EEXIST`로 실패하고 **기존 파일 내용이 그대로 남는다**
- `rename`은 말없이 덮어쓴다. 리뷰가 지적한 데이터 손실이 실재한다
- `link`는 성공해도 원본(임시 파일)이 남는다. 그래서 커밋 뒤에도 `unlink`가 필요하다

### 고른 방향

권고대로 **(b) link + unlink**를 골랐다. 지금 구조(임시에 쓰고 fsync, 다시 읽어 fingerprint 검증,
그 뒤 커밋)를 그대로 두고 커밋 단계만 바꾸면 되기 때문이다. (a)는 최종 경로에 직접 쓰므로
"쓴 내용을 다시 읽어 검증한 뒤에 커밋한다"는 현재 안전장치를 잃는다. 중간에 죽으면 반쪽 파일이
최종 경로에 남는 것도 (a)의 단점이다.

### 구현

`GenerateCommandDependencies`에서 `rename`을 **제거하고** `link`를 넣었다. 추가가 아니라 교체다.
덮어쓸 수 있는 primitive를 의존성에 남겨 두면 같은 결함이 다시 들어올 자리가 된다. `rename`은
cli 안에서 이 한 곳에서만 쓰였고, `index.ts`는 `nodeGenerateDependencies()`를 스프레드하므로
호출부 변경이 필요 없었다(`index.ts`는 수정 허용 목록에 없었고 실제로 건드리지 않았다).

```ts
try {
  await deps.link(temporary, input.outPath);
} catch (error) {
  if ((error as { code?: unknown } | null)?.code === "EEXIST")
    throw new OutputExistsError(input.outPath);
  throw error;
}
```

`EEXIST`만 `OutputExistsError`로 매핑한다. 메시지는 기존 `GENERATE_OUTPUT_EXISTS`를 그대로 쓴다.
대화형·비대화형 두 경로가 같은 `saveSuite`를 지나므로 양쪽 모두 이 안내를 받는다.

**임시 파일 이름을 실행마다 고유하게** 바꿨다.

```ts
`.${basename(outPath)}.ohmymcp.${process.pid}.${temporarySequence}.tmp`
```

고정 이름이면 같은 디렉터리에서 두 실행이 겹칠 때 `openTemp`의 `wx`가 `EEXIST`로 실패하는데,
그것은 출력 경로 충돌과 전혀 다른 실패다. 이 이름은 저장되는 suite 내용에 들어가지 않으므로
결정론성 요구와 무관하다(주석에 남겼다).

임시 파일 정리는 유지했다. `link`가 원본을 남기므로 **성공했을 때도** 임시를 지운다. 실패 경로와
같은 `finally`가 처리한다.

`deps.exists` 선검사는 **남겼다.** 사용자에게 더 빨리 알려줄 수 있기 때문이다. 다만 그것이
보장이 아니라는 주석을 달았다. 보장은 커밋 단계의 `link`에 있다.

### 테스트

핵심은 경쟁 조건 재현이다.

- `선검사 뒤 커밋 직전에 파일이 생겨도 덮어쓰지 않는다` — `exists()`는 없다고 답하지만
  `link`가 `EEXIST`를 던지도록 stub. 종료 코드 1, `GENERATE_OUTPUT_EXISTS`와 경로가 나오고,
  임시 파일은 `unlink`로 치워진다
- `커밋 실패가 EEXIST가 아니면 출력 충돌로 오인하지 않는다` — `EXDEV`는 `GENERATE_FAILED`로
  떨어지고 원본 오류 문자열(`EXDEV`)이 새지 않는다
- `임시 파일 이름은 실행마다 다르다` — 두 번 실행해 `open:` 경로가 다른지 확인
- 기존 이벤트 단언 둘은 `rename` → `link` + `unlink`로 갱신했다. 임시 이름이 고유해져
  경로를 그대로 비교할 수 없으므로 `normalizedEvents()` 헬퍼로 `open:` 경로를 정규화했다.
  대신 임시가 출력과 **같은 디렉터리**에 있는지는 별도로 단언한다(다른 파일시스템이면 `link`가
  `EXDEV`로 실패하므로 이 성질이 중요하다)

## 2. fingerprint 중복 구현 제거 — 선행 대기

**손대지 않았다.** 지시대로다. `packages/generate`의 `index.ts`에서 `sha256`을 export하는 작업
(ohmymcp-9d)이 통합되기 전에는 import할 수 없다.

현재 상태만 적어 둔다. `packages/cli/src/generate-command.ts`의 `canonicalJson`과
`suiteFingerprint`가 그대로 남아 있고 `node:crypto`의 `createHash`를 쓴다. generate 쪽 구현과
갈라지면 fingerprint가 어긋나 승인 검증이 조용히 깨진다. 후속 태스크 대상이다.

## 3. 문서

### (a) 개인 경로

`docs/reports/task-r1.md:5`를 R2와 같은 규칙으로 고쳤다.

```diff
-- pwd: `/Users/<사용자>/.../\.claude/worktrees/ohmymcp-review-generate`
+- worktree: `<repo-root>/.claude/worktrees/ohmymcp-review-generate`
```

`docs/reports/task-r2.md`에는 개인 경로가 없었다(R2에서 이미 이 형식으로 썼다).

**남은 1건이 있고 내 허용 목록 밖이다.**

```
docs/reports/task-m1.md:5:- pwd: `/Users/<사용자>/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-merge-pr38`
```

`task-m1.md`는 수정 허용 파일에 없어 건드리지 않았다. 따라서 **`grep -rn "doo\._\.hyun" docs/`는
아직 0건이 아니라 1건이다.** 고칠 내용은 위와 똑같은 한 줄이다.

```
- worktree: `<repo-root>/.claude/worktrees/ohmymcp-merge-pr38`
```

"보고서에 절대 경로를 쓰지 않는다"를 어디에 남길지는 내 판단에 맡겨졌는데, **남기지 못했다.**
눈에 띄면서 앞으로 만드는 보고서에 실제로 적용될 자리는 `CONTRIBUTING.md`나
`docs/reports/README.md`인데 둘 다 허용 목록에 없다. 보고서 안에 적어 봐야 다음 보고서를 쓰는
사람이 보지 않는다. 규칙이 실제로 서려면 그 두 곳 중 하나에 한 줄이 필요하다. 후속으로 요청한다.

### (b) 명령 안의 자리표시자

R2에서 내가 넣은 `<repo-root>`가 실행 프롬프트의 `git worktree add` 명령 안에 그대로 들어가
붙여넣기로 동작하지 않게 됐다. 리뷰 지적이 맞다. R2에서 계획서에 적용한 방식과 같게 고쳤다.

```diff
+아래 명령은 모두 이 저장소의 루트에서 실행한다. 경로도 그 기준의 상대 경로다.
+
 ...
 git worktree add -b feat/generate-ai-authoring
-<repo-root>/../OhMyMCP-worktrees/generate-ai-authoring
+../OhMyMCP-worktrees/generate-ai-authoring
 "$ai_generate_base_commit"을 실행해 그 경로로 이동한다.
```

두 프롬프트(Terminal 1, 2) 모두 같은 방식이다. 존재 확인 문장의 경로도 같이 바꿨다.

문서 전체를 훑어 다른 자리표시자도 확인했다. 71~72행 worktree 표에도 `<repo-root>`가 있었다.
명령은 아니지만 같은 문서 안에서 표기가 갈리면 헷갈리므로 상대 경로로 통일하고
"Worktree 경로는 저장소 루트 기준 상대 경로다"를 표 앞에 적었다.

검증:

```
grep -rn "<repo-root>" docs/superpowers/ docs/plans/   → 0건
```

`docs/reports/*.md`의 `<repo-root>`는 남아 있다. 그쪽은 실행 명령이 아니라 "어디서 작업했는지"를
가리키는 서술이므로 자리표시자가 맞다.

## 검증

```
pnpm vitest run packages/cli → Test Files 5 passed (5) / Tests 96 passed (96)
pnpm build     → Tasks: 6 successful, 6 total
pnpm typecheck → Tasks: 6 successful, 6 total
pnpm lint      → Checked 101 files in 34ms. No fixes applied.
pnpm test      → Test Files 27 passed (27) / Tests 318 passed (318)
```

CI 조건(build 없이):

```
rm -rf packages/*/dist && pnpm test → Test Files 27 passed (27) / Tests 318 passed (318)
```

검사 대상 0개 거짓 신호 점검:

- 린트 `Checked 101 files` (0 아님)
- 타입체크는 성공 시 무출력이라 별도로
  `cd packages/cli && npx tsc --noEmit --listFiles | grep -c "worktrees/ohmymcp-review2-cli/packages/cli/"`
  → **9**
- `grep -rn "doo\._\.hyun" docs/` → **1건** (위 3(a), 허용 목록 밖)
- `grep -rn "<repo-root>" docs/superpowers/ docs/plans/` → **0건**

`packages/core`의 stdio-integration 간헐 실패는 이번 실행들에서 나오지 않았다. 다른 실패도 없었다.

## 임의로 판단한 부분

1. **`rename`을 deps에서 제거하고 `link`로 교체했다.** 추가가 아니라 교체다. 덮어쓸 수 있는
   primitive를 남기면 같은 결함이 다시 들어올 자리가 된다. `index.ts`는 건드리지 않았다.
2. **선검사(`deps.exists`)를 남겼다.** 빠른 안내를 위해서다. 보장이 아니라는 주석을 달았다.
3. **임시 이름에 `process.pid`와 프로세스 내 시퀀스를 썼다.** 타임스탬프나 난수를 쓰지 않은 것은
   이 프로젝트가 결정론성을 중시하기 때문이다. 이름이 결과물에 들어가지 않으므로 둘 다 무해하지만
   습관을 남기지 않는 쪽을 골랐다.
4. **`normalizedEvents()` 헬퍼를 테스트에 추가했다.** 임시 이름이 고유해져 이벤트 배열을 그대로
   비교할 수 없다. 경로를 무시하되, 임시가 출력과 같은 디렉터리인지는 별도 단언으로 지켰다.
5. **전제를 실제 파일시스템으로 먼저 확인했다.** 유닛테스트가 전부 stub이라 `link`/`rename`
   동작을 stub이 흉내 내는 대로 믿게 된다. 그건 이 프로젝트 거짓 신호 표의 "유닛테스트 녹색,
   실행 시 실패"에 해당한다.
6. **changeset을 만들었다.** 사용자 데이터 손실을 막는 동작 변화다.

## 남은 위험 / 후속 필요

- **`docs/reports/task-m1.md`의 개인 경로 1건.** 허용 목록 밖이라 남겼다. 위 3(a)에 정확한
  치환 문장을 적어 뒀다. 이게 남아 있으면 리뷰 스레드가 닫히지 않는다.
- **"보고서에 절대 경로를 쓰지 않는다" 규칙을 남길 자리가 없었다.** `CONTRIBUTING.md`나
  `docs/reports/README.md`가 허용 목록에 들어와야 한다. 지금은 매번 리뷰에서 잡히는 상태다.
- **2번(fingerprint 중복)은 선행 대기.** 9d의 `sha256` export가 통합된 뒤 후속 태스크가 필요하다.
- `link`는 **같은 파일시스템 안에서만** 동작한다. 임시 파일을 출력과 같은 디렉터리에 만들므로
  정상 경로에서는 문제가 없고, 그 성질을 테스트로 고정했다. 다만 출력 디렉터리가 `link`를
  지원하지 않는 파일시스템(일부 네트워크 마운트, FAT 계열)이면 `EPERM`/`ENOTSUP`으로 실패한다.
  그 경우 지금은 `GENERATE_FAILED`로 떨어진다. 실제로 겪는 사용자가 나오면 전용 안내가 필요하다.
