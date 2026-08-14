# CR2 보고서: `cli test` 참고 문장의 케이스 사이 순서

PR #80 의 CodeRabbit 지적 중 `packages/cli/src/test-command.ts` 건을 고쳤다.
기점 HEAD `0287122`.

## 결함

`specFindings` 를 만들 때 입력 계약 finding 전부를 먼저 넣고 단언 실질성 finding 전부를 뒤에
넣었다. 그 배열을 `caseId` 로 묶어 블록을 만들므로, 앞 케이스에 단언 실질성 finding 만 있고 뒤
케이스에 입력 계약 finding 이 있으면 `byCase` 의 삽입 순서가 뒤집혀 **뒤 케이스가 먼저**
출력됐다.

설계 문서와 보고서 양쪽에 "케이스 사이 순서는 명세 순서" 라고 적어 두고 실제로는 병합 순서가
됐다. T6 실환경 확인에서 안 걸린 이유는 `t6-combined.json` 의 첫 케이스에 입력 계약 finding 이
함께 있어 우연히 순서가 맞았기 때문이다.

## 고치기 전 빨간불 확인

회귀 테스트를 먼저 쓰고 고치기 전에 돌렸다. 명세는 `first-case`(입력은 옳고 `minLength: 0`),
`second-case`(입력 오타, `minLength: 1`) 두 개다.

```
× 케이스 사이 순서는 검사 종류와 무관하게 보고서의 케이스 순서다
AssertionError: expected 134 to be less than 8
Tests  1 failed | 87 passed (88)
```

`first-case` 블록이 오프셋 134, `second-case` 블록이 8 이다. 뒤 케이스가 먼저 나온다는 것이
숫자로 그대로 드러난다.

## 고친 내용

실패한 케이스의 버킷을 `finalReport.cases` 순서로 먼저 만들고, 두 검사 결과를 그 버킷에 채운
뒤 평탄화한다.

```ts
const buckets = new Map<string, SpecFinding[]>();
for (const item of finalReport.cases)
  if (item.status !== "passed") buckets.set(item.spec.id, []);
// … 검사 …
for (const finding of found) buckets.get(finding.caseId)?.push(finding);
return [...buckets.values()].flat();
```

- 실패 케이스 필터는 그대로다. 버킷에 없는 `caseId` 는 `buckets.get(...)?` 에서 걸러진다.
  키를 새로 만들지 않으므로 통과한 케이스의 finding 이 들어올 길이 없다.
- 검사 예외 삼킴도 그대로다. `try` 안에서 던지면 `[]` 를 돌려준다. 버킷 생성은 던질 수 없어
  `try` 밖에 뒀다.
- **한 케이스 안의 블록 순서는 건드리지 않았다.** 그것은 `FINDING_GROUP_ORDER` 가 맡는다.
  이번 수정은 케이스 **사이** 순서다.

## 바꾼 파일

- `packages/cli/src/test-command.ts`
- `packages/cli/tests/test-command.test.ts`
- `docs/superpowers/specs/2026-08-14-spec-findings-wiring-design.md` (§7.2 의 케이스 순서 문단만)
- `docs/reports/task-cr2-spec-findings-wiring.md` (이 문서)

`packages/generate` 와 `packages/cli/src/generate-command.ts` 는 건드리지 않았다.

## 검증

| 명령 | 판정 줄 |
|---|---|
| `pnpm vitest run packages/cli/tests/test-command.test.ts` | `Test Files  1 passed (1)` / `Tests  88 passed (88)` |
| `npx turbo typecheck --force` | `Tasks: 6 successful, 6 total` / `Cached: 0 cached, 6 total` |
| `npx biome check packages/cli/src/test-command.ts packages/cli/tests/test-command.test.ts` | `Checked 2 files in 32ms. No fixes applied.` |

전체 `pnpm test` 는 `packages/generate` 를 고치는 다른 작업자의 중간 상태가 섞이므로 돌리지
않았다.

## 임의로 판단한 지점

1. **`--json` 의 `spec.findings` 배열 순서도 함께 바뀐다.** 사람이 읽는 출력과 `spec.findings`
   가 같은 `specFindings` 배열 하나에서 나오므로, 그 배열의 순서를 고치면 직렬화 결과에도 그대로
   반영된다. 최상위 `findings` 가 아니라 `spec` 객체 안의 `findings` 다. 지시에 없던 부수
   효과지만 되돌리지 않았다. 바뀐 방향이 옳다. 기계가 읽는 출력도 케이스 순서가 보고서와
   같아야 하고, 한 케이스 안의 순서(입력 계약 다음 단언 실질성)는 그대로라 기존 `--json`
   테스트가 전부 통과한다.
2. **버킷을 `Map` 으로 뒀다.** 케이스 id 가 보고서에 중복으로 들어오면 한 버킷으로 합쳐진다.
   `validateMcpSuite` 가 중복 id 를 이미 막으므로 도달 불가 경로다. 배열로 두면 중복 케이스
   마다 블록이 갈리는데, 그 차이를 검증할 방법이 지금 없어 단순한 쪽을 골랐다.

## 남은 위험

1. **`byCase` 가 여전히 두 벌이다.** `specFindings` 를 만들 때 버킷으로 한 번 묶고, 표시할 때
   `byCase` 로 다시 묶는다. 두 번째 묶기는 이제 첫 번째의 결과를 그대로 되짚는 것이라 순서를
   바꾸지 않지만, 둘 중 하나만 고치면 다시 갈린다. 표시 단계가 버킷을 그대로 받도록 합치는
   것이 다음 정리 대상이다. 이번에는 지시 범위 밖이라 두었다.
2. ~~**같은 결함이 승인 화면에도 있는지 확인하지 않았다.**~~ **해소됨.** `generate-command.ts` 의
   `findingsForSelection` 도 두 검사 결과를 이어 붙이지만, 그 직후 `FINDING_GROUP` 으로 갈라져
   `writeFindingBlock` 이 그룹마다 따로 불린다. 한 블록 안에 한 검사 결과만 들어가므로 이어
   붙인 배열이 한 화면에서 섞이지 않는다. 구조가 다르다. 내 허용 파일 밖이라 열지 않았고,
   오케스트레이터가 직접 확인해 알려 왔다.

## 커밋 제안 (사람이 실행)

```
fix(cli): test 참고 문장의 케이스 순서를 보고서 순서로 고정한다
```
