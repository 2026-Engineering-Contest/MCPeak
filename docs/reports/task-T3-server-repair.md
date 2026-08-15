# T3 `validateDiagnosisResult` 보고서

status: READY_FOR_REVIEW

## 요약

계획서 §5 T3 의 판단 규칙 여섯을 적힌 순서대로 구현했다. `diagnosis-request.ts` 에 추가만 했고
`prepareDiagnosisRequest` 본문은 안 건드렸다. 테스트 9개는 계획서 문장을 이름으로 썼고 전부
통과한다.

## 바꾼 파일

- 수정: `packages/generate/src/diagnosis-request.ts` (추가만. 기존 함수 본문 변경 없음.
  `diagnosis-schema.js` import 를 타입 전용에서 값 import 로 넓혀 `MAX_CAUSE_CHARS` 를 가져온다)
- 생성: `packages/generate/tests/diagnosis-result.test.ts`
- 생성: `docs/reports/task-T3-server-repair.md` (이 파일)

목록 밖 파일 수정 0건. 의존성 추가 0건. git 명령 0건. `localeCompare` 사용 0건.

## 검증

`pnpm vitest run packages/generate/tests/diagnosis-result.test.ts`

```
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

`pnpm vitest run packages/generate`

```
 Test Files  13 passed (13)
      Tests  211 passed | 1 skipped (212)
```

`pnpm typecheck --force`

```
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
```

`pnpm lint`

```
Checked 171 files in 41ms. No fixes applied.
```

## 규칙을 어떻게 지켰는지

1. **스키마 모양.** 최상위가 평범한 객체가 아니거나, `status` 가 두 값 밖이거나, `causes` 가
   배열이 아니거나, `shortfall` 이 문자열이 아니거나, `causes` 항목 하나라도 필수 필드가
   빠지거나 타입이 틀리면 `schemaMismatch` 다. 항목 단위 모양 위반은 **버리지 않고 전체를
   거절한다.** 계획서 1번이 "필수 필드가 빠진 경우" 를 `schemaMismatch` 로 못 박았기 때문이다.
2. `status: "diagnosis"` 인데 유효 항목이 0개면 `unsure` 로 접고 `shortfall` 은 빈 문자열이다.
   `status: "unsure"` 면 `causes` 를 통째로 버린다.
3. `caseId` 가 `preview.request.failures` 의 집합에 없으면 그 항목을 버린다.
4. `preview.request.specApproved === true` 이고 `target === "spec"` 이면 버린다. `false` 면
   통과시킨다. 완료 조건 4 를 테스트 둘로 고정했다.
5. `summary`·`location`·`evidence` 가 `MAX_CAUSE_CHARS` 를 넘으면 앞에서부터 남기고 자른다.
   코드 포인트 단위(`[...text]`)로 세고 자르므로 서로게이트 쌍 중간이 끊기지 않는다.
6. 버린 항목 수를 `discarded` 에 담는다.

**항목 순서**는 `preview.request.failures` 순서다. `caseId` → 인덱스 맵을 만들어 그 숫자만으로
비교하고, `Array#sort` 의 안정성으로 같은 `caseId` 안의 응답 상대 순서를 유지한다. 문자열
정렬이 필요 없으므로 `byCodeUnit` 도 `localeCompare` 도 쓰지 않았다.

## 임의로 판단한 지점

- **`status: "unsure"` 인데 온 `causes` 를 `discarded` 에 센다.** 계획서 2번은 "버리라" 고만
  적었고 6번은 "버린 항목 수를 `discarded` 에 담는다" 고 적었다. 둘을 합쳐 읽었다. 화면이
  "무엇인가 왔지만 쓰지 않았다" 를 말할 수 있는 쪽이 낫다고 봤다. 0으로 두길 원하면 한 줄이다.
- **`shortfall` 은 자르지 않는다.** 상한 대상은 §5.6-5 가 정한 셋(`summary`·`location`·
  `evidence`)뿐이다. 경계를 임의로 넓히지 말라는 지시대로 뒀다. 다만 provider 가 장문
  `shortfall` 을 보내면 화면을 밀어낼 수 있다. T10 이 화면에서 다룰지 판단이 필요하다.
- **`MAX_CAUSE_CHARS` 를 코드 포인트 수로 읽었다.** 상수 이름이 CHARS 이고 T2 의 stderr 상한만
  BYTES 다. 바이트로 읽으면 한글 500바이트(약 166자)라 화면 한 항목이 지나치게 짧아진다.
- **결과를 동결해서 돌려준다.** `frozen()` 을 재사용했다. `prepareDiagnosisRequest` 의 반환값과
  같은 성질이라 맞췄다.
- **biome 포매팅에 맞춰 줄바꿈과 따옴표를 조정했다.** `biome check --write` 를 내 두 파일에만
  돌렸다. 테스트 이름 중 `target: "spec"` 이 든 둘은 작은따옴표 리터럴이 됐다. 이름 문자열
  자체는 계획서 문장 그대로다.

## 남은 위험

- T2 보고서에 적은 preview 상태 저장소는 여전히 없다. T5 몫이다.
- `validateDiagnosisResult` 는 `preview` 를 신뢰한다. `preview` 가 위조되면 3·4번 검사가
  무의미해지지만, 그 경로는 T5 의 지문 검사가 막는다.
- `pnpm test` 전체는 안 돌렸다. 계획서 절차상 T5 이후 `--force` 로 도는 것이 맞다고 봤다.
