# Task R5 보고서 — cli의 fingerprint 중복 구현 제거

## 작업 공간

- worktree: `<repo-root>/.claude/worktrees/ohmymcp-review3-cli`
- 브랜치: `fix/review3-cli`
- 기점 커밋: `e6873b2 docs: R3·R4 통합 대장 기록`
- 진입 시 `git status --short` 비어 있음. `pnpm install` 후 `pnpm vitest run packages/cli`
  (96 passed) 실행 확인

## 변경 파일

| 파일 | 내용 |
|---|---|
| `packages/cli/src/generate-command.ts` | 지역 `canonicalJson`·`suiteFingerprint` 제거, generate의 `sha256` 사용 |
| `packages/cli/tests/generate-command.test.ts` | fingerprint 고정 테스트 3개 추가 |
| `docs/reports/task-r5.md` | 이 보고서 |

changeset은 만들지 않았다. 근거는 아래 "changeset을 만들지 않은 이유"에 적는다.
`packages/generate`는 읽기만 했다.

## 1. 교체 전 동등성 실측 (지시받은 선행 확인)

두 구현이 같은 값을 내는지 먼저 확인했다. 다르면 승인 검증을 조용히 깨뜨리므로 BLOCKED였다.

방법: `packages/cli/src/generate-command.ts`의 지역 구현을 **그대로 복사**한 스크립트와 빌드된
`@ohmymcp/generate`의 `sha256`·`canonicalJson`을 같은 입력에 돌려 대조했다.

```
empty cases: canonicalJson 동일=true, sha256 동일=true
  cli=dd42ff3ee4b40db6ea0416a3c9794da2d8e599f661a3ee0d3c39179dd266152c
  gen=dd42ff3ee4b40db6ea0416a3c9794da2d8e599f661a3ee0d3c39179dd266152c
real suite: canonicalJson 동일=true, sha256 동일=true
  cli=1d876fb4196389fcb3df93932d495391bfb074a1a2ac1b14b59dc8b9b60999c3
  gen=1d876fb4196389fcb3df93932d495391bfb074a1a2ac1b14b59dc8b9b60999c3
permuted keys: canonicalJson 동일=true, sha256 동일=true
  cli=1d876fb4196389fcb3df93932d495391bfb074a1a2ac1b14b59dc8b9b60999c3
  gen=1d876fb4196389fcb3df93932d495391bfb074a1a2ac1b14b59dc8b9b60999c3
unicode/escape: canonicalJson 동일=true, sha256 동일=true
  cli=23d01bdd74b286fa0aecb3da219f3b0914d8ab3b4467de07758d01702d3e3817
  gen=23d01bdd74b286fa0aecb3da219f3b0914d8ab3b4467de07758d01702d3e3817
permuted == real (generate): true
테스트에 박힌 기대값과 generate.sha256 일치: true

전체 일치: true
```

입력 네 종류를 썼다. 빈 `cases`, 중첩 객체와 배열이 있는 실제 suite, 그 suite의 **키 순서만
바꾼** 동등물, 그리고 따옴표·백슬래시·이모지·개행이 든 이름. 마지막 줄은 기존 테스트에 하드코딩된
canonical 문자열
(`{"cases":[],"defaultTimeoutMs":10000,"id":"weather","name":"Weather","schemaVersion":1}`)의
해시와도 대조한 것이다.

코드를 읽어 확인한 내용도 적어 둔다. 두 구현 모두 `Object.keys().sort()` 후
`JSON.stringify(key):값` 형태로 직렬화하고 배열은 순서를 보존하며 sha256 hex를 낸다. 차이는
**거부하는 입력**에만 있다. generate 쪽이 더 엄격해서 `undefined`, 순환 참조, sparse array,
non-plain 객체(예: `Date`)를 명시적으로 던진다. cli 지역 구현은 `Date`를 `{}`로 직렬화했다.
검증을 통과한 `TestSuiteSpec`에는 그런 값이 올 수 없으므로 정상 경로의 출력은 동일하고,
비정상 입력에서는 generate 쪽이 조용히 잘못된 값을 내는 대신 던진다. 더 안전한 방향이다.

## 2. 교체

```ts
let sha256Impl: ((value: unknown) => string) | undefined;
async function suiteFingerprint(suite: TestSuiteSpec): Promise<string> {
  sha256Impl ??= (await import("@ohmymcp/generate")).sha256;
  return sha256Impl(suite);
}
```

지역 `canonicalJson`(16줄)과 `suiteFingerprint`를 지우고 `node:crypto`의 `createHash` import도
제거했다. cli에 남은 `createHash` 참조는 0건이다.

### 왜 정적 import가 아니라 동적 import인가

여기서 판단이 갈렸다. 처음에는 `import { sha256 } from "@ohmymcp/generate"`를 쓰려 했으나
**모듈 로드 동작을 바꾼다**는 것을 확인하고 물렀다.

`packages/cli/src/index.ts`는 `@ohmymcp/core`·`runner`·`generate`를 **동적으로** 불러오고,
실패하면 `unavailableDependencies`로 떨어져 안내 메시지를 낸다. 그런데 `index.ts`는
`generate-command.ts`를 **정적으로** import한다. 따라서 `generate-command.ts`가 generate를
정적으로 묶으면 모듈 로드 시점에 터져 그 fallback 경로가 죽고, generate와 무관한
`ohmymcp test`까지 함께 죽는다.

빌드 산출물로도 확인했다. 교체 전후 모두 청크의 top-level import는 node 내장 모듈 셋뿐이다.

```
import { access, link, open, readFile, unlink } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { createInterface } from "node:readline/promises";
```

