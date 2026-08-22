# External Record/Replay 구현 계획 (ADR-0051 ~ 0053)

- 상태: **ADR 확정 대기.** 이 문서는 조사 결과와 계획이며 코드 변경을 포함하지 않는다.
- 작성일: 2026-08-21
- 설계 기준: [ADR-0051](../../adr/0051-external-record-replay와-tool-카세트-경계-분리.md),
  [ADR-0052](../../adr/0052-coordinator가-engine과-session-store를-소유한다.md),
  [ADR-0053](../../adr/0053-http-외부-요청-매칭과-반복-호출-정책.md) — 이 계획서를 쓸 당시에는
  **셋 다 `제안` · `미승인`** 이었고, 그것을 해소하는 것이 단계 A 였다. 지금은 A-1 의 blocking
  항목이 모두 닫혀 **채택**되었으므로, 아래 서술 중 "채택된 ADR" 은 확정 사항을 가리킨다.
  채택 자체는 이 구현과 별도 PR 로 낸다(A-5 5번).
- 조사 기준: 브랜치 `codex/remove-record-replay-design-notes`, HEAD `d08d738`
- 관련 이슈: [#228](https://github.com/2026-Engineering-Contest/MCPeak/issues/228) (Node 22.13 상향, 열림),
  [#227](https://github.com/2026-Engineering-Contest/MCPeak/issues/227) (`verify`·`generate` 가 서버 종료 원인을 버림 — legacy 결함이나 A-4-9 의 선례)
- 범위 밖: `docs/2026-08-20-record-replay-상위-설계.md`,
  `docs/2026-08-21-record-replay-외부호출-어댑터-설계.md` (삭제됨, 정본 아님)

---

## 0. 조사로 확인한 현재 구현

ADR·문서의 서술과 실제 코드가 갈리는 지점만 적는다. 근거는 전부 이 저장소의 파일이다.

| # | 문서/ADR의 서술 | 실제 확인 결과 | 근거 |
|---|---|---|---|
| 0-1 | "기존 `NODE_OPTIONS`를 덮어쓰지 않고 병합한다" (ADR-0052) | 자식은 부모의 `NODE_OPTIONS`를 **애초에 상속받지 않는다.** spawn env 는 `{...getDefaultEnvironment(), ...options.env}` 이고, SDK 의 `DEFAULT_INHERITED_ENV_VARS` 에 `NODE_OPTIONS` 가 없다. 병합 대상은 **호출자가 `env` 로 넘긴 값** 하나뿐이다 | `packages/core/src/controlled-stdio.ts:80`, SDK `client/stdio.js` |
| 0-2 | CLI 가 `connectStdio({ env })` 경계로 Bootstrap 을 주입한다 (ADR-0052) | `core.connectStdio` 는 `env` 를 받지만, **CLI 의 주입 시그니처에는 `env` 가 없다.** `connect(options: { command, args })` 로 좁혀져 있고 호출부가 2곳이다 | `packages/cli/src/test-command.ts:90`, `:624`, `:800` |
| 0-3 | matchKey 는 정규화 요청의 stable JSON 을 SHA-256 (ADR-0053) | `stableStringify` 는 이미 있고 공개돼 있다. 키 정렬·비유한수 거부·순환 거부·sparse 거부까지 ADR 요구를 만족한다. 다만 **legacy 진입점(`@mcpeak/record`)의 export** 라 ADR-0051 의 "external 은 legacy 진입점을 import 하지 않는다" 와 충돌한다 | `packages/record/src/index.ts:166`, `:253` |
| 0-4 | 민감 키 판정은 `normalizeKey` 가 흡수한다 (ADR-0053) | **`normalizeKey` 라는 함수는 저장소에 없다.** 실제 구현은 `keyWords` + `sensitiveKey` 이고 둘 다 **비공개**다 | `packages/record/src/index.ts:66`, `:123`, `:150` |
| 0-5 | `HttpBody` 는 "어댑터 확장 설계의 tagged union", canonical 규칙은 "같은 문서 5.1.1" (ADR-0053) | 그 문서는 `d08d738` 에서 삭제됐다. **ADR-0053 의 규범 참조가 끊겨 있다** | `docs/adr/0053-…:66`, `:69` |
| 0-6 | `node:sqlite` 사용, 최소 Node 22.13 상향 (ADR-0052) | CI 는 `verify` 잡을 **Node 20/22/24 매트릭스**로 돌린다. 또한 **배포 패키지에 `engines` 필드가 하나도 없다** — 루트(private)에만 `>=20` 이 있다. 상향은 6개 package.json + ci.yml + README 를 건드리는 릴리스 범위 변경이다 | `.github/workflows/ci.yml`, `package.json`, `packages/*/package.json` |
| 0-7 | — | ci.yml 주석이 이미 못 박아 뒀다: **"Node 20 지원 자체를 접을지는 팀 결정 사항이다 (CONTRIBUTING §6 개정 + ADR)"** | `.github/workflows/ci.yml` build 잡 주석 |
| 0-8 | — | `@mcpeak/record` 는 단일 진입점(`src/index.ts`, 1,350줄)이고 빌드 entry 도 그것 하나다. subpath 를 내려면 **4곳**을 같이 고쳐야 한다: `packages/record/package.json` exports, `packages/record/tsdown.config.mjs` entry, `tsconfig.base.json` paths, `vitest.config.ts` alias | 각 파일 |
| 0-9 | — | 자식 프로세스를 띄우는 스펙은 파일명이 `*-e2e.test.ts` 여야 e2e 갈래로 가고, 그 갈래만 `fileParallelism: false` 다 | `vitest.config.ts` |
| 0-10 | — | dashboard 는 `@mcpeak/cli/commands` 재export 면과 `@mcpeak/record` 를 직접 쓴다. CLI 조립이 확정되기 전에는 건드릴 수 없다 | `packages/dashboard/src/server/wiring.ts:10`, `routes.ts:5` |
| 0-11 | — | `packages/cli/src/index.ts` 의 `COMMANDS` 배열에 `"record"` 가 이미 들어 있으나 **핸들러가 없다.** 지금 `mcpeak record` 는 사용 오류로 떨어진다 | `packages/cli/src/index.ts` |

### 0-A. 실측한 런타임 사실 (이 환경 Node v24.16.0)

계획의 전제가 되는 값이라 추측 대신 실행해서 확인했다.

| 확인 | 결과 |
|---|---|
| `NODE_OPTIONS="--import <윈도우 절대경로>"` | **실패.** `ERR_UNSUPPORTED_ESM_URL_SCHEME`, 자식이 시작조차 못 한다. Bootstrap 경로는 `pathToFileURL().href` 로 넘겨야 한다 (경로에 공백이 있으면 percent-encoding 필수) |
| `NODE_OPTIONS="--import file:///…%20…/hook.mjs"` | 성공. 사용자 코드보다 먼저 로드된다 |
| `--import` 훅에서 `globalThis.fetch` 교체 | 성공. 이후 사용자 코드의 `fetch` 가 래퍼를 본다 |
| 래퍼가 만든 `new Response(...)` 의 `url` | **빈 문자열.** ADR-0053 이 요구하는 "관찰 가능한 `url` 복원" 은 기본 생성자로는 안 된다 |
| `Object.defineProperty(response, "url", { value })` | 성공. `status`·`ok`·`instanceof Response` 유지 |
| `node:sqlite` — Node 24.16.0 | 플래그 없이 동작. 경고 없음 |
| `node:sqlite` — Node 22.13.0 | 플래그 없이 동작. 단 **매 실행 stderr 에 `ExperimentalWarning: SQLite is an experimental feature`** 가 찍힌다 |
| `node:sqlite` — Node 20.20.2 | `ERR_UNKNOWN_BUILTIN_MODULE`. **`--experimental-sqlite` 플래그조차 `bad option`** 으로 거부된다. 우회 경로가 없다 |
| `--import` 대상이 `.ts` 파일 | Node 24 는 type stripping 이 기본이라 로드된다. **Node 22.13 은 기본 활성이 아니다(22.18 부터).** 자식 진입점을 `.ts` 로 두면 매트릭스에서 깨진다 |

---

## 단계 A — ADR 0051 ~ 0053 확정

세 ADR 은 방향(경계 분리 / 부모 소유 / 보수적 정규화)에서 서로 모순되지 않는다. 채택을 막는
것은 방향이 아니라 **끊긴 참조와 미정 항목**이다. 아래 A-1 을 고치기 전에는 채택하지 않는다.

### A-1. 채택 전에 반드시 고쳐야 할 문장 (blocking)

| ID | 위치 | 문제 | 조치 |
|---|---|---|---|
| A-1-1 | ADR-0053 §결정 (`HttpBody`, canonical 규칙) | 삭제된 설계 문서를 규범으로 참조한다. 지금 상태로 채택하면 **매칭 키의 정의가 저장소에 없다** | tagged union 정의와 canonical 규칙(키 정렬 기준, 숫자 표기, `-0`, escape, UTF-8 해시 입력)을 ADR 본문에 **인라인**한다. `stableStringify` 의 현재 동작(0-3)을 그대로 서술하면 새로 정할 것이 없다 |
| A-1-2 | ADR-0053 §민감 키 | 존재하지 않는 함수 `normalizeKey` 를 계약으로 쓴다 | `keyWords` + `sensitiveKey`(접미 단어열 일치, 복수형 흡수)로 문구를 고친다. ADR-0039·0045 의 서술과 일치시킨다 |
| A-1-3 | ADR-0052 §결정 (Node 22.13 상향) | 저장소 전체의 런타임 정책을 `담당: record, cli` ADR 안에 접어 넣었다. ci.yml 주석(0-7)이 이미 "CONTRIBUTING §6 개정 + ADR" 을 요구한다 | Node 상향을 **별도 ADR(담당: 릴리스/전체)** 로 떼고 0052 는 그것을 선행 결정으로 참조만 한다. 0052 의 채택이 Node 정책 합의에 인질로 잡히지 않는다 |
| A-1-4 | ADR-0052 §부트스트랩 설정 | 설정 4개(`mode`·`coordinatorUrl`·`coordinatorToken`·`adapters`)의 **전달 채널이 없다.** token 을 argv 로 주면 프로세스 목록에 노출된다 | "env 로 전달, argv 금지" 를 명시하고 A-4-3 의 손자 프로세스 불변조건을 함께 적는다 |
| A-1-5 | ADR-0052 §Coordinator 통신 | schema version 을 "Coordinator 가 검증한다" 고만 적었다. **언제(핸드셰이크 vs 요청마다) 보내는지가 없다** | 핸드셰이크 1회 + 요청마다 재확인 중 하나를 고른다. 구현은 `begin`/`complete`/`lookup` 3개 연산에 버전 필드를 싣는 쪽이 단순하다 |
| A-1-6 | ADR-0053 §저장과 복원 | "관찰 가능한 `url` 도 복원해야 한다" 만 있고 방법이 없다. 순진한 구현은 조용히 `""` 를 준다(0-A) | 복원 수단(`defineProperty`)과 **복원 실패 시 지원 오류** 를 결과 항목에 못 박는다 |

### A-2. ADR 이 아직 정하지 않은 것 — 구현 전에 확정 필요

1. **shared 추출 시점.** ADR-0051 은 external 이 legacy 진입점을 import 하는 것을 금지하면서,
   순수 함수 추출은 "의미가 테스트로 확인된 뒤" 로 미룬다. 그런데 최소 수직에 당장 필요한 것이
   `stableStringify` 와 민감 키 판정이다(0-3, 0-4). 선택지는 둘이다.
   - (a) external 안에 임시 복제 → 중복이 남고 두 곳이 갈릴 수 있다.
   - (b) **동작 보존 추출 PR 을 B 앞에 하나 둔다** → 0051 의 "필요한 순수 함수만 작은 변경 단위로
     추출한다" 와 정확히 같은 문장이다. **(b) 를 권한다.** 0051 의 순서 서술을 이에 맞춰 한 줄
     고친다.
2. **자식 측 소스 형식.** 자식 진입점이 `.ts` 면 Node 22.13 매트릭스에서 로드되지 않는다(0-A).
   `.mjs` 로 쓰거나(테스트가 소스를 그대로 spawn 가능), TS 로 두고 e2e 전에 빌드를 요구한다
   (CI `verify` 잡은 빌드를 하지 않으므로 CI 구조 변경 유발). **`.mjs` 를 권한다.**
3. **마스킹 경계.** ADR-0041 은 legacy 에서 "경계에서 마스킹, 런타임 내부는 원문" 이다.
   ADR-0053 은 external 에서 "**matchKey 계산 전**, 자식 안에서 마스킹" 이다. 모순은 아니지만
   적용 지점이 다르므로 0053 에 "external 경로에 한해 0041 과 적용 지점이 다르다" 를 명시한다.
4. **`--determinism` 과 세션.** `test` 는 2회차에서 **다시 connect 한다**(0-2, `test-command.ts:800`).
   External 세션에서 2회차를 어떻게 볼지(같은 source session 재생 / 새 record 세션 / 조합 금지)가
   어느 ADR 에도 없다. **1차는 "동시 사용 금지 + 명시적 오류"** 를 권한다.
5. **Coordinator 요청 타임아웃.** fail-closed 는 정했지만 "얼마나 기다리다" 가 없다. 자식이
   `begin` 응답을 영원히 기다리면 서버 코드가 멈춘다.
6. **CLI 옵션 이름.** 0051 이 "CLI 설계에서 정한다" 로 열어 뒀다. **C 단계 전까지 정하지 않는다.**
   ADR 에 옵션 이름을 지금 박지 않는다.
7. **SQLite 물리 스키마·마이그레이션 정책.** 0052 는 "부모만 연다" 까지만 정했다. 칼럼·인덱스·
   버전 관리는 **미정이며, 미정인 채로 채택해도 된다**(C 단계 대상).
8. **External 세션의 드리프트 확인 경로가 없다.** legacy 에 `verify` 가 있는 이유는 auto 모드가
   "카세트에 있으면 서버를 안 부른다" 라서 서버 응답이 바뀌어도 모르기 때문이다. External
   Replay 는 MCP 서버를 실제로 띄우므로 **서버 코드의 드리프트는 잡힌다.** 그러나 저장된
   **외부 API 응답**이 낡아도 아무도 모른다 — 실제 API 가 바뀐 뒤에도 테스트는 영원히 초록이다.
   legacy 가 `verify` 로 막는 그 false-green 이 external 에 그대로 남는데, 세 ADR 어디에도
   대응 결정이 없다. 선택지: (a) 재검증 명령을 H2 이후로 **명시적으로** 미룬다, (b) 세션에
   녹화 시각·나이를 남기고 Replay 종료 시 경고한다, (c) 아무것도 하지 않는다 — (c) 를 고르더라도
   "이 도구는 외부 API 드리프트를 감지하지 않는다" 를 문서에 못 박아야 한다.

### A-3. 최소 수직 이후로 미뤄도 되는 것

SQLite 물리 스키마, 마이그레이션, CLI 공개 옵션, dashboard 연동, Python·Go 어댑터,
redirect·stream·multipart·binary, `auto` 모드, 사용자 정의 matcher,
ADR-0051 의 자동 검사 4종 중 "변경 범위 검사" 와 "저장 스키마 상호 거부 테스트"
(후자는 external 파일 포맷이 생기는 C 단계에 붙는다).

### A-4. 채택과 함께 고정할 불변조건

인증·수명주기·저장 실패·miss 는 "나중에 조이는" 항목이 아니다. B 의 테스트가 이것들을 직접
단언한다.

- **A-4-1 (인증)** token 은 CSPRNG 256비트 이상, `Authorization: Bearer` 헤더로만, 상수 시간
  비교, 실패는 401/403, 오류 body 에 token·길이·일부를 싣지 않는다. token 은 SQLite·로그·
  stderr 어디에도 남기지 않는다.
- **A-4-2 (bind)** `127.0.0.1` + port 0. 외부 인터페이스 bind 금지.
- **A-4-3 (누수)** Bootstrap 설정은 env 로 전달하고, **Bootstrap 은 읽은 직후 자기
  `process.env` 에서 그 값을 지운다.** 단, `NODE_OPTIONS` 자체는 MCP 서버가 spawn 하는 **손자
  Node 프로세스에도 상속**되므로 훅이 그쪽에도 설치된다. 1차 방침을 정해 적는다(권장: 손자
  프로세스는 Coordinator 설정을 못 읽으므로 훅이 **조용히 비활성화**된다).
- **A-4-4 (stdout)** 훅과 Coordinator Client 는 MCP stdio 의 stdout 에 한 바이트도 쓰지 않는다.
- **A-4-5 (fail-closed)** 연결 실패·인증 실패·알 수 없는 schema version·크기 상한 초과는 전부
  명시적 실패다. **실제 네트워크로 우회하지 않는다.**
- **A-4-6 (Record 순서)** `begin` → 실제 호출 → `complete`. 예약 실패면 실제 호출을 하지 않는다.
  `begin` 후 자식이 죽으면 interaction 은 incomplete 이고 그 세션은 **Replay 원본이 될 수 없다.**
- **A-4-7 (Replay miss)** 필요한 occurrence 가 없으면 실제 호출 없이 실패한다. 같은 저장
  occurrence 를 두 번 돌려주지 않는다. 미사용 interaction 은 실패가 아니라 종료 시 경고다.
- **A-4-8 (동시성)** 같은 matchKey 가 앞 호출의 `complete` 전에 다시 `begin` 되면 실제 호출 전에
  명시적 오류. 다른 matchKey 는 동시 진행 허용.
- **A-4-9 (Bootstrap 실패 진단)** `--import` 대상이 없거나 URL 이 아니면 자식은 MCP 핸드셰이크
  전에 죽는다(0-A 실측). 이때 `MCP_CONNECTION_FAILED` 한 줄로 뭉개지 말고 Bootstrap 주입 실패로
  구분하고, **`renderProcessDiagnostics`(`packages/cli/src/process-diagnostics.ts`)를 처음부터
  재사용해** exit code·signal·stderr 를 함께 낸다.
  이것은 가상의 위험이 아니다. [#227](https://github.com/2026-Engineering-Contest/MCPeak/issues/227)
  이 같은 결함을 이미 기록하고 있다 — 같은 실패에서 `test` 는 원인을 보여주는데
  `generate` 연결 실패(`generate-command.ts:2032`)와 `verify` 연결 실패
  (`verify-command.ts:229`, `catch` 가 오류를 바인딩조차 하지 않는다)는 버린다. 세 경로 중
  둘에서 이미 재발한 결함이므로 external 을 네 번째로 만들지 않는다.

### A-5. 채택 시 갱신 절차

1. 각 파일 머리: `상태: 제안 → 채택`, `승인: 미승인 → 승인자·날짜`.
   - 용어는 **`채택`** 으로 통일한다. 색인에 `승인`·`채택`·`제안`·`초안` 이 섞여 있는데, 최근
     record ADR(0040·0041·0045·0047)이 전부 `채택` 이다.
2. `docs/adr/README.md` 의 0051~0053 행 상태 열을 같은 값으로 바꾼다. **행은 이미 있다.**
3. A-1-3 대로 Node ADR 을 새로 만들면 색인에 행을 추가하고 0052 의 선행 결정 목록에 링크한다.
4. **병합 직전 번호 재확인.** 색인 말미가 기록하듯 재번호가 15회 났다. 0051~0053 은 서로를
   링크하므로 하나가 밀리면 **파일명 3개 + 제목 3개 + 색인 3행 + 상호 참조 링크**를 함께 옮긴다.
5. ADR 채택은 `docs(adr):` 커밋으로, 구현과 **다른 PR** 로 낸다.

### A-6. 구상 문서(「MCP 테스트 및 코드 최적화 도구 구상」) 대조

원 구상 문서의 §2~§4(Session Recording/Replay, Replay의 목적, 저장 방식)와 세 ADR 을
대조했다. 방향은 일치하고, **ADR 에 빠진 요구가 3건** 있다.

| 구상 문서의 요구 | 현재 ADR | 판정 |
|---|---|---|
| "MCP Tool 전체 실행 결과가 아니라 **외부 API 호출 결과**를 저장" | ADR-0051 의 External 경계 그대로 | 일치 |
| "**MCP Tool 코드가 변경되더라도** 외부 API 응답은 기존 데이터를 활용" | Replay 에서도 실제 MCP 서버를 실행(ADR-0051·0052) | 일치. **legacy Tool 카세트는 이 요구를 만족한 적이 없다** — 경계 분리의 최종 근거 |
| "Replay 시 외부 API 호출 없이 결과 반환" | miss 도 네트워크로 새지 않음(A-4-5, A-4-7) | 일치 |
| 저장: **SQLite**, `.mcp-test/sessions.db`, 사용자 로컬 | ADR-0052 가 `node:sqlite` 선택 | 매체는 일치. **저장 경로 규약은 ADR·코드 어디에도 없다**(저장소 전체 검색 결과 `.mcp-test`·`sessions.db` 문자열 0건) |
| 저장 항목: 어떤 API / **언제** / 어떤 요청 / 어떤 결과 | ADR-0053 은 protocol·matchKey·occurrence·ordinal·outcome 만 정한다 | **누락.** "언제" 에 해당하는 값이 없다 |
| "`/clear` 또는 대응 CLI 명령으로 기존 세션·캐시 정리" | 어느 ADR 에도 없다 | **누락.** 세션 수명주기 CLI(목록·삭제·정리) 미정 |

보완 항목 3건은 다음과 같이 다룬다.

- **A-6-1 (호출 시각)** interaction 에 녹화 시각을 **메타데이터로만** 남긴다. **matchKey 입력에
  넣지 않는다** — 넣으면 같은 요청이 매번 다른 키가 되어 Replay 가 전부 miss 가 되고,
  결정론성(CLAUDE.md)도 깨진다. 시각은 표시·진단용이며, A-2-8 의 외부 API 드리프트 경고
  선택지 (b)("녹화 나이를 경고한다")가 이 값 위에 선다.
- **A-6-2 (저장 경로)** 세션 저장 위치를 `.mcp-test/sessions.db` 로 고정할지, 다른 이름을 쓸지
  정한다. 제품명이 MCPeak 으로 바뀐 뒤라(ADR-0050) 구상 문서의 `.mcp-test` 를 그대로 쓸지가
  선택 지점이다. 어느 쪽이든 `.gitignore` 항목을 함께 추가한다.
- **A-6-3 (세션 관리 CLI)** 목록·삭제·정리 명령을 C 단계 범위에 넣는다. 구상 문서가 명시한
  기능이라 "나중에" 로 미루면 요구가 빠진 채 완료 판정이 난다.

구상 문서가 정하지 않은 것 — 매칭 키 규칙, occurrence 순서 소비, 프로세스 경계와 인증, miss
정책 — 은 ADR 이 더 나간 부분이며 모순이 아니다.

### A-7. ADR 파일별 수정 체크리스트

A-1·A-2·A-6 을 **고칠 파일 기준**으로 다시 자른 것이다. 이 표가 P0 의 작업 목록이다.
등급: **필수** = 이걸 고치지 않으면 채택하면 안 됨 / **보완** = 채택은 가능하나 구현 전에 필요.

#### `0051-external-record-replay와-tool-카세트-경계-분리.md` (2건)

| # | 위치 | 지금 | 고칠 내용 | 등급 |
|---|---|---|---|---|
| 51-1 | §결정, `shared` 문단 | "동일한 의미와 안전 불변조건이 테스트로 확인된 뒤 별도 동작 보존 변경으로 추출한다" | 최소 수직이 `stableStringify`·민감 키 판정을 **먼저** 필요로 한다. "External 구현 착수 전에 동작 보존 추출을 선행 변경 단위로 수행한다" 로 순서를 명확히 한다(B-0) | 필수 |
| 51-2 | §배경 영향표, `verify` 행 | "legacy 가 남는 동안 유지" | 그대로 두되 **"External 경로에 대응하는 재검증 수단은 이 ADR 범위 밖이며 미정"** 을 덧붙인다. 지금은 legacy 를 지우면 드리프트 확인 수단이 통째로 사라진다는 사실이 어디에도 안 적혀 있다 | 보완 |

#### `0052-coordinator가-engine과-session-store를-소유한다.md` (8건)

| # | 위치 | 지금 | 고칠 내용 | 등급 |
|---|---|---|---|---|
| 52-1 | §결정 마지막 문단 | "최소 Node 버전을 `22.13.0` 이상으로 올리는 것을 **이 결정에 포함한다**" | 저장소 전역 정책을 record·cli ADR 이 삼키고 있다. **별도 ADR 로 분리**하고 여기서는 선행 결정으로 링크만 한다(#228) | 필수 |
| 52-2 | §결정, 부트스트랩 설정 표 | 설정 4개만 나열 | **전달 채널을 명시한다: env 로 전달, argv 금지**(argv 는 프로세스 목록에 노출) | 필수 |
| 52-3 | §결정, `NODE_OPTIONS` 문장 | "기존 `NODE_OPTIONS` 는 덮어쓰지 않고 병합한다" | 자식은 부모 `NODE_OPTIONS` 를 **상속받지 않는다**(0-1). 병합 대상은 호출자가 `env` 로 넘긴 값뿐임을 정정 | 필수 |
| 52-4 | §결정, 같은 문장 옆 | 경로 형식 언급 없음 | `--import` 대상은 **`file://` URL(`pathToFileURL().href`)** 이어야 한다. 절대경로 문자열은 Windows 에서 자식이 시작조차 못 한다(0-A 실측) | 필수 |
| 52-5 | §결정, Coordinator 통신 목록 | schema version 을 "검증한다" 만 | **언제 보내는지**(핸드셰이크 1회 / 요청마다)를 정한다 | 필수 |
| 52-6 | §결정, fail-closed 항목 | 타임아웃 없음 | Coordinator 요청 타임아웃을 정한다. 없으면 자식이 `begin` 응답을 무한 대기하며 서버 코드가 멈춘다 | 필수 |
| 52-7 | §결정(신설) | 없음 | **손자 프로세스 방침.** `NODE_OPTIONS` 는 MCP 서버가 spawn 하는 Node 프로세스에도 상속되어 훅이 거기도 설치된다. 조용히 비활성화할지 경고할지 정한다 | 필수 |
| 52-8 | §결정, Session Store 문단 | 저장 위치 없음 | **세션 저장 경로 규약**을 정한다(구상 문서는 `.mcp-test/sessions.db`, 개명 후 이름 재검토 — A-6-2). `.gitignore` 항목도 함께 | 보완 |
| 52-9 | §결과 | 없음 | 부모가 세션을 소유하므로 **세션 목록·삭제·정리 명령이 필요**하다는 후속을 적는다(구상 문서의 `/clear`, A-6-3) | 보완 |
| 52-10 | §결과 | 없음 | `--determinism` 처럼 **한 실행이 두 번 connect 하는 경로**와의 관계를 적는다(권장: 1차 조합 금지) | 보완 |

#### `0053-http-외부-요청-매칭과-반복-호출-정책.md` (7건)

| # | 위치 | 지금 | 고칠 내용 | 등급 |
|---|---|---|---|---|
| 53-1 | §결정, 요청 매칭 값 | "`HttpBody` 는 어댑터 확장 설계의 tagged union", canonical 규칙은 "같은 문서의 5.1.1" | 참조 문서가 삭제됐다. **union 정의와 canonical 규칙을 본문에 인라인**한다. 현재 `stableStringify` 동작을 그대로 서술하면 새로 정할 것이 없다 | 필수 |
| 53-2 | §결정, 민감 키 문단 | "판정은 `normalizeKey` 가 …" | **그런 함수는 없다.** `keyWords`+`sensitiveKey`(접미 단어열 일치, 복수형 흡수)로 정정 | 필수 |
| 53-3 | §이유, 미사용 interaction 문단 | "**상위 설계가** 녹화와 다른 테스트 명세의 Replay 를 허용하기 때문이다" | 역시 삭제된 문서 참조다. 근거를 문장 안에서 직접 진술한다 | 필수 |
| 53-4 | §결정, 저장과 복원 | "관찰 가능한 `url` 도 복원해야 한다" | 방법이 없다. 순진한 구현은 조용히 `""` 를 준다(0-A). **복원 수단과 실패 시 지원 오류**를 적는다 | 필수 |
| 53-5 | §결정, response 저장 항목 | status·statusText·headers·최종 URL·body | **호출 시각을 메타데이터로 추가**한다. 구상 문서의 "언제 호출되었는지"(A-6-1). **matchKey 입력에는 넣지 않는다** — 넣으면 전부 miss 가 되고 결정론성이 깨진다 | 보완 |
| 53-6 | §결정, 마스킹 시점 문단 | ADR-0041 과의 관계 없음 | external 은 **자식 안에서 matchKey 계산 전** 마스킹이라 0041 의 적용 지점과 다름을 명시 | 보완 |
| 53-7 | §결과 | 없음 | **"이 도구는 외부 API 자체의 드리프트를 감지하지 않는다"** 를 비목표로 명시하거나, 감지 수단을 후속으로 예약한다(A-2-8) | 보완 |

#### 새로 쓸 ADR (1건)

| 주제 | 담당 | 내용 |
|---|---|---|
| Node.js 최소 지원 버전 22.13.0 상향 | 릴리스 / 전체 | #228 을 근거로. 배포 패키지 `engines` 신설, CI 매트릭스, 문서. `node:sqlite` 의 `ExperimentalWarning` 을 억제할지도 여기서 함께 정한다(0-A) |

**합계: 기존 ADR 17건 수정 + 신규 1건.** 이 중 **필수 12건**이 채택 전 관문이다.

---

## 단계 B — 인메모리 최소 수직 기능

**핵심 성질: B 는 `packages/record` 안에서 끝난다.** cli·core·dashboard·examples·CI 를 건드리지
않는다. 소유권 규칙(CLAUDE.md, CONTRIBUTING §2.2)과 "한 번에 한 패키지" 를 그대로 지킨다.

검증할 경로:

```text
부모(vitest 프로세스)
  Coordinator(127.0.0.1:0, bearer) ── Engine ── MemorySessionStore
        ↕ loopback HTTP JSON
자식(node 로 spawn 한 최소 MCP 서버)
  Bootstrap(--import) → fetch adapter → 실제 외부 호출(Record) / 저장 결과 복원(Replay)
```

### B-0. shared 추출 — **한다** (ADR-0053 개정판 `f4c0935` 기준)

이 자리에는 한때 "추출하지 않고 external 이 복사해 간다" 는 판단이 있었다. 근거는 "목록은
version 에 묶인 데이터라 `shared` 의 정의(경계에 종속되지 않는 순수 함수)에 안 맞는다" 였다.
**채택된 ADR-0053 이 그 반론을 해소했다** — `shared` 가 살아 있는 목록 하나를 주는 것이 아니라
**version 별 스냅샷 집합**을 준다. 그러면 legacy 는 최신을 쓰고 external 은 자기 version 스냅샷을
쓰며, 목록 추가는 기존 스냅샷을 건드리지 않으므로 **양쪽 version 동반 상향도 필요 없다.**

따라서 `shared` 가 제공할 것은 다음 셋이다.

| 대상 | 성격 | 소비자 |
|---|---|---|
| stable JSON 직렬화 | 순수 알고리즘 | legacy · external |
| 민감 키 판정(접미 단어열 일치·복수형 흡수) | 순수 알고리즘 | legacy · external |
| 민감 키 목록 | **version 별 불변 스냅샷** | legacy 는 최신, external 은 자기 interaction version |

stable JSON 알고리즘만은 여전히 공유 결합이 남는다. 바꾸려면 legacy 카세트와 external
interaction version 을 함께 검토해야 한다(ADR-0053 §canonical 규칙에 그렇게 적혀 있다).

### B-0'. 민감 키 목록은 protocol schema version 에 묶는다

`shared` 를 쓰든 복사하든 **이 결정은 독립적으로 필요하다.** legacy 와 무관하게 external 자신의
문제이기 때문이다.

- external 은 마스킹을 **matchKey 계산 전**에 한다(ADR-0053). 즉 목록이 키의 입력이다.
- 따라서 목록에 단어 하나를 더하면 **이미 녹화된 external 세션의 matchKey 가 전부 바뀐다.**
- legacy 는 이 문제가 없다. `packages/record/src/index.ts:662` 가 **원문 args** 로 키를 만들고
  마스킹은 저장 직전에만 걸리기 때문이다. ADR-0045 가 목록을 6개 늘렸어도 기존 카세트가 하나도
  깨지지 않은 이유가 이것이다.

선택지와 판정:

| | 보안 수정 반영 | 기존 세션 | 판정 |
|---|---|---|---|
| 살아 있는 목록을 그대로 사용 | 즉시 | **전부 무효화** | 불가 |
| v1 스냅샷 영구 고정 | **영영 안 감** | 안전 | 불가 — ADR-0045 가 메운 것 같은 구멍이 external 에 영구히 남는다 |
| 매칭에서 마스킹 제거(원문 해시) | 무관 | 안전 | 보류 — false hit 는 사라지지만 토큰 교체·환경 차이에서 전부 miss 가 되어 "로컬 녹화 → CI 재생" 이 깨진다 |
| **목록을 version 으로 관리** | 다음 릴리스 | 안전 | **채택 권고** |

채택 시 따라오는 것: Replay 에서 Adapter 는 **source session 의 version 규칙으로** 정규화해야
한다. 그 version 을 자식이 알아야 하므로 **핸드셰이크에 실어야 하고**, 이것은 52-5(schema version
전달 시점)와 같은 결정이다. 두 항목을 함께 정한다.

#### 목록을 **두 곳에 다르게** 적용한다

version 하나로 매칭과 노출을 동시에 맞추려 하면 요구가 충돌한다. 매칭은 **안정**을 원하고
(바뀌면 세션이 죽는다) 노출 차단은 **최신**을 원한다(늦으면 비밀값이 샌다). 그래서 적용 지점을
나눈다.

| 적용 지점 | 쓰는 목록 | 이유 |
|---|---|---|
| matchKey 계산 | **source session 의 version** | 키가 흔들리면 녹화된 세션이 통째로 무효가 된다 |
| 값이 프로세스 밖으로 나가는 경계 (CLI 출력·진단·리포트·번들·dashboard 응답) | **항상 최신** | 뒤늦게 발견한 비밀값 모양이 오래된 세션에서 새는 것을 막는다 |

Record 시점에는 두 목록이 같으므로 분기가 없다. 갈라지는 것은 **오래된 세션을 새 버전으로
Replay·조회할 때**뿐이다. 그때 저장본에는 v1 이 못 알아본 값이 평문으로 들어 있는데, 노출
경계에서 최신 목록을 적용하면 그 값이 화면·리포트·API 로 나가지 않는다.

이 분리에는 두 가지 부수 효과가 있다.

- **ADR-0041 이 external 에서도 그대로 산다.** 0041 의 "값이 프로세스 밖으로 나가는 경계에서
  마스킹한다" 는 노출 쪽 규칙으로 유지되고, ADR-0053 의 "matchKey 계산 전 마스킹" 은 매칭을 위한
  **추가** 적용이 된다. 0053 의 현재 문구는 "경계가 아니라 정규화 직후로 당겨진다" 로 되어 있어
  0041 을 대체하는 것처럼 읽힌다. **두 번 적용한다** 로 고쳐야 한다.
- **저장본의 평문은 영구 손상이 아니다.** matchKey 는 저장돼 있고 저장값에서 다시 계산하지
  않으므로, 오래된 세션의 저장값을 최신 목록으로 **다시 마스킹해도 키가 깨지지 않는다.** 세션
  관리 명령(52-9 · A-6-3)에 재마스킹 경로를 둘 수 있다.

한계도 적어 둔다. 노출 경계의 최신 마스킹은 **앞으로 나갈 출력**만 막는다. 이미 찍힌 CI 로그나
이전에 내보낸 리포트에 들어간 값은 되돌리지 못한다.

### B-1. 파일 단위 계획

부모 측(TypeScript):

| 파일 | 책임 | 넣지 않을 것 |
|---|---|---|
| `src/external/protocol.ts` | 내부 HTTP JSON 계약 타입, `PROTOCOL_SCHEMA_VERSION = 1`, payload 상한 상수 | HTTP 서버 코드 |
| `src/external/errors.ts` | `ReplayMissError`, 인증 실패, 미지원(body 종류·redirect), 손상(incomplete), 동시 동일 키, 상한 초과 | 렌더링 이상의 로직 |
| `src/external/http-match.ts` | `HttpMatchV1` 정규화(method 대문자, scheme·host 소문자, 기본 포트·fragment 제거, query 순서 보존, 헤더 allowlist 4종, JSON body 키 정렬) + 민감 값 마스킹 + SHA-256 matchKey | 네트워크 호출 |
| `src/external/session-store.ts` | `SessionStore` 인터페이스 + `createMemorySessionStore()`. 세션 상태 `running`/`completed`/`failed`, interaction `incomplete`/`complete` | SQLite |
| `src/external/engine.ts` | `begin`/`complete`/`lookup` 상태 기계. occurrence·ordinal 부여, 동시 동일 키 거부, miss 판정, 미사용 interaction 요약 | HTTP·저장 구현 |
| `src/external/coordinator.ts` | `node:http` 서버(127.0.0.1:0), bearer 검증(`timingSafeEqual`), 크기 상한, schema version 검증, engine 배선, `start()`/`close()` | 매칭 규칙 |
| `src/external/index.ts` | external 내부 진입점. **legacy 타입을 재export 하지 않는다** | — |

자식 측(`.mjs`, A-2-2 결론에 따름):

| 파일 | 책임 |
|---|---|
| `src/external/child/bootstrap.mjs` | `--import` 대상. env 설정 읽기·검증 → 즉시 env 스크럽 → adapter 설치. 실패는 stderr + 종료(stdout 금지) |
| `src/external/child/coordinator-client.mjs` | `begin`/`complete`/`lookup` 호출. 타임아웃·상한·fail-closed |
| `src/external/child/fetch-adapter.mjs` | `globalThis.fetch` 래핑. 정규화·마스킹 → 모드별 분기 → `Response` 복원(`url` 은 `defineProperty`) |

정규화·마스킹 규칙은 **부모와 자식이 같은 것을 써야 한다.** 자식에서 재구현하지 않는다 —
규칙 모듈을 자식도 런타임에 로드할 수 있는 형태로 두는 것이 B 의 설계 숙제이며, A-2-2 에서
자식 소스 형식을 정하면 자동으로 결정된다.

테스트:

| 파일 | 갈래 | 단언 |
|---|---|---|
| `tests/external/http-match.test.ts` | unit | query 순서, 헤더 allowlist, JSON 키 순서, 민감 query·body 값, 비JSON body 거부, 1 MiB 상한 |
| `tests/external/engine-memory.test.ts` | unit | occurrence 0부터 순서 소비, miss, incomplete 세션은 원본 불가, 동일 키 동시 begin 거부, 미사용 interaction 경고 |
| `tests/external/coordinator-auth.test.ts` | unit | 401/403, 오류 body 에 token 흔적 없음, 크기 상한, 알 수 없는 schema version |
| `tests/external/vertical-e2e.test.ts` | **e2e** | Record 1회 → Replay 시 origin **호출 0회**, miss 실패, Bootstrap 주입 실패 진단, 자식 종료 후 세션 상태 |
| `tests/fixtures/external/echo-origin.mjs` | — | 테스트용 외부 HTTP origin. 호출 횟수를 센다 |
| `tests/fixtures/external/fetch-mcp-server.mjs` | — | `fetch` 를 호출하는 최소 MCP stdio 서버 |

파일명 규약: 자식 프로세스를 띄우는 스펙은 **반드시 `*-e2e.test.ts`** (0-9).

### B-2. 완료 기준

1. Record 세션 1회 후 **origin 호출 카운터가 늘지 않은 채** Replay 가 같은 응답을 준다.
2. Replay miss 가 네트워크로 새지 않고 실패한다(카운터로 증명).
3. token 없이/틀린 token 으로 부른 요청이 401/403 이고 body 에 token 흔적이 없다.
4. `begin` 후 자식을 강제 종료하면 세션이 `failed`, interaction 이 incomplete 이고, 그 세션을
   원본으로 Replay 하면 손상으로 거부된다.
5. 같은 matchKey 동시 호출이 실제 호출 전에 오류다.
6. 복원된 `Response` 의 `status`·headers·body·**`url`** 이 원본과 같다.
7. Node 20/22/24 전부에서 `pnpm test` 통과(자식 진입점 형식 결정의 검증).

### B-3. B 에서 하지 않는 것

SQLite, 파일 포맷, CLI 옵션·도움말, dashboard, `verify` 계열 명령, legacy 코드 수정,
`tsconfig.base.json`·`vitest.config.ts`·`package.json` exports 변경(테스트는 상대 경로 import).

---

## 단계 C — SQLite 영속화와 CLI 확장

### C-0. Node 런타임 상향 (별도 PR, 별도 오너) — **영속화의 선행이 아니다**

먼저 범위를 정확히 해 둔다. **Node 버전이 막는 것은 "저장" 이 아니라 "SQLite 로 저장" 하나뿐이다.**

- 단계 B 는 인메모리 Store 라 Node 버전과 무관하다.
- legacy 카세트는 이미 JSON 파일로 저장하고 있고 **Node 20 CI 에서 초록**이다
  (`packages/record/src/index.ts` 의 `saveCassette`, `verify` 매트릭스).
- 즉 "버전이 안 올라가면 응답을 저장할 수 없다" 는 성립하지 않는다. 성립하는 것은
  "버전이 안 올라가면 `node:sqlite` 를 쓸 수 없다" 이며, 그 대안이 C-1 에 있다.

상향 자체의 근거는 이미 저장소 안에 다 있다. 통과 가능성이 낮은 제안이 아니다.

- Node 20 은 2026-04-30 EOL (ci.yml build 잡 주석).
- 번들러 tsdown 0.22 가 `engines.node: "^22.18.0 || >=24.11.0"` 라 **build 잡은 이미 Node 22 고정**이다.
- pnpm 11 도 같은 이유로 22.13+ 를 요구한다.
- 즉 저장소는 이미 절반쯤 Node 20 을 떠나 있고, 남은 것은 `verify` 매트릭스와 사용자 약속뿐이다.

바꿔야 할 파일은 다음과 같다.

| 파일 | 변경 |
|---|---|
| `.github/workflows/ci.yml` | `verify` 매트릭스에서 20 제거 |
| `package.json` (루트) | `engines.node` 상향 |
| `packages/*/package.json` (배포 6종) | **`engines` 필드 신설**(현재 없음, 0-6) |
| `CONTRIBUTING.md` §6 | 매트릭스 행 수정 |
| `README.md` | 요구 런타임 |
| `.changeset/*` | breaking 표시 |

이 PR 은 **여러 오너의 패키지를 동시에 건드린다.** 팀 합의 + 별도 ADR(A-1-3) 없이 열지 않는다.

### C-1. 영속 Store — Node 상향과 **의존을 끊는다**

`SessionStore` 인터페이스(B-1)가 이 단계의 유일한 계약이다. 구현은 갈아 끼울 수 있다.

| 파일 | 변경 |
|---|---|
| `tests/external/session-store-contract.test.ts` | **먼저 쓴다.** 메모리·파일·SQLite 어느 구현에도 같은 스펙을 돌린다 |
| `src/external/session-store-file.ts` | 신규(C-1a). append-only JSONL. Node 20 포함 전 매트릭스에서 동작 |
| `src/external/session-store-sqlite.ts` | 신규(C-1b). `node:sqlite`. Node 상향이 통과한 뒤 |
| DDL(별도 모듈 또는 인라인) | C-1b 와 함께. **HTTP 전용 필드를 공통 칼럼으로 올리지 않는다**(ADR-0052). protocol 별 payload 는 불투명 JSON 칼럼 |

**단, 구상 문서는 SQLite 를 명시했다**(A-6). 따라서 기본 경로는 **SQLite 직행**이고, 파일
구현은 **Node 상향(#228)이 막혔을 때의 보험**이다. #228 이 통과하면 C-1a 를 건너뛰고 C-1b 로
간다. 계약 테스트를 먼저 쓰는 것만은 어느 쪽이든 동일하다.

**보험이 필요한 이유.** H1·H2 의 질의 패턴은 append 와
`(sourceSessionId, protocol, matchKey, occurrence)` 조회뿐이다(ADR-0053). 작성자도 부모 하나다.
SQL 이 필요한 지점 — 세션 간 교차 조회, 대량 세션 목록 — 은 dashboard 연동(D 이후)에서 처음
생긴다. 즉 SQLite 는 **나중에 필요한 것**이고, 그것 때문에 팀 결정(C-0)이 P7 이후 전부를
막는 구조가 오히려 비싸다.

**대가.** 세션 파일 포맷이 사용자 눈에 보이게 된다. 완화책은 H1 에서 세션 디렉터리를
**내부 산출물(포맷 미보장)** 로 명시하고 CHANGELOG 에 그대로 적는 것이다. legacy 카세트와
schema version·타입 이름·저장 위치를 공유하지 않는다는 ADR-0051 제약은 어느 구현이든 동일하다.

**Node 22 를 최소 버전으로 잡을 때의 부수 효과.** 22.13 에서 `node:sqlite` 는 매 실행
`ExperimentalWarning` 을 stderr 에 찍는다(0-A). 실패 메시지가 곧 제품인 프로젝트에서 이 줄은
영구 노이즈다. 억제하려면 `process.removeAllListeners("warning")` 후 자체 필터를 걸어야 하고,
그 자체가 "우리가 남의 경고를 지운다" 는 결정이라 ADR 에 한 줄 남길 값이다. Node 24 에서는
경고가 없다.

물리 스키마·마이그레이션 정책은 C-1b 에서 처음 결정된다(A-2-7). 결정하면 ADR 을 하나 더
쓰거나 0052 에 후속 절을 붙인다.

### C-2. CLI 배선

| 파일 | 변경 | 주의 |
|---|---|---|
| `packages/cli/src/test-command.ts:90` | `connect` 주입 시그니처에 `env` 추가 | 호출부 `:624`, `:800` 동시 수정 |
| `packages/cli/src/test-command.ts:800` | 2회차 connect | A-2-4 결론 반영(권장: External + `--determinism` 조합 거부) |
| `packages/cli/src/external-wiring.ts` (신규) | Coordinator 수명주기(먼저 열고 마지막에 닫기), Bootstrap env 조립(`pathToFileURL().href`, 호출자 `env.NODE_OPTIONS` 와 병합) | **`cassette-wiring.ts` 를 재사용하지 않는다**(ADR-0051) |
| `packages/cli/src/index.ts` | `test` 분기에서 external 배선 주입 | `COMMANDS` 의 죽은 `"record"` 항목(0-11)은 이 PR 에서 건드리지 않는다 |
| `packages/cli/src/help.ts` | 옵션 도움말 | 옵션 이름은 여기서 처음 확정 |
| 세션 관리 명령(신규) | 목록·삭제·정리 (A-6-3). 구상 문서의 `/clear` 에 대응 | 별도 PR. `test` 배선과 섞지 않는다 |
| `packages/cli/tests/*-e2e.test.ts` | dist CLI 로 Record→Replay | `packages/cli/tests/dist-cli-e2e.mjs` 와 별개 |

**cli 는 공동 소유지만 "한 PR 에서 여러 오너 영역을 건드리지 않는다"(CONTRIBUTING §2.2).**
C-2 는 `test` 서브커맨드만 만진다.

### C-3. 패키징 (external 을 밖으로 낼 때만)

`@mcpeak/record/external` subpath 를 열려면 **4곳을 한 PR 에서** 고쳐야 한다(0-8):
`packages/record/package.json` exports / `packages/record/tsdown.config.mjs` entry /
`tsconfig.base.json` paths / `vitest.config.ts` alias. 하나라도 빠지면 "타입체크 초록, 테스트
빨강" 또는 그 반대가 난다(각 파일 주석이 그 사고를 기록하고 있다).
Bootstrap `.mjs` 는 번들 대상이 아니라 **그대로 dist 에 실려야** 하고, CLI 는 그 경로를
`import.meta.resolve` 로 찾아 `pathToFileURL` 로 넘긴다.

---

## 단계 D — 기존 Tool Cassette legacy 정리

**B·C 가 끝나고 실제 사용자 흐름이 검증되기 전에는 시작하지 않는다**(ADR-0051).

1. D-1: legacy 유지/개명/제거 판단을 ADR 로 남긴다(0051 이 "별도 마이그레이션 단계" 로 예약).
2. D-2: 제거로 결정되면 `replay`·`verify`·`generate --cassette`·`cassette-wiring.ts`·
   dashboard 카세트 화면을 **각각 별도 PR** 로 걷어낸다.
3. D-3: 0.x breaking + changeset + 마이그레이션 안내.
4. **External 기능 추가와 legacy 삭제를 같은 PR 에 섞지 않는다.**

---

## PR 분할 (CONTRIBUTING §5-4, 400줄 상한)

| # | 내용 | 범위 | 선행 |
|---|---|---|---|
| P0 | ADR-0051~0053 수정(A-1) + 채택 | `docs/adr/**` | — |
| P0b | Node 런타임 ADR | `docs/adr/**` | — |
| P1 | shared 추출(B-0) — 알고리즘 2종 + version 별 목록 스냅샷 | `packages/record` | P0 |
| P2 | ~~protocol·errors·http-match + unit~~ — **선반영 완료**(`src/external/`, 테스트 15개 통과) | `packages/record` | — |
| P2b | 개정 ADR 과 코드의 격차 5건(§C-4) | `packages/record` | P0, P1 |
| P3 | engine + memory store + unit | `packages/record` | P2 |
| P4 | coordinator + 인증 unit | `packages/record` | P3 |
| P5 | bootstrap·client·fetch adapter + **vertical e2e** | `packages/record` | P4 |
| P6 | Node 매트릭스 상향 | 저장소 전역 | P0b, 팀 합의 |
| P7a | Store 계약 테스트 + **파일(JSONL) store** | `packages/record` | P5 |
| P7b | SQLite store (같은 계약 테스트 재사용) | `packages/record` | P7a, **P6** |
| P8 | subpath export 4곳 | `packages/record` + 루트 설정 2개 | P7a |
| P9 | CLI 배선 + 도움말 | `packages/cli` (`test` 만) | P8 |
| P10~ | dashboard, legacy 정리 | 후속 | P9 |

**P6 은 P7b 하나만 막는다.** P7a → P8 → P9 는 Node 상향과 무관하게 굴러간다. 이 분리가
C-1 의 요점이다. P1~P5·P7·P8 은 `record` 오너 단독, P6 만 팀 결정, P9 는 cli 공동 영역.

---

## 미결정 질문 (사용자 확인 필요)

1. A-1-3 대로 **Node 상향을 0052 에서 떼어 별도 ADR** 로 갈 것인가? (0052 채택 속도가 팀 합의에
   묶이지 않게 하는 목적)
2. A-2-2 자식 진입점 형식: `.mjs`(권장) vs TS + 빌드 선행?
3. A-2-4 `--determinism` × External: 1차에서 **조합 금지**(권장)인가?
4. A-4-3 손자 Node 프로세스에 훅이 상속되는 문제: **조용히 비활성화**(권장) vs 명시적 경고?
5. B 산출물의 공개 범위 — B 는 subpath export 없이 내부 모듈로만 두는 것을 권한다(공개 API 를
   검증 전에 고정하지 않기 위해).
6. **첫 영속 구현을 JSONL 파일로 갈 것인가(권장), SQLite 를 기다릴 것인가?** 전자는 Node 상향
   합의와 무관하게 P7a~P9 를 진행시키고, 후자는 팀 결정이 날 때까지 CLI 배선까지 멈춘다.
7. Node 22 를 최소 버전으로 잡는다면 `node:sqlite` 의 `ExperimentalWarning` 을 억제할 것인가?
   (억제는 "남의 경고를 지운다" 는 결정이라 ADR 한 줄이 필요하다)
