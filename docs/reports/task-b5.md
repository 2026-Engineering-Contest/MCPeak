# Task B5 보고서 — provider 실패 원인 분류

## 작업 공간

- worktree: `<repo-root>/.claude/worktrees/ohmymcp-generate-failure-reason`
- 브랜치: `fix/generate-failure-reason` (`9efbeac`에서 분기)
- `git rev-parse HEAD`: `9efbeac47d33f9b347c1f9e373948bdc9cd24b95`
- 진입 직후 `git status --short` 비어 있었고 `pnpm install`이 정상 실행됐다. 커밋은 하지 않았다.

## 변경 파일

수정:

- `packages/generate/src/provider-process.ts`
- `packages/generate/src/providers.ts`
- `packages/generate/src/authoring-request.ts`
- `packages/generate/src/index.ts`
- `packages/generate/tests/provider-process.test.ts`
- `packages/generate/tests/providers.test.ts`
- `packages/generate/tests/authoring-request.test.ts`

신규:

- `.changeset/generate-failure-reason.md`
- `docs/reports/task-b5.md` (이 파일)

허용 목록 밖 변경은 없다. `packages/cli`는 건드리지 않았다.

## 1. 신호 → enum 매핑표

분류에 쓰는 입력은 **숫자 상태 코드 하나뿐**이다. 문자열 메시지는 읽지도, 내보내지도 않는다.

| provider | 읽는 곳 | 읽는 값 | 조건 | enum |
|---|---|---|---|---|
| codex | stderr, 줄 시작이 정확히 `ERROR: {`인 줄의 JSON | `status` (정수) | 401, 403 | `notAuthenticated` |
| codex | 〃 | 〃 | 404 | `unknownModel` |
| codex | 〃 | 〃 | 429 | `rateLimited` |
| codex | 〃 | 〃 | 400 | `badRequest` |
| codex | 〃 | 〃 | 500–599 | `serverError` |
| codex | 〃 | 〃 | 그 외 / 정수 아님 / 매칭 줄 없음 / JSON 파싱 실패 | `undefined` |
| claude | stdout envelope JSON | `api_error_status` (정수) | 위와 같은 코드 표 | 같음 |
| claude | 〃 | 〃 | `null` / 정수 아님 / JSON 파싱 실패 | `undefined` |

codex는 여러 `ERROR: {` 줄이 있으면 **정수 `status`를 가진 첫 줄**을 쓴다. 같은 입력에 항상 같은
결과가 나온다. 타임스탬프·순서·랜덤에 의존하지 않는다.

claude 판정에서 `subtype`은 쓰지 않는다. 실패 응답도 `subtype: "success"`로 오기 때문이다.
`api_error_status`가 `null`인 정상 성공 응답은 분류 대상이 아니다.

**400을 `unknownModel`로 매핑하지 않았다.** codex는 없는 모델에도, 잘못된 output schema에도 400을
준다. 구분할 근거가 없으므로 `badRequest`로만 남긴다. 안내 문구에서 "모델 이름과 스키마를 확인하라"로
푸는 것은 CLI 몫이다.

## 2. 검증된 매핑과 추정한 매핑

**실측으로 확인된 것은 두 개뿐이다.**

| 매핑 | 근거 |
|---|---|
| codex `status: 400` → `badRequest` | 실측. 없는 모델로 호출한 stderr 원문을 픽스처로 그대로 썼다. |
| claude `api_error_status: 404` → `unknownModel` | 실측. 없는 모델 호출 envelope를 픽스처로 그대로 썼다. |

**나머지는 전부 추정이다.** HTTP 상태 코드의 통상적 의미에서 유도했을 뿐, 두 CLI가 실제로 그 코드를
그 상황에 준다는 것을 확인하지 않았다.

