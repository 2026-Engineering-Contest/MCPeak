# Audit

이 문서를 끝내면 MCP 서버를 등록하기 전에 도구 정의·실행 명령·프로토콜 응답의 보안 위험을
점검하고, 발견 목록을 읽어 등록할지 판단하는 절차를 아는 상태가 된다. 서버 코드는 건드리지
않는다.

## 한 줄로 점검하기

```bash
mcpeak audit -- node ./server.mjs
```

서버를 띄워 `tools/list` 와 프롬프트·리소스·instructions 를 읽고, `readOnlyHint` 가 `true` 인
도구는 실제로 불러 응답까지 본다. 서버 지정 방법은 `test` 와 같다.

```bash
mcpeak audit --command npx --arg -y --arg some-mcp-server@1.2.3 --env GITHUB_TOKEN
mcpeak audit --url https://mcp.example.com/mcp --header-env Authorization=MCP_TOKEN
```

## 결과 읽기

`examples/audit-target-server` 는 일부러 취약하게 만든 서버다. 점검하면 이렇게 나온다.

```
mcpeak audit 결과
서버 audit-target-server 0.0.0 · 도구 6개 · 프롬프트 0개 · 리소스 0개 · instructions 없음
호출 정책 readonly · 호출한 도구 3개

판정: 심각 5건, 주의 1건, 낮음 0건, 정보 0건

[심각] desc/injection · 도구 'add_numbers' 의 description
  → 모델에게 내리는 지시가 있습니다: "<IMPORTANT>" (raw 형에서 발견)
  해결: 이 서버를 신뢰하지 않는다면 등록하지 마세요. 서버 작성자라면 설명에서 모델 지시를 빼세요.

[심각] secret/env-leak · 도구 'echo_env' 호출 응답의 content[0].text
  → 환경변수 GITHUB_TOKEN 에 심은 값이 응답에 나왔습니다
  해결: 서버가 환경변수를 읽어 밖으로 냅니다. 등록하지 마세요.

[주의] schema/secret-field · 도구 'translate_text' 의 inputSchema.properties.api_key
  → 비밀값을 인자로 요구합니다: 'api_key'
  해결: 비밀은 인자가 아니라 서버 환경변수로 받아야 합니다. 모델 컨텍스트에 비밀이 실립니다.
```

발견 하나는 `[심각도] 가족/규칙 · 위치`, 무엇을 봤는지, 어떻게 할지 세 줄이다. 종료 코드는
심각·주의 발견이 있으면 2, 없으면 0, 연결·입력 실패는 1 이다. 권한 조합 경고(`flow`)와 정보
발견은 종료 코드에 넣지 않는다.

리포트 끝의 "검사하지 않은 것" 은 이번 실행에서 건너뛴 가족과 그 이유다. `readOnlyHint` 가
`true` 인 도구가 없으면 호출 검사(`result`·`secret`)가 비고, stdio 대상이면 `protocol` 이 빈다.

## 무엇을 보나

| 가족 | 보는 것 |
|---|---|
| `desc` | 도구·프롬프트·리소스·instructions 의 모든 문자열. 모델 지시, 숨은 부차 동작, 다른 도구 섀도잉, 보이지 않는 문자, ANSI 이스케이프, 인코딩된 긴 문자열 |
| `schema` | 비밀값 인자, 대화를 실어 보낼 수 있는 자유 문자열 필드, `readOnlyHint` 와 이름의 불일치, 파괴적 이름의 `destructiveHint` 누락 |
| `flow` | 외부 입력 읽기·비공개 데이터 접근·외부 쓰기가 한 서버에 모두 있는 조합(경고) |
| `launch` | 실행 명령의 인라인 코드, 원격 스크립트를 셸로 넘기기, 버전 미고정 패키지, 실제 env 전달 |
| `protocol` | HTTP 평문, 무인증 수락, Origin 미검사, URL 의 세션 식별자, 서버 발신 요청 안의 지시 |
| `secret` | 카나리 env 의 유출, 전달한 실제 값의 반향 |
| `result` | 호출 응답의 모델 지시·보이지 않는 문자·ANSI·과대 크기 |
| `surface` | `--baseline` 기준 파일과 지금 도구 정의의 차이 |
| `behavior` · `network` | (`--sandbox`) 미끼 자격 증명 읽기, 자식 프로세스, 선언되지 않은 목적지로 나간 요청 |

