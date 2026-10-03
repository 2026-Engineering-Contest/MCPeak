# @mcpeak/audit

MCP 서버를 쓰기 전에 도구 정의·실행 명령·프로토콜 응답을 읽고 보안 위험을 점검한다. CLI 에서는
`mcpeak audit` 로 쓴다.

```
mcpeak audit -- node ./server.mjs
mcpeak audit --command npx --arg -y --arg some-mcp-server@1.2.3 --env GITHUB_TOKEN
mcpeak audit --url https://mcp.example.com/mcp --header-env Authorization=MCP_TOKEN
mcpeak audit --baseline ./server.audit.json -- node ./server.mjs   # 도구 정의 변경 추적
mcpeak audit --json -- node ./server.mjs                           # 결과 JSON
```

종료 코드는 심각·주의 발견이 있으면 2, 없으면 0, 연결·입력 실패는 1 이다. 권한 조합 경고(`flow`)와
정보 발견은 종료 코드에 넣지 않는다.

## 무엇을 보나

| 가족 | 보는 것 |
|---|---|
| `desc` | 도구·프롬프트·리소스·instructions 의 모든 문자열과 스키마 키 이름. 모델 지시, 숨은 부차 동작, 자동 실행 트리거, 다른 도구 섀도잉, 무관한 서비스 언급, 민감 경로, 보이지 않는 문자, ANSI 이스케이프, 인코딩된 긴 문자열, 스키마 표준 밖 필드 |
| `schema` | 비밀값 인자, 대화를 실어 보낼 수 있는 자유 문자열 필드, readOnlyHint 와 이름의 불일치, 파괴적 이름의 destructiveHint 누락, 제약 없는 명령·경로·URL 인자 |
| `flow` | 외부 입력 읽기·비공개 데이터 접근·외부 쓰기가 한 서버에 모두 있는 조합(경고) |
| `launch` | 실행 명령의 인라인 코드, 원격 스크립트를 셸로 넘기기, 버전 미고정 패키지, 원격 주소 실행, 실제 env 전달 |
| `protocol` | HTTP 평문, 무인증 수락, Origin 미검사, OAuth 메타데이터의 안전하지 않은 엔드포인트, URL 의 세션 식별자, 서버 발신 요청과 그 안의 지시, 감사 중 도구 목록 변경 |
| `secret` | 카나리 env 의 유출, 전달한 실제 값의 반향, 설명의 비밀 이름 언급 |
| `result` | 호출 응답의 모델 지시·보이지 않는 문자·ANSI·과대 크기·무응답 |
| `surface` | `--baseline` 기준 파일과 지금 도구 정의의 차이 |

규칙 하나하나의 조건과 문장은 `docs/plans/2026-10-03-audit-핵심-검사-구현계획.md` §3·§6 이 정본이다.

## 설계에서 정한 것

- **판정은 이 컴퓨터 안에서만 한다.** 규칙은 정규식·코드포인트 표·스키마 검사·해시이고 도구 정의를
  밖으로 보내지 않는다. 같은 입력이면 `--json` 출력이 바이트까지 같다(ADR-0104).
- **도구 호출은 기본이 읽기 전용이다.** `--probe readonly` 는 readOnlyHint 가 true 인 도구만 부른다.
  `all` 은 상태를 바꾸는 도구도 부르므로 버려도 되는 환경에서만 쓴다(ADR-0105).
- **서버에 진짜 비밀을 주지 않는다.** stdio 서버를 띄울 때 흔한 비밀 이름에 카나리 값을 넣고, 응답에
  그 값이 나오면 유출로 본다. `--env` 로 명시한 이름만 실제 값을 넘긴다. 어느 값도 출력에 쓰지 않는다.

## 한계

설명문의 문형과 프로토콜 표면만 본다. 바꿔 말한 지시와 서버 코드의 실제 행위는 보지 못하므로 발견 0 이
안전하다는 뜻은 아니다. 공개 중독 벤치마크 MCPTox 에서 첫 실측 탐지율은 36.1% 다
(`docs/benchmark/mcp-audit-recall/RESULTS.md`). 행위 관측(Docker 격리)은 단계 2 의 `--sandbox` 가 맡는다.

## 라이브러리로 쓰기

```ts
import { audit, renderReport } from "@mcpeak/audit";
```

`audit(options, dependencies)` 는 연결·파일·fetch·난수를 모두 주입받는 함수다. 꼴은 `src/audit.ts` 의
`AuditDependencies` 에 있고, CLI 배선은 `packages/cli/src/audit-command.ts` 가 예다.
