# CLI

이 문서는 `mcpeak` 의 모든 명령을 플래그와 기본값까지 정리한다. 처음부터 끝까지 한 번
돌려보려면 [빠른 시작](/ko/quick-start)을 본다.

```
mcpeak <명령> [옵션]
mcpeak help [명령]
```

`mcpeak --help`, `-h`, `help` 는 전체 도움말을, 인자 없이 실행해도 같은 도움말을 stdout 에
쓰고 종료 코드 0 을 낸다. `mcpeak help test` 와 `mcpeak test --help` 는 같다. `--version` 은
버전을 찍는다.

## 서버를 지정하는 세 가지 방법

`test` 와 `generate` 가 같은 방법을 받는다. 셋 중 하나만 쓴다.

| 형태 | 뜻 |
|---|---|
| `-- <executable> [args...]` | `--` 뒤 전부가 서버를 띄울 명령. 첫 토큰이 실행 파일, 나머지가 인자. 그 뒤는 해석하지 않는다 |
| `--command <executable> [--arg <value> ...]` | 같은 일을 플래그로. `--arg` 는 반복하고, 하이픈으로 시작하는 값은 `--arg=-m`, 빈 값은 `--arg=` 로 |
| `--url <URL>` | 이미 떠 있는 Streamable HTTP 서버에 붙는다. 띄울 프로세스가 없으므로 stdio 전용 옵션은 받지 않는다 |

stdio 에는 `--env <NAME>` 을, HTTP 에는 `--header-env <헤더>=<환경변수>` 를 붙일 수 있다.

| 옵션 | 뜻 |
|---|---|
| `--env <NAME>` | 부모 환경변수 NAME 을 서버 프로세스에 넘긴다. 반복할 수 있다. SDK 는 `HOME` · `PATH` 등 고정 목록만 자식에게 주므로 API 키처럼 서버가 환경에서 읽는 값은 이름을 지정해야 간다. `NODE_OPTIONS` 와 `MCPEAK_` 로 시작하는 이름은 녹화·재생 배선이 쓰므로 받지 않는다 |
| `--header-env <헤더>=<환경변수>` | 요청 헤더를 환경변수에서 읽어 붙인다 |

둘 다 값을 직접 받지 않는다. 명령줄에 쓴 토큰은 `ps` 목록과 셸 히스토리에 남기 때문이다. 값을
넣을 때도 히스토리에 남기지 않는다.

```bash
read -rs MCP_TOKEN; export MCP_TOKEN
mcpeak test suite.json --url http://127.0.0.1:3000/mcp --header-env Authorization=MCP_TOKEN
```

## test

```
mcpeak test <suite.json> <서버 지정>
            [--determinism] [--reset-cmd <command>]
            [--json] [--junit <path>] [--repair-bundle <path>] [--stderr-lines <N>]
            [--session <path> | --record-session <path>]
```

JSON 명세로 서버를 띄워 검증한다. 모든 케이스가 통과하면 0, 실패·타임아웃·중단이 있거나 입력·
연결·종료 오류가 나면 1 을 낸다. stdout 에는 보고서만 나가고 CLI 오류와 서버 진단은 stderr 로
나간다.

| 옵션 | 기본값 | 뜻 |
|---|---|---|
| `--determinism` | 끔 | 스위트를 2회 실행해 결과를 비교한다. 비차단 진단이라 차이를 찾아도 종료 코드는 그대로다. [결정론성 확인](/ko/guide/determinism) |
| `--reset-cmd <command>` | 없음 | 각 실행 전에 이 명령을 한 번 실행한다. 셸을 거치지 않으므로 파이프나 `&&` 는 쓸 수 없다 |
| `--json` | 끔 | stdout 을 사람용 보고서 대신 `RunnerReport` JSON 으로 |
| `--junit <path>` | 없음 | JUnit XML 을 그 경로에 쓴다. 쓰지 못하면 전부 통과했어도 `JUNIT_WRITE_FAILED` 로 1 |
| `--repair-bundle <path>` | 없음 | 실패한 케이스만 모은 번들을 쓴다. [Repair](/ko/guide/repair) |
| `--stderr-lines <N>` | `20` | 실패 시 stderr 에 붙는 서버 진단 블록의 줄 수. `0` 이면 블록을 끈다 |
| `--record-session <path>` | 없음 | 서버가 `globalThis.fetch` 로 밖에 부른 HTTP 를 녹화한다 |
| `--session <path>` | 없음 | 녹화한 외부 호출을 재생한다 |

두 세션 옵션은 서로, 그리고 `--determinism` 과 함께 쓸 수 없다. 범위와 저장 내용은
[External 세션](/ko/guide/external-sessions)에 있다.

보고서 끝의 지문 줄은 `generate` 로 승인한 명세와 지금 파일이 같은지 말한다. 판정은 바꾸지
않는다. `--json` 에서는 `spec` 키로 항상 나간다.

## generate

