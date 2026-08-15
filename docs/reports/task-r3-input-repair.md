# Task R3: AI 제안과 권한 검사 (`cli`)

계획서 `docs/superpowers/plans/2026-08-15-dry-run-input-repair-implementation.md` §4 R3 을 구현했다.
권한 경계는 설계 문서 §4.3, 요청 문안은 §4.4 를 그대로 옮겼다.

## 바꾼 파일

| 파일 | 상태 |
|---|---|
| `packages/cli/src/repair-proposal.ts` | 신규 |
| `packages/cli/tests/repair-proposal.test.ts` | 신규 |

목록 밖 파일은 건드리지 않았다. `generate` 패키지는 읽기만 했고 `AuthoringRequestMode` 에 값을
추가하지 않았다. `mode` 는 `"revise"` 다.

## 권한 검사 표 대조

계획서 §4 R3 의 일곱 줄을 `acceptProposal` 안에서 같은 순서로 구현했다.

| 검사 | 코드 |
|---|---|
| 케이스 수가 같다 | `repair-proposal.ts:85` |
| 대상 케이스 외의 어떤 케이스도 `before` 와 deep equal 이다 | `repair-proposal.ts:92-95` |
| 대상 케이스의 `operation.tool` 이 같다 | `repair-proposal.ts:101-103` |
| 대상 케이스의 `assertions` 가 `before` 와 deep equal 이다 | `repair-proposal.ts:106` |
| 대상 케이스의 `id`·`name`·`timeoutMs` 가 같다 | `repair-proposal.ts:109-111` |
| 대상 케이스 `operation.input` 의 키 집합이 같다 | `repair-proposal.ts:118-122` |
| 값이 하나 이상 실제로 바뀌었다 | `repair-proposal.ts:125` |

하나라도 걸리면 그 자리에서 `undefined` 를 돌려준다. 부분 수용 경로는 없다.

## 검증 명령과 실제 출력

### `pnpm test`

```
 Test Files  56 passed (56)
      Tests  1175 passed | 1 skipped (1176)
   Start at  18:17:54
   Duration  1.84s (transform 2.75s, setup 0ms, import 5.18s, tests 7.00s, environment 3ms)
```

`packages/core/tests/stdio-integration.test.ts` 는 이번 실행에서 실패하지 않았다. 재실행이
필요하지 않았다.

R3 만 따로 돌린 결과.

```
 Test Files  1 passed (1)
      Tests  16 passed (16)
   Duration  184ms (transform 92ms, setup 0ms, import 113ms, tests 6ms, environment 0ms)
```

### `pnpm typecheck --force`

```
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
  Time:    2.304s
```

`Cached: 0 cached` 를 확인했다. 여섯 패키지 전부 `tsc --noEmit` 이 실제로 돌았다.

### `pnpm lint`

```
> biome check .

Checked 162 files in 34ms. No fixes applied.
```

첫 실행에서 두 파일이 포맷 위반으로 걸렸고 `biome format --write` 로 고친 뒤 통과했다.

## 임의로 판단한 지점

1. **`dispatch` 에 `session` 을 넘기지 않는다.** `dispatchAuthoringRequest` 는 `session` 을 받으면
   `reviewLocalAuthoringCandidate` 로 넘기는데, 그 함수는 세션이 `createAuthoringSession` 이
   등록한 내부 WeakMap 에 있어야 하고 없으면 `status: "invalid"` 로 떨어진다. R3 의 계약은
   `AuthoringSessionView` 를 받을 뿐 세션 생성 경로를 정하지 않으므로, 넘기면 호출 측이 어떤
   세션을 주느냐에 따라 조용히 항상 실패하는 코드가 된다. `session` 은 `baseline.suite` 와
   `approvedDraft.suite` 를 읽는 용도로만 쓴다. 응답 검증은 `validateAuthoringProviderResult`
   경로가 그대로 돈다.
2. **승인은 코드가 만든다.** `approval: { approved: true, fingerprint: preview.fingerprint }` 다.
   계획서와 설계서가 이 경로에 사람 승인 화면을 두지 않았고, `--provider` 를 지정한 것 자체가
   전송 승인이라고 봤다. 사람 확인은 §4.1 이 제안값을 받은 뒤에 두고 있다.
3. **`before` 는 `session.approvedDraft.suite`, `baseline` 은 `session.baseline.suite`.**
   교정은 승인된 현재 명세를 고치는 것이므로 대조 기준도 그것이다.
4. **`model` 은 `provider.model ?? ""`.** `prepareAuthoringRequest` 는 `model: string` 을 요구하고
   `TestAuthoringProvider.model` 은 선택이다. `dispatch` 는 `provider.model` 이 `undefined` 면
   모델 대조를 건너뛰므로 빈 문자열이 판정을 바꾸지 않는다.
5. **대상 아닌 케이스 대조를 인덱스 짝으로 한다.** 그래서 케이스 자리 이동도 위반이다.
   순서가 바뀌면 뒤 단계의 화면 번호와 재실행 대상이 어긋난다.
6. **redaction 소거 판정은 요청 문안에서 한다.** `prepareAuthoringRequest` 가 돌려준
   `preview.request.instruction` 에서 `서버 응답: ` 뒤를 보고, 비었거나 `[REDACTED]` 만 남았으면
   보내지 않고 `undefined` 다. 치환 함수가 `generate` 내부에 있어 밖에서 같은 계산을 두 벌로
   만들지 않으려는 선택이다.
7. **대상 케이스가 `callTool` 이 아니게 바뀐 응답은 툴 교체로 본다.** 표의 "툴이 같다" 줄에
   묶었다.

## 남은 위험

- **redaction 을 켜면 교정이 사실상 안 될 수 있다.** `prepareAuthoringRequest` 는 보내는
  `candidate` suite 를 치환한다. provider 가 치환된 값을 그대로 돌려주면 대상 아닌 케이스가
  `before` 와 달라져 제안 전체가 폐기된다. 막는 쪽으로 틀리는 것이라 안전하지만, R6 배선에서
  redaction 을 넘길 때 이 경로가 늘 폐기로 끝나는지 실환경으로 확인해야 한다.
- **`timeoutMs` 검사에 테스트가 없다.** 계획서 §4 R3 의 테스트 목록에 그 줄이 없어 목록 밖
  테스트를 만들지 않았다. 검사 자체는 `repair-proposal.ts:111` 에 있다.
- ~~suite 수준 메타데이터 변경은 검사하지 않는다~~ **리뷰(PR #105)에서 검사를 더했다.**
  `cases` 를 뺀 스위트를 deep equal 로 대조하고 다르면 제안 전체를 폐기한다. 지금 호출부는
  입력값만 꺼내 쓰므로 명세에 실릴 경로가 없었지만, 이 함수가 권한 경계 자체라 경계를 넘은
  응답을 조금이라도 수용하면 §4.3 이 금지한 부분 수용이 된다.

## 커밋 메시지

```
feat(cli): 입력값 교정 제안을 provider 에 요청하고 권한을 검사한다
```