`import("@ohmymcp/generate")`는 동적 형태로 2건 남아 있다(index.ts의 기존 1건 + 이번 1건).
정적 import를 썼다면 여기에 `@ohmymcp/generate` 줄이 하나 더 생겼을 것이다.

호출부는 `saveSuite` 한 곳뿐이라 `await`만 붙이면 됐다. Node가 모듈을 캐시하고 `sha256Impl`에도
담아 두므로 반복 비용은 없다.

### 더 나은 안이 있지만 범위 밖이다

이 코드베이스는 이미 같은 문제를 **의존성 주입**으로 푼다. `validateSuite: runner.validateMcpSuite`가
바로 그것이다. runner도 동적 로드 대상이라 값을 `index.ts`가 주입한다. fingerprint도
`GenerateCommandDependencies`에 `suiteFingerprint`를 추가하고 `index.ts`가 `generate.sha256`을
넣어 주는 편이 기존 패턴과 일관되고 테스트에서 갈아 끼우기도 쉽다.

그러려면 `packages/cli/src/index.ts`를 고쳐야 하는데 이번 수정 허용 목록에 없다. 동적 import는
그 제약 안에서 같은 결과를 내는 방법이다. `index.ts`를 허용 목록에 넣어 주면 주입 방식으로
바꾸는 편이 낫다고 본다. 판단은 넘긴다.

## 3. 추가한 테스트

- `baseline 저장 경로의 fingerprint가 교체 전후로 동일하다`
  기대값 `dd42ff3e…`를 **문자열로 박았다.** 옛 지역 구현이 내던 값이다. 기존 테스트의
  `createHash` 계산값과도, `sha256(suite)`와도 같은지 확인하고, 실제 baseline 저장이 통과하는지
  (`link` 1회 호출) 확인한다. 계산식을 비교하면 두 계산식이 같이 틀려도 통과하므로 상수를 박았다.
- `저장된 suite의 fingerprint가 다르면 커밋하지 않는다`
  `finalizeAuthoringDraft`가 다른 fingerprint를 내면 `saveSuite`의 재검증이 막아 `link`가
  불리지 않고 종료 코드 1이다. 대조 로직이 살아 있음을 고정한다.
- `키 순서가 다른 동등한 suite는 같은 fingerprint를 낸다`
  키 순서만 바꾼 suite가 같은 값을 낸다.

대화형 승인 경로의 fingerprint 대조는 기존 테스트가 이미 덮고 있다
(`최종 fingerprint 승인 뒤에만 JSON을 저장한다`, `candidate diff를 전체 적용해 revision을 증가시킨다`
등). 모두 손대지 않았고 그대로 통과한다.

## 검증

```
pnpm vitest run packages/cli → Test Files 5 passed (5) / Tests 99 passed (99)
pnpm build     → Tasks: 6 successful, 6 total
pnpm typecheck → Tasks: 6 successful, 6 total
pnpm lint      → Checked 102 files in 40ms. No fixes applied.
pnpm test      → Test Files 28 passed (28) / Tests 330 passed (330)
pnpm --filter ohmymcp test:e2e → exit 0
```

CI 조건(build 없이):

```
rm -rf packages/*/dist && pnpm test → Test Files 28 passed (28) / Tests 330 passed (330)
```

검사 대상 0개 거짓 신호 점검:

- 린트 `Checked 102 files` (0 아님)
- 타입체크는 성공 시 무출력이라 별도로
  `cd packages/cli && npx tsc --noEmit --listFiles | grep -c "worktrees/ohmymcp-review3-cli/packages/cli/"`
  → **9**

`dist-cli-e2e.mjs`는 vitest 수집 대상이 아니라 따로 돌렸다. 배포본 경로에서 동적 import가
실제로 동작하는지 확인하려는 것이다.

`packages/core`의 stdio-integration 간헐 실패는 이번 실행들에서 나오지 않았다. 다른 실패도 없었다.

## changeset을 만들지 않은 이유

사용자에게 보이는 변화가 없다. fingerprint 값이 동일함을 위 1절에서 실측으로 확인했고 테스트로
고정했다. 출력 문구, 종료 코드, 파일 형식 어느 것도 바뀌지 않는다. 내부 중복 제거다.

## 임의로 판단한 부분

1. **동적 import를 썼다.** 정적 import가 `index.ts`의 fallback 경로를 죽인다는 것을 빌드 산출물로
   확인한 뒤 고른 것이다. 근거는 2절.
2. **의존성 주입 방식을 쓰지 않았다.** `index.ts`가 허용 목록 밖이라서다. 그쪽이 더 낫다고 보고
   위에 적어 뒀다.
3. **기대 fingerprint를 상수 문자열로 박았다.** 계산식끼리 비교하면 둘이 같이 틀려도 통과한다.
4. **`suiteFingerprint`를 async로 바꿨다.** 호출부가 한 곳이고 이미 async 함수 안이라 파급이 없다.
5. **changeset 미생성** (위 근거).

## 남은 위험

- generate가 로드되지 않는 상황에서 baseline 저장에 도달하면 `import("@ohmymcp/generate")`가
  던지고 `GENERATE_FAILED`로 떨어진다. 다만 그 경로에서는 `createBaselineSuite` 자체가
  `unavailableDependencies`라 그 전에 이미 실패하므로 실제로 도달하지 않는다. 코드를 읽어
  확인한 것이고 실행으로 재현하지는 않았다.
- 두 패키지가 같은 알고리즘을 쓴다는 사실은 이제 cli 쪽에서 강제된다. 반대로 generate가
  `sha256` 구현을 바꾸면 cli의 fingerprint도 함께 바뀐다. 그것이 의도한 바지만, generate 쪽에
  "이 함수는 cli의 승인 검증이 의존한다"는 표시는 없다. generate 오너가 알아야 할 사실이다.
