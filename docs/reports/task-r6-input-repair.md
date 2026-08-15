# Task R6: `generate` 배선 (`cli`)

계획서 `docs/superpowers/plans/2026-08-15-dry-run-input-repair-implementation.md` §4 R6 을
구현했다. 저장 경로 순서는 설계 문서 §3, 반영 방법은 §5, 지문 시점은 §6, 화면 문안은 §8 이다.

## 바꾼 파일

| 파일 | 상태 |
|---|---|
| `packages/cli/src/generate-command.ts` | 수정 |
| `packages/cli/tests/generate-command.test.ts` | 수정 (기존 테스트 유지, 새 테스트 추가) |
| `packages/cli/tests/generate-integration.test.ts` | 수정 (실제 weather-server 교정 경로 1건 추가) |

웨이브 1·2 가 만든 `repair-target.ts`·`input-repair.ts`·`repair-proposal.ts`·
`dry-run-review.ts`·`dry-run.ts`·`cassette-wiring.ts`·`reset-hook.ts` 는 손대지 않았다.

## 저장 경로 순서 (설계 §3 대조)

`runInteractiveReview` 의 `save` 분기가 아래 순서로 돈다. 기존과 다른 세 곳만 적는다.

| 단계 | 자리 |
|---|---|
| 9. 입력값 교정 | `writeDryRunResult` 직후. 대상이 0건이면 아무것도 묻지 않는다 |
| 10. 교정 결과 반영 | `reviewLocalAuthoringCandidate` → `createAuthoringDiff` → `applyAuthoringChanges`. 교정 1건 이상일 때 **한 번만** 탄다 |
| 11. 분류 | `reviewDryRun(io, effective, attempts)`. 교정으로 통과한 케이스는 `passed` 로 바꿔 넘긴다 |
| 12. 최종 지문 | `save` 분기 첫 줄에서 분류 뒤로 옮겼다. `session.approvedDraft.suiteFingerprint` 를 반영이 끝난 뒤에 읽는다 |

지문은 읽는 자리 하나뿐이고 그 값이 `finalizeAuthoringDraft` 의 승인 지문이자 저장되는
`approval.fingerprint` 다. 화면과 파일이 갈릴 경로가 없다.

## 단일 케이스 재실행

새 모듈을 만들지 않았다. 케이스 하나만 담은 스위트로 기존 `runDryRun` 을 부른다. `aborted` 가
있으면 `passed: false` 로 본다. 스위트 전량을 다시 돌리지 않는 것을 호출 수로 못 박았다
(`재실행이 케이스 하나만 담은 스위트로 나간다`: 시험 실행 전량 + 1건).

## origins 확보

`selectRepairTargets` 의 `origins` 는 `session.approvedDraft.provenance` 에서 뽑는다
(`originsOf`). 실제 provenance 가 실린 경로를 지나는 테스트를 넣었다.

- `provenance 가 user 인 케이스는 교정 대상이 아니다` — `edit` 메뉴로 로컬 JSON 을 적용해
  `applyAuthoringChanges` 가 `origin: "user"` 를 실은 뒤, 그 케이스가 실패해도 교정 화면이 안
  나오는지 본다. 실제 `createAuthoringSession`·`applyAuthoringChanges` 를 쓴다.
- 나머지 교정 테스트는 전부 실제 `createAuthoringSession` 이 채운 `schemaBaseline` provenance 를
  지난다. 스텁 provenance 를 쓰는 테스트는 없다.

`origin: "ai"` 는 교정 대상이다. 설계 §4.2 가 제외하는 것은 `user` 뿐이다.

## 검증 명령과 실제 출력

### `pnpm test`

```
 Test Files  57 passed (57)
      Tests  1222 passed | 1 skipped (1223)
   Start at  19:07:39
   Duration  2.02s (transform 2.82s, setup 0ms, import 5.46s, tests 7.80s, environment 2ms)
```

`packages/core/tests/stdio-integration.test.ts` 는 이번 실행에서 실패하지 않았다.

### `pnpm typecheck --force`

```
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
  Time:    1.813s
```

`Cached: 0 cached` 를 확인했다.

### `pnpm lint`

```
> biome check .

Checked 164 files in 41ms. No fixes applied.
```

첫 실행에서 포맷과 import 정렬이 걸렸고 `biome format --write`·`biome check --write` 로 고친 뒤
통과했다.

### `pnpm build && pnpm --filter ohmymcp test:e2e`

R7 보고서에 붙였다. 두 태스크가 같은 명령 하나로 판정된다.

## 임의로 판단한 지점

1. **`--no-dry-run` 과 `--no-repair` 를 함께 주면 사용 오류다.** 계획서 옵션 표가 그렇게
   적었다. 교정은 시험 실행 안에서만 일어나므로 끄는 대상이 없고, 그 조합은 사용자가 둘 중
   하나를 착각한 것이다.
2. **고지의 재호출 줄 자리는 초기화 줄 다음이다.** 설계 §10 이 문안만 고정하고 자리를 안
   정했다. 대상·카세트·초기화에 이어 붙여 "이 실행이 무엇을 하는가" 를 한 덩어리로 뒀다.
3. **AI 제안용 provider 는 검토 메뉴가 쓰는 `preferred`·`model` 을 그대로 쓴다.** 사용자가 검토
   중에 provider 를 바꿨으면 교정 제안도 그것을 쓴다. 별도 옵션을 두지 않는다는 설계 §7 을
   그대로 따른 것이다.
4. **반영 요약은 지문 줄 다음, 저장 확인 앞이다.** §3 은 12(지문)→13(저장 확인) 만 정하고
   §5.4 는 "저장 확인 직전" 만 정했다. 둘을 함께 만족하는 자리가 그것 하나다.
5. **반영에 실패하면 저장하지 않고 메뉴로 돌아간다.** `reviewLocalAuthoringCandidate` 나
   `applyAuthoringChanges` 가 거절하면 `교정한 값을 명세에 반영하지 못했습니다.` 를 찍고
   `continue` 한다. 설계에 없는 상황이라 문안을 새로 만들었다. 반영 안 된 값을 통과로 저장하면
   화면과 파일이 갈리므로 저장을 막는 쪽을 골랐다.
6. **§8.8 요약 줄은 실제로 값이 바뀐 필드만 적는다.** 교정 라운드에서 안 바뀐 필드까지 적으면
   요약이 사실과 달라진다.

## 남은 위험

- **반영 실패 경로의 문안이 설계서에 없다.** 위 5번이다. 다음 화면 검토 때 문안을 §8 에
  올리는 것이 맞다.
- **교정 재실행이 카세트에 죽은 항목을 남긴다.** 설계 §10 이 이미 비범위로 적어 둔 사실이다.
- **`--cassette` 재생 중 교정하면 새 입력값이 카세트에 없어 실제 서버로 나간다.** 설계가 그렇게
  정한 동작이고(§10) 고지에도 적히지만, 재생만 될 것이라 믿는 사용자에게는 놀랄 수 있다.

## 커밋 메시지

```
feat(cli): generate 저장 경로에 입력값 교정 단계를 넣는다
```
