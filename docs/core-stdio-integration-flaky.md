# core stdio 통합 테스트 간헐 실패

`packages/core` 오너에게 넘기는 인계 문서다. AI provider 호출 복구 작업
(`docs/plans/2026-08-12-ai-provider-호출-복구-구현계획.md`) 중에 발견했고, 다른 오너의 패키지라
수정하지 않았다.

## 문제

`pnpm test` 전체 실행이 부하와 무관하게 간헐적으로 실패한다. 무부하 25회 실행에서 2회다.

```
FAIL  packages/core/tests/stdio-integration.test.ts > stdio 실제 프로세스 > handshake timeout 뒤 프로세스를 정리한다
Error: expect(received).toSatisfy()
Received: undefined
 ❯ assertNoResidue packages/core/tests/stdio-integration.test.ts:39:15
```

## 원인

`packages/core/tests/stdio-integration.test.ts:29`의 PID 파일 대기 예산이 20회 × 10ms = 200ms다.

```ts
for (let attempt = 0; attempt < 20 && pid === undefined; attempt += 1) {
  // ... 실패하면 setTimeout(resolve, 10)
}
```

이 테스트는 `connectTimeoutMs: 100`으로 handshake를 일부러 태운다. 자식 node 프로세스가 200ms
안에 기동해 PID 파일을 쓰지 못하면 `pid`가 `undefined`인 채 단언에 걸린다. 실패한 실행들의 소요
시간 324~386ms가 이와 맞는다.

`CLAUDE.local.md` 거짓 신호 표의 "재생 테스트가 가끔 실패 → 타임스탬프·실행 순서 의존"과, 실제
서버 프로세스를 띄우는 E2E를 직렬 전용 웨이브로 분리하라는 규칙에 동일하게 걸린다.

## 제안하는 처방

`packages/cli`의 같은 성격 결함을 Task B3에서 고친 방식을 그대로 쓸 수 있다. 통합 SHA `8998e0e`,
근거는 `docs/reports/task-b3.md`에 있다.

1. 판정을 벽시계 예산이 아니라 조건 폴링으로 바꾼다.
2. 최소 확인 횟수를 판정 조건에 넣는다. 부하로 이벤트 루프가 밀리면 벽시계만 지나가고 실제
   확인은 몇 번 못 한 채 실패로 판정된다. 이것이 흔들림의 방식이다. 마감을 늘리는 것으로는
   막지 못한다.
3. 안전장치 값에 실측 근거를 붙인다. B3에서는 15코어를 포화시킨 부하로 60회 측정해 최악값을
   구한 뒤 그 배수로 잡았다.
4. 실패 메시지를 고친다. 지금은 `Received: undefined`뿐이라 무엇이 왜 실패했는지 알 수 없다.
   실패 메시지가 곧 제품인 프로젝트의 기준에 맞지 않는다. PID 파일 경로, 기다린 시간, 확인
   횟수, 다음에 볼 것을 담아야 한다.

## 함께 검토할 구조 문제

실제 프로세스를 띄우는 테스트 세 개가 기본 유닛 실행에 섞여 있다.

- `packages/core/tests/stdio-integration.test.ts`
- `packages/cli/tests/cli-integration.test.ts`
- `packages/cli/tests/generate-integration.test.ts`

`CLAUDE.local.md`는 이런 E2E를 직렬 전용 웨이브로 분리하라고 요구한다. 분리하려면 루트
`vitest.config.ts`를 고쳐야 하는데 그것은 공유 계약이라 제안만 남긴다.

## 판정 기준

간헐 결함이므로 한 번 녹색은 근거가 되지 않는다. 수정 전후로 `pnpm test`를 각각 25회 이상
돌린 실패 횟수로 판정한다. 현재 대조군은 무부하 25회 중 2회 실패다.