| 매핑 | 상태 |
|---|---|
| 401, 403 → `notAuthenticated` | 추정. 미인증 상태의 실제 응답을 보지 않았다. |
| 429 → `rateLimited` | 추정. 쿼터 초과 실제 응답을 보지 않았다. |
| 500–599 → `serverError` | 추정. 실제 서버 오류 응답을 보지 않았다. |

추정 매핑이 틀리면 안내 문구가 엉뚱해진다. 분류 자체가 없는 지금보다 나쁘지는 않지만, 사용자를
헛수고시킬 수 있다는 점에서 원래 결함과 같은 종류의 실패다. 실제 응답을 확보하면 확인해야 한다.

## 3. 줄 앵커 우회 가능성과 최악 결과

codex stderr에는 **우리가 보낸 프롬프트가 그대로 echo된다.** 그 프롬프트에는 MCP 서버가 준 툴 설명이
들어 있고, 툴 설명은 untrusted 데이터다.

정규식에 줄 시작 앵커(`/^ERROR: (\{.*)$/`)를 걸어 echo 본문 중간에 섞인 문자열은 걸러낸다. 하지만
악의적인 MCP 서버가 툴 설명 안에 개행과 함께 `ERROR: {"status":429}`를 심으면 그 줄은 앵커를
만족한다. 줄 앵커로 완전히 막지 못한다.

**최악의 결과는 CLI 안내 문구가 틀리는 것이다.** 이유는 다음과 같다.

- 반환값은 닫힌 enum 5개 중 하나이거나 `undefined`다. 공격자가 제어할 수 있는 것은 그중 어느
  값이 나오는지뿐이다.
- raw stdout/stderr는 `classifyFailure` 밖으로 나가지 않는다. `AuthoringProviderError`,
  `ProviderProcessResult`, `PublicProviderFailure` 어디에도 스트림 문자열이 담기지 않는다.
  기존 `stderr: { captured, truncated }` 모양은 그대로다.
- 이 경로는 **실패 경로에만** 있다. 성공 여부를 뒤집지 못한다. `reason`은 이미 확정된
  `nonZeroExit`에 붙는 부가 정보다.

즉 데이터 유출도, 거짓 성공도 생기지 않는다. 이 한계는 `providers.ts`의
`classifyCodexFailure` 주석에도 그대로 적어 뒀다.

claude 쪽은 stdout envelope만 보므로 프롬프트 echo 문제가 없다.

## 4. 보관 상한

`provider-process.ts`는 원래 stderr 바이트 수만 세고 내용을 버렸다. 분류를 위해 **마지막 8192자**만
링버퍼로 유지한다. `classifyFailure`가 없으면 아예 보관하지 않는다(`spec.classifyFailure !== undefined`
가드). 상한 근거는 상수 주석에 적었다.

테스트 `"stderr는 마지막 8KB만 분류에 넘긴다"`가 20,000바이트를 흘려보내고 분류기가 받은 문자열
길이가 8192 이하이며 꼬리 마커로 끝남을 단언한다.

`"classifyFailure가 없으면 stderr 내용을 보관하지 않는다"`는 내부 버퍼를 직접 볼 수 없으므로
**관찰 가능한 단언으로 바꿔 썼다.** classify 훅 없이 비정상 종료했을 때 결과에 `reason` 키가
존재하지 않음(`"reason" in result === false`)을 단언한다. 버퍼를 채우지 않는다는 사실 자체는
구현 가드로 보장하고, 테스트는 그 가드가 켜졌을 때의 관찰 가능한 결과를 고정한다.

## 5. 검증 명령과 결과

구현 전(테스트 먼저):

```
$ pnpm vitest run packages/generate
 Test Files  3 failed | 3 passed (6)
      Tests  14 failed | 82 passed (96)
```

구현 후:

```
$ pnpm vitest run packages/generate
 Test Files  6 passed (6)
      Tests  96 passed (96)

$ pnpm build
 Tasks:    6 successful, 6 total

$ pnpm typecheck
 Tasks:    6 successful, 6 total

$ pnpm lint
> biome check .
Checked 97 files in 24ms. No fixes applied.

$ pnpm test
 Test Files  27 passed (27)
      Tests  274 passed (274)
```