```
mcpeak generate --out <suite.json> <서버 지정>
                [--suite-id <id>] [--name <name>]
                [--baseline-only] [--provider <codex|claude>] [--model <model>]
                [--no-dry-run] [--reset-cmd <command>] [--fixtures <path>]
                [--no-repair] [--diagnose-rejections] [--force]
```

서버의 툴 스키마에서 명세를 만든다. 흐름은 [명세 생성](/ko/guide/generate)에 있다.

| 옵션 | 기본값 | 뜻 |
|---|---|---|
| `--out <suite.json>` | 필수 | 저장 경로. 파일명이 승인 지문에 들어간다 |
| `--suite-id <id>` | 파일명에서 | `contract.suite.json` 이면 `contract` |
| `--name <name>` | `--suite-id` 와 같음 | 보고서 첫 줄에 찍히는 이름 |
| `--baseline-only` | 끔 | AI 를 부르지 않는 비대화형 승인. 시험 실행도 하지 않는다 |
| `--provider <codex\|claude>` | TTY 에서 선택 | AI 검토에 쓸 CLI |
| `--model <model>` | TTY 에서 선택 | provider 에 넘길 모델 |
| `--no-dry-run` | 끔 | 승인 전 시험 실행을 건너뛴다. 실행이 필요한 AI 사전보완도 건너뛴다 |
| `--reset-cmd <command>` | 없음 | 시험 실행 전에 한 번 실행한다 |
| `--fixtures <path>` | `mcpeak.fixtures.json` | 실재하는 자원을 가리키는 값을 도구·필드별로 적은 JSON. 없으면 그냥 진행한다 |
| `--no-repair` | 끔 | 시험 실행이 실패해도 입력값을 고쳐 다시 시도하지 않는다 |
| `--diagnose-rejections` | 끔 | 통과한 거절 케이스의 응답을 나열하고 provider 가 있으면 참고 의견을 묻는다 |
| `--force` | 끔 | `--out` 경로에 파일이 있으면 지우고 새로 쓴다. 기본은 저장을 멈춘다 |

## repair

```
mcpeak repair <bundle.json> --provider <codex|claude> --model <model>
              [--max-cases <N>] [--no-stderr] [--yes]
```

`test --repair-bundle` 이 만든 번들로 서버 코드의 원인 후보를 제안받는다. 흐름은
[Repair](/ko/guide/repair)에 있다.

| 옵션 | 기본값 | 뜻 |
|---|---|---|
| `--provider <id>` | 필수 | `codex` 또는 `claude` |
| `--model <model>` | 필수 | provider 에 넘길 모델 식별자 |
| `--max-cases <N>` | 전부 | 한 번에 보낼 실패 개수 상한. 넘으면 앞에서부터 남긴다 |
| `--no-stderr` | 끔 | 서버 stderr 를 전송에서 뺀다 |
| `--yes` | 끔 | 전송 확인 화면을 건너뛴다 |

## 별도 실행 파일

| 명령 | 패키지 | 뜻 |
|---|---|---|
| `mcpeak-mock <definition.json>` | `@mcpeak/mock` | 정의 파일로 stdio 목 서버를 띄운다. [목 서버](/ko/guide/mock-server) |
| `mcpeak-dashboard [--port <번호>]` | `@mcpeak/dashboard` | 로컬 웹 UI. 기본 포트 7357, `0` 이면 자동. [대시보드](/ko/guide/dashboard) |

전역 설치는 그 패키지의 실행 파일만 놓으므로 셋을 각각 설치한다.

## 오류 코드

실행 자체가 실패하면 stderr 에 `오류 [<코드>]: <메시지>` 와 `해결:` 줄이 나간다. 연결 오류는
`MCP_CONNECTION_FAILED/<세부 코드>` 형태다.

| 세부 코드 | 뜻 |
|---|---|
| `PROCESS_START_FAILED` | 서버 프로세스를 시작하지 못했다. command 와 cwd 를 확인한다 |
| `HANDSHAKE_TIMEOUT` · `HANDSHAKE_FAILED` | 프로세스는 떴지만 MCP handshake 가 끝나지 않았다 |
| `PROCESS_EXITED` | handshake 전이나 실행 중에 서버가 종료됐다. 진단 블록에 종료 코드와 stderr 가 붙는다 |
| `HTTP_CONNECT_FAILED` · `HTTP_UNAUTHORIZED` · `HTTP_STATUS_ERROR` | `--url` 대상에 붙지 못했다 |
| `HTTP_SESSION_LOST` | 실행 중에 HTTP 세션이 사라졌다 |

명세 파일이 잘못됐을 때의 코드는 [명세 형식](/ko/reference/suite-spec#검증-오류)에 있다.

## 지원 범위

UTF-8 JSON 단일 명세와 stdio · Streamable HTTP 서버를 지원한다. 셸 문법, 여러 명세, TypeScript
모듈 명세는 받지 않는다. Windows 에서는 `.cmd` 와 `.bat` 을 command 로 받지 않는다. 운영체제가
직접 실행할 수 있는 실행 파일을 주고 스크립트 경로는 인자로 넘긴다.
