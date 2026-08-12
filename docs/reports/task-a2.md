# Task A2 보고서 — Claude `api_error_status` 판정 수정

## 작업 공간

- worktree: `<repo-root>/.claude/worktrees/ohmymcp-generate-provider`
- 브랜치: `fix/generate-api-error-status` (`f277608`에서 분기)
- `git rev-parse HEAD`: `f2776084d3ece056a426c083a75572315d3992f9`
- 기점 커밋: `f277608 merge(generate): Task A1 provider 호출 복구 통합` (지시받은 기점과 일치)
- 분기 직후 `git status --short`는 비어 있었다. 커밋은 하지 않았다.

## 변경 파일

수정:

- `packages/generate/src/providers.ts`
- `packages/generate/tests/providers.test.ts`
- `docs/adr/0007-provider-전송-스키마-분리.md`

신규:

- `.changeset/generate-api-error-status.md`
- `docs/reports/task-a2.md` (이 파일)

허용 목록 밖 변경은 없다.

## 고친 내용

`unwrap`의 Claude envelope 판정에서 `api_error_status`를 키 존재가 아니라 값으로 본다.

```ts
// Claude 2.1.228 성공 응답은 api_error_status를 null로 항상 담는다.
// 키 존재로 판정하면 모든 성공이 거절되므로 값으로 본다.
(value.api_error_status !== null && value.api_error_status !== undefined) ||
```

`null`과 `undefined`(키 없음)는 통과, 그 외 값은 `schemaMismatch`다. 나머지 판정
(`type === "result"`, `subtype === "success"`, `is_error !== true`, `structured_output` 키 존재)은
손대지 않았다.

## 테스트

신규 두 개를 먼저 쓰고 돌렸다.

```
$ pnpm vitest run packages/generate      # 수정 전
 Test Files  1 failed | 5 passed (6)
      Tests  1 failed | 74 passed (75)

 FAIL  Claude 성공 응답의 api_error_status가 null이면 정상 처리한다
 AssertionError: promise rejected "Error: provider 요청을 완료하지 못했습니다. { …(3) }" instead of resolving
 Serialized Error: { code: 'schemaMismatch', exitCode: undefined, stderr: undefined }
```

`"Claude 성공 응답에 api_error_status 키가 아예 없어도 정상 처리한다"`는 수정 전에도 통과했다.
키가 없는 경우는 기존 `"api_error_status" in value` 판정도 통과시키기 때문이다. 회귀 방지용으로
남긴다.

기존 `"Claude가 api_error_status를 담으면 candidate로 적용하지 않는다"`(값 `529`)는 수정 후에도
그대로 통과한다.

## 검증 명령과 결과

```
$ pnpm vitest run packages/generate
 Test Files  6 passed (6)
      Tests  75 passed (75)
   Duration  176ms

$ pnpm build
 Tasks:    6 successful, 6 total
Cached:    4 cached, 6 total
  Time:    1.52s

$ pnpm typecheck
 Tasks:    6 successful, 6 total
Cached:    5 cached, 6 total
  Time:    890ms

$ pnpm lint
> biome check .
Checked 97 files in 46ms. No fixes applied.

$ pnpm test
 Test Files  27 passed (27)
      Tests  241 passed (241)
   Duration  1.26s
```

거짓 신호 점검: `tsc --noEmit`은 성공 시 파일 수를 찍지 않으므로 `packages/generate`에서
`npx tsc --noEmit --listFiles`로 이 worktree의 `src` 파일 **10개**가 실제 검사됐음을 확인했다.
lint는 `Checked 97 files` 출력으로 확인했다.

## 내가 임의로 판단한 부분

1. **`undefined`도 통과시킨다.** 지시가 "null 또는 undefined이면 정상"이라 그대로 따랐다. 결과적으로
   키가 없는 경우와 값이 `undefined`인 경우가 같은 취급이다. JSON 파싱 결과에는 `undefined`가
   나올 수 없으므로 실질적으로는 키 없음만 해당한다.
2. **`0`과 빈 문자열은 거절 쪽이다.** 명시적 비교(`!== null && !== undefined`)를 써서 falsy 값을
   통과시키지 않는다. HTTP 상태 `0`이 의미 있는 상황은 없다고 봤다.
3. **changeset bump는 `patch`.** 동작 수정이고 공개 API 변화가 없다.

## 남은 위험

1. **다른 Claude 버전의 envelope는 확인하지 않았다.** 실측은 2.1.228 한 버전이다. 다른 버전이
   `api_error_status`를 `""` 등으로 담으면 다시 전부 거절된다. 지금 판정은 그 경우를 오류로 본다.
2. **여전히 유닛테스트로는 최종 판정이 안 된다.** 실제 Claude 호출로 `2 passed, 0 failed`가 나오는
   것이 유일한 진실 기준이다. C1을 다시 돌려야 한다.
3. **Codex 경로는 이번 변경과 무관하다.** Codex는 envelope 판정을 타지 않는다.