거짓 신호 점검:

- **타입체크 대상 0개**: `tsc --noEmit`은 성공 시 파일 수를 찍지 않으므로 `packages/generate`에서
  `npx tsc --noEmit --listFiles`로 이 worktree의 `src` 파일 **10개**가 실제 검사됐음을 확인했다.
- **린트 대상 0개**: biome이 `Checked 97 files`를 출력한다.
- **새 worktree 의존성 미설치**: 진입 직후 `pnpm install` 실행(`Done in 695ms`).
- `packages/core`의 stdio-integration 간헐 실패는 이번 실행에서 나오지 않았다. 다른 실패도 없다.

## 6. 내가 임의로 판단한 부분

1. **분류는 `nonZeroExit` 경로에서만 부른다.** `timedOut`, `cancelled`, `outputLimitExceeded` 등은
   프로세스를 우리가 죽인 경우라 API 상태 코드가 나올 자리가 아니다. "비정상 종료 시"를 이렇게
   좁게 해석했다. 넓혀야 하면 호출 지점 한 곳만 옮기면 된다.
2. **상한을 바이트가 아니라 문자 수(8192자)로 잡았다.** 링버퍼를 문자열 `slice`로 유지하기 때문이다.
   멀티바이트가 섞이면 8192자가 8KB를 넘을 수 있다. 상태 코드 줄은 ASCII이고 상한의 목적은 무한
   보관 방지이므로 실질 차이가 없다고 봤다. 정확히 8KB로 잡아야 하면 바이트 계산으로 바꾸면 된다.
3. **비정상 종료 시 stdout decoder를 flush한다.** claude는 실패해도 stdout에 JSON을 주므로 분류
   전에 잔여 바이트를 비워야 한다. flush가 실패하면(불완전 UTF-8) 무시하고 분류 근거 없음으로 간다.
   이 flush는 `classifyFailure`가 있을 때만 한다.
4. **`classifyFailure`가 던지면 삼킨다.** 분류 실패가 provider 실패 보고 자체를 깨뜨리면 안 된다.
   `reason` 없이 기존 동작으로 간다.
5. **`plain` 헬퍼를 `providers.ts` 위쪽으로 옮겼다.** 새 분류 함수들이 쓰는데 원래 선언이 더
   아래에 있었다. 동작 변화는 없다.
6. **changeset bump를 `minor`로 잡았다.** 공개 타입 `AuthoringProviderFailureReason`과
   `PublicProviderFailure.reason` 필드가 새로 생겼다. A1·A2의 `patch`와 다른 판단이다.
7. **`reason` 키는 값이 있을 때만 넣는다.** `...(classified === undefined ? {} : { reason })`.
   기존 `toEqual` 단언(`nonzero invalid JSON schema mismatch를 안전하게 구분한다`)을 깨지 않고,
   "분류 근거 없음"과 "분류해서 undefined"를 구분하지 않는다.

## 7. 남은 위험

1. **추정 매핑 3종(401/403, 429, 5xx)이 검증되지 않았다.** 위 2장 참조. 틀리면 안내 문구가 엉뚱해진다.
2. **줄 앵커는 우회 가능하다.** 위 3장 참조. 최악은 문구 오류이며 유출·거짓 성공은 아니다.
3. **CLI 분기는 아직 없다.** 이 태스크는 `reason`을 만들어 올리기만 한다. 사용자가 보는 문구는
   `packages/cli`가 이 필드를 읽어 분기해야 바뀐다. 그 전까지 사용자 체감은 그대로다.
4. **codex의 `ERROR: {` 형식은 실측 한 사례에 기댄다.** 다른 오류 종류에서 형식이 다르면 매칭이
   안 되고 `reason`이 없다. 그 경우 기존 동작으로 떨어지므로 안전 방향이다.