판정은 이 컴퓨터 안에서만 한다. 규칙은 정규식·코드포인트 표·스키마 검사·해시이고 도구 정의를
밖으로 보내지 않는다. 같은 서버에 같은 명령이면 `--json` 출력이 바이트까지 같다.

## 비밀은 서버에 주지 않는다

stdio 서버를 띄울 때 `GITHUB_TOKEN` 같은 흔한 비밀 이름에 가짜 값(카나리)을 넣는다. 서버가 그
값을 응답에 내면 환경변수를 밖으로 흘리는 것이라 발견으로 알린다. `--env` 로 넘긴 이름에는
카나리 대신 실제 값이 가고, 그 값이 응답에 나오는지도 본다. 어느 값도 출력에 쓰지 않는다.

## 도구 정의 변경 추적

승인 뒤에 도구 정의를 바꾸는 서버를 잡으려면 기준 파일을 둔다.

```bash
mcpeak audit --baseline ./server.audit.json -- node ./server.mjs
```

기준 파일이 없으면 만들고, 있으면 지금 정의와 비교해 바뀐 도구를 `surface` 발견으로 알린다.
서버 갱신이 의도된 것이면 `--update-baseline` 으로 기준을 다시 쓴다.

## 격리 안에서 행위 보기

`--sandbox` 를 붙이면 서버를 이 머신이 아니라 버려지는 Docker 컨테이너 안에서 띄우고, 모든
도구를 고정 페이로드로 불러 그동안 연 파일, 띄운 프로세스, 시도한 접속, 나간 HTTP 요청을
기록한다.

```bash
mcpeak audit --sandbox -- node ./server.mjs
mcpeak audit --sandbox --allow-host api.example.com -- npx -y some-mcp-server@1.2.3
```

알아 둘 것이 넷이다.

- 격리가 켜지지 않으면 서버는 이 머신에서 돈다. Docker 가 없거나 명령이 `node`·`npx`·`npm` 이
  아니면 격리 없이 같은 점검을 하고, 리포트 둘째 줄이 그 사유를 말한다.
- 호출 정책의 기본값이 다르다. 격리가 실제로 켜진 실행은 `all`(상태를 바꾸는 도구도 부른다),
  켜지지 않은 실행은 `readonly` 다. `--probe` 를 직접 주면 어느 쪽에서도 그 값이다.
- 네트워크는 끊지 않고 가로챈다. 도구 설명·README·`package.json`·`--allow-host` 에 있는
  호스트는 선언된 목적지라 기록으로만 남고, 그 밖의 목적지는 발견이다. 컨테이너에는 호스트의
  환경변수를 넘기지 않는다.
- 컨테이너·네트워크·볼륨에는 라벨 `mcpeak.audit=1` 이 붙고 실행이 끝나면 지운다. 점검 도중
  강제로 끝내면 남으므로 `docker ps -a --filter label=mcpeak.audit=1` 로 확인하고 치운다.

격리 안의 HTTP 왕복은 `--sandbox-session` 으로 녹화하고 `--sandbox-replay` 로 재생한다. 같은
세션 파일로 재생한 두 실행의 `--json` 은 바이트 단위로 같다. 옵션 전체는
[CLI 레퍼런스](/ko/reference/cli#audit)에 있다.

## 한계

`--sandbox` 없이는 설명문의 문형과 프로토콜 표면만 본다. 바꿔 말한 지시와 서버 코드의 실제
행위는 보지 못하므로 발견 0 이 안전하다는 뜻은 아니다. `--sandbox` 는 한 번의 실행에서
관측된 행위만 본다. 호출 횟수나 시간이 지나야 달라지는 행동, 암호화해 내보낸 값은 보지
못한다. 관측되지 않았다는 것은 없다는 증명이 아니다.

## 대시보드에서

[대시보드](/ko/guide/dashboard)의 분석 화면 보안 탭이 같은 점검을 돌린다. 판정은 CLI 와 같은
함수가 한다.
