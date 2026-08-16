# T11 E2E 보고서

status: READY_FOR_REVIEW

## 요약

결함을 심은 서버 fixture 를 만들고, `test --repair-bundle` → 번들 검사 → `repair --yes` 까지
한 흐름으로 도는 E2E 를 넣었다. 테스트 4개 전부 통과하고 `packages/cli` 전체도 초록이다.
`examples/**` 는 한 글자도 안 건드렸고 실제 `codex`·`claude` 프로세스도 안 불렀다.

## 바꾼 파일

- 생성: `packages/cli/tests/repair-e2e.test.ts`
- 생성: `packages/cli/tests/fixtures/broken-weather-server.mjs`
- 생성: `docs/reports/task-T11-server-repair.md` (이 파일)

목록 밖 파일 수정 0건. `examples/**` 수정 0건. 의존성 추가 0건. git 명령 0건.

## 검증

`pnpm vitest run packages/cli/tests/repair-e2e.test.ts`

```
      Tests  4 passed (4)
```

`pnpm vitest run packages/cli`

```
 Test Files  20 passed (20)
      Tests  523 passed (523)
```

T10b 직후의 519 에서 4 가 늘었다. 기존 519 는 하나도 안 깨졌다.

`pnpm typecheck --force`

```
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
```

`pnpm lint`

```
Checked 183 files in 71ms. No fixes applied.
```

## 흐름

1. 임시 디렉터리에 케이스 하나짜리 명세를 쓰고, 결함 서버로 `test --repair-bundle` 을 돌린다.
   종료 코드 1 이고 번들 파일이 생긴다.
2. 번들을 읽어 `get-weather-unknown-city` 가 있고 `tool`·`input` 이 실렸는지, 그리고
   `IS_ERROR_MISMATCH` 진단의 `notes`(ADR-0027 의 서버 응답 본문)에 결함이 만든 빈 성공 응답이
   담겼는지 본다.
3. 가짜 provider 를 주입해 `repair <bundle> --yes` 를 돌린다. 종료 코드 0 이고 화면에
   `── 서버 수정 방향 (codex / gpt-5-codex) ──`, `원인 후보 …`, 경계 문장이 찍힌다.

임시 파일은 `tmpdir()` 아래에 만들고 `afterAll` 에서 지운다.

**진단 통로는 `generate` 의 실제 구현이다.** `prepareDiagnosisRequest`·
`dispatchDiagnosisRequest` 를 소스에서 그대로 가져다 쓰고 provider 만 가짜다. 요청 조립·승인
지문 검사·응답 검증이 전부 실제 코드로 돌지 않으면 이 E2E 가 확인하는 것이 없다.

## 임의로 판단한 지점 (판정 기준을 내가 소유한 부분)

- **fixture 서버가 `@modelcontextprotocol/sdk` 를 안 쓴다. stdio JSON-RPC 를 직접 구현했다.**
  처음에는 `examples/weather-server/server.mjs` 를 그대로 베껴 SDK 를 쓰게 만들었는데, 서버가
  부팅에서 죽었다.

  ```
  Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@modelcontextprotocol/sdk'
  imported from .../packages/cli/tests/fixtures/broken-weather-server.mjs
  ```

  그 패키지는 `packages/core/node_modules` 와 `examples/weather-server/node_modules` 에만 있고
  루트에도 `packages/cli` 에도 없다. `packages/cli/package.json` 에 의존성을 더하는 것은 팀
  `CLAUDE.md` 의 금지 사항이라, 대신 프로토콜을 손으로 썼다. 줄 단위 JSON 하나씩 주고받고
  `initialize`·`tools/list`·`tools/call` 셋만 처리한다. 응답 형식은 원본과 같고, 심은 결함도
  계획서가 지정한 하나(`WEATHER[city]` truthy 검사)뿐이다. **결정론적이고 외부 의존이 0 이다.**
- **fixture 를 tmpdir 로 복사하지 않고 그 자리에서 띄운다.** 사본을 또 만들 이유가 없다.
- **`repair 가 MCP 서버 프로세스를 띄우지 않는다` 의 판정 방식을 바꿨다.** 계획서는 "서버를
  죽인 뒤에도 repair 가 도는 것" 으로 확인하라고 했는데, 그것은 약한 판정이다. **repair 는
  서버 경로를 애초에 모르므로 파일이 있든 없든 같은 이유로 초록이 된다.** 지워서 초록인 것과
  원래 안 띄워서 초록인 것을 구분하지 못한다. 그래서 "띄울 **수단 자체가 없다**" 를 셋으로
  본다.
  1. 번들 직렬화 어디에도 서버 경로도 `process.execPath` 도 `command` 키도 없다. 띄우려 해도
     무엇을 띄울지 모른다.
  2. `repair` 의존성에 `connect` 필드가 없다. `test` 경로가 서버를 띄우는 그 필드가 여기엔
     아예 없다.
  3. 서버가 하나도 안 떠 있는 상태에서 `repair` 가 0 으로 끝나고 stderr 가 비어 있다.
- **첫 테스트에 "연결 실패가 아니다" 단언을 넣었다.** 서버가 부팅에 실패해도 종료 코드는 1 이라
  코드만 보면 시나리오가 실제로 돌았는지 알 수 없다. 실제로 위의 SDK 문제를 이 단언이 잡았다.
- **`vi.mock` 으로 `core`·`runner` 를 소스로 돌린다.** `cli-integration.test.ts` 와 같은 방식
  이다. 빌드 산출물이 낡아도 낡은 계약으로 판정하지 않는다.

## 남은 위험

- 이 테스트는 실제 서버 프로세스를 띄운다. **직렬 전용이다.** 다른 검증과 겹쳐 돌리면 실행
  시간이 흔들린다. 지금은 `packages/cli` 안에서 다른 파일과 같은 러너에 있다. 계획서가 말한
  "직렬 전용 웨이브" 는 사람이 실행 순서로 지키는 것이고 러너 설정으로 강제돼 있지는 않다.
- fixture 서버가 프로토콜을 직접 구현하므로 MCP 프로토콜이 바뀌면 여기도 손봐야 한다. 실제
  SDK 를 쓰는 도그푸딩 E2E(`cli-integration.test.ts`)가 그 축을 따로 지킨다.
- `notes` 단언은 본문에 `toString` 이 들어 있는지만 본다. 문장 전체를 박으면 ADR-0027 의 표시
  규칙이 바뀔 때마다 이 E2E 가 깨진다. 그 규칙은 runner 의 테스트가 소유한다.
