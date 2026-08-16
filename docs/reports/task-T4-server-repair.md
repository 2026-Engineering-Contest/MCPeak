# T4 provider `diagnose` 와 프롬프트 보고서

status: READY_FOR_REVIEW

## 요약

계획서 §5 T4 의 고정 문장 두 갈래를 한 글자도 바꾸지 않고 `diagnosis-prompt.ts` 에 넣고,
`makeProvider` 가 돌려주는 객체에 `diagnose` 를 추가했다. 새 factory 를 만들지 않았고
`TestAuthoringProvider` 인터페이스도 안 고쳤다. 테스트 10개 전부 통과한다.

## 바꾼 파일

- 생성: `packages/generate/src/diagnosis-prompt.ts`
- 수정: `packages/generate/src/providers.ts`
- 생성: `packages/generate/tests/diagnosis-prompt.test.ts`
- 수정: `packages/generate/tests/providers.test.ts` (맨 끝에 확인용 두 개 추가만. 기존 케이스
  수정·삭제 0건)
- 생성: `docs/reports/task-T4-server-repair.md` (이 파일)

목록 밖 파일 수정 0건. 의존성 추가 0건. git 명령 0건. 실제 `codex`·`claude` 프로세스 호출 0건.

## 검증

`pnpm vitest run packages/generate/tests/diagnosis-prompt.test.ts`

```
      Tests  10 passed (10)
```

`pnpm vitest run packages/generate/tests/providers.test.ts`

```
      Tests  39 passed (39)
```

`pnpm vitest run packages/generate`

```
 Test Files  14 passed (14)
      Tests  223 passed | 1 skipped (224)
```

`pnpm typecheck --force`

```
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
```

`pnpm lint`

```
Checked 173 files in 39ms. No fixes applied.
```

## 계약을 어떻게 지켰는지

- 역할 문장 두 갈래는 계획서 §5 T4 의 여섯 줄을 그대로 상수에 담았다. 끝에 기존과 같은
  untrusted 경고를 붙인다.
- `MCP_SUITE_JSON_SCHEMA` 를 넣지 않는다. 테스트가 `"suiteJson"` 과 `"TestSuiteSpec"` 둘 다
  0건임을 단언한다.
- 배치는 기존 `prompt()` 와 같다. 역할 문장 맨 앞, 출력 스키마와 요청 JSON 이 중간, untrusted
  경고가 맨 뒤다.
- `makeProvider` 가 돌려주는 객체에 `diagnose` 를 **추가**했다. 새 factory 없음.
- `TestAuthoringProvider` 는 그대로다. `makeProvider` 의 반환 타입만
  `TestAuthoringProvider & ServerDiagnosisProvider` 로 넓혀 한 객체가 두 인터페이스를 구조적으로
  만족하게 뒀다.
- `diagnose` 는 `author` 와 같은 실행 경로를 쓴다. 두 경로가 공유하는 `execute` 클로저를
  `makeProvider` 안에 두고, 다른 것은 `stdin` 과 출력 스키마 둘뿐이다. 모델·env allowlist·
  샌드박스 설정은 한 곳에만 있다.
- `unwrap` 은 재사용하지 않는다. `unwrapDiagnosis` 를 따로 만들었다.
- provider 실패는 기존과 같이 `AuthoringProviderError` 로 접는다. raw stdout·stderr 는 안 싣는다.
- 프롬프트는 요청 JSON 직렬화 하나에만 의존한다. 시간·난수·환경 변수 참조 0건.

## 임의로 판단한 지점

- **claude envelope 검사를 `claudeStructuredOutput` 함수로 뽑아 `unwrap` 과 `unwrapDiagnosis` 가
  함께 쓰게 했다.** 계획서는 "같은 규칙을 쓴다" 고만 적었고 구현 방식은 안 정했다. 규칙을 두
  벌로 복사하면 한쪽만 고쳐지는 사고가 난다는 계획서 문장을 근거로 공유 함수로 갔다. `unwrap`
  의 동작은 그대로다(`providers.test.ts` 39개 전부 통과가 근거다).
- **`unwrapDiagnosis` 는 "객체인가" 까지만 본다.** `status`·`causes`·`shortfall` 의 모양 검사는
  T3 의 `validateDiagnosisResult` 가 이미 하고, 여기서 또 하면 거절 지점이 두 곳이 되어 어느
  쪽이 거절했는지 설명하기 어려워진다.
- **codex 의 `--output-schema` 파일 이름을 `authoring-output-schema.json` 그대로 뒀다.**
  계획서가 "차이는 셋뿐" 이라며 파일 **내용**만 다르다고 못 박았기 때문이다. 이름을 바꾸면
  차이가 넷이 된다. 파일은 실행마다 만드는 임시 cwd 안에 있어 이름이 겹칠 일도 없다. 다만
  이름이 authoring 인데 내용이 진단 스키마라 읽는 사람이 헷갈릴 수 있다. 바꾸길 원하면 알려
  달라.
- **`providers.test.ts` 에 추가한 둘은 회귀 확인용이다.** 하나는 author 의 stdin 에 suite 스키마
  안내와 기존 역할 문장이 그대로 있는지, 다른 하나는 반환 객체가 `author` 와 `diagnose` 를 함께
  갖는지 본다. 기존 케이스는 건드리지 않았다.
- **biome 포매팅에 맞춰 import 순서를 조정했다.** `biome check --write` 를 새로 만든 테스트
  파일 하나에만 돌렸다.

## 남은 위험

- `diagnose` 의 반환은 `unknown` 이다. 호출자가 `validateDiagnosisResult` 를 반드시 거쳐야
  한다. 그 배선은 T5 몫이다.
- preview 상태 저장소는 이 시점에 아직 없었다(T2·T3 보고서와 같음). T5 에서 만들었다.
- `index.ts` 는 안 건드렸다. `diagnosisPrompt`·`DIAGNOSIS_PROVIDER_SCHEMA` 등의 export 는 T5 의
  Files 목록에 있다.
- `pnpm test` 전체는 안 돌렸다. T5 이후 한 번 도는 것이 계획서 절차다.
  **(이후 경과)** 루트 `test` 는 `vitest run` 이라 `--force` 옵션이 없다.
