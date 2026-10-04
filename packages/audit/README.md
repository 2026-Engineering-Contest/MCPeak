# @mcpeak/audit

MCP 서버를 쓰기 전에 도구 정의·실행 명령·프로토콜 응답을 읽고 보안 위험을 점검한다. CLI 에서는
`mcpeak audit` 로 쓴다.

```
mcpeak audit -- node ./server.mjs
mcpeak audit --command npx --arg -y --arg some-mcp-server@1.2.3 --env GITHUB_TOKEN
mcpeak audit --url https://mcp.example.com/mcp --header-env Authorization=MCP_TOKEN
mcpeak audit --baseline ./server.audit.json -- node ./server.mjs   # 도구 정의 변경 추적
mcpeak audit --json -- node ./server.mjs                           # 결과 JSON
mcpeak audit --sandbox -- node ./server.mjs                        # Docker 격리 안에서 행위 관측
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
| `surface` | `--baseline` 기준 파일과 지금 도구 정의의 차이. `--sandbox --compare-host` 면 격리 안과 이 머신의 도구 정의 차이도 본다 |
| `behavior` | (`--sandbox`) 미끼 자격 증명 파일 읽기, 내부 주소 접속 시도, 자식 프로세스, readOnlyHint 와 어긋나는 쓰기·실행, 임시 디렉터리 밖 쓰기, 점검 기록 훼손 |
| `network` | (`--sandbox`) 카나리가 실린 나가는 요청, 선언되지 않은 목적지, 내부 주소로 풀리는 이름, 인증서 고정, 이름 조회 없는 직접 IP 접속, 재생에 없는 요청 |

규칙 하나하나의 조건과 문장은 `docs/plans/2026-10-03-audit-핵심-검사-구현계획.md` §3·§6 이 정본이다.
`behavior`·`network` 와 격리 실행은 `docs/plans/2026-10-03-audit-샌드박스-행위-관측-구현계획.md` §3·§6 이 정본이다.

## 격리 실행 (`--sandbox`)

서버를 사용자 머신이 아니라 버려지는 Docker 컨테이너 안에서 띄우고, 모든 도구를 고정 페이로드로 불러 그동안
연 파일, 띄운 프로세스, 시도한 접속, 나간 HTTP 요청을 기록한다.

```
mcpeak audit --sandbox -- node ./server.mjs
mcpeak audit --sandbox --compare-host -- node ./server.mjs
mcpeak audit --sandbox --allow-host api.example.com -- npx -y some-mcp-server@1.2.3
mcpeak audit --sandbox --sandbox-session ./server.session.json --json -- node ./server.mjs   # 녹화
mcpeak audit --sandbox --sandbox-replay ./server.session.json --json -- node ./server.mjs    # 재생
```

| 옵션 | 뜻 |
|---|---|
| `--sandbox` | 격리 실행을 켠다. `--url` 과 함께 쓸 수 없다 |
| `--sandbox-session <path>` | 격리 안의 서버가 주고받은 HTTP 왕복을 이 파일에 녹화한다 |
| `--sandbox-replay <path>` | 이 세션 파일로만 답한다. 상류에 접속하지 않는다. `--sandbox-session` 과 함께 쓸 수 없다 |
| `--allow-host <host>` | 선언된 목적지에 더한다. 반복할 수 있다. 그 호스트와 하위 도메인이 선언으로 취급된다 |
| `--compare-host` | 이 머신에서 **격리 없이** 서버를 한 번 더 띄워 `tools/list` 만 받고 격리 안의 표면과 비교한다 |
| `--sandbox-mount <dir>` | 컨테이너에 읽기 전용으로 보일 호스트 디렉터리 |

알아 둘 것:

- **격리가 켜지지 않으면 서버는 이 머신에서 돈다.** Docker 가 없거나, 데몬이 응답하지 않거나, 명령이
  `node`·`npx`·`npm` 이 아니면 격리 없이 같은 점검을 하고 리포트 둘째 줄이 "행위 관측 안 함: …" 으로 사유를
  말한다. 종료 코드는 그 점검의 결과를 따른다.
- **호출 정책의 기본값이 다르다.** 격리가 실제로 켜진 실행은 `all`(상태를 바꾸는 도구도 부른다), 켜지지 않은
  실행은 `readonly` 다. `--probe` 를 직접 주면 어느 쪽에서도 그 값이다(ADR-0107).
- **`--compare-host` 는 서버를 이 머신에서 격리 없이 한 번 띄운다.** 도구는 호출하지 않고 목록만 받지만,
  서버의 시작 코드는 이 머신에서 실행된다. 격리를 알아채고 다른 도구 정의를 내는 서버를 잡는 옵션이고,
  기본으로 꺼져 있다(ADR-0108).
- **네트워크는 끊지 않고 가로챈다.** 컨테이너의 접속은 게이트웨이를 지나며 목적지·헤더·본문이 기록된다.
  정상 서버는 그대로 응답을 받는다. 도구 설명·README·`package.json`·`--allow-host` 에 있는 호스트는 선언된
  목적지라 기록(`info`)으로만 남고, 그 밖의 목적지는 발견이다. 컨테이너에는 호스트의 환경변수를 넘기지 않는다.
- **컨테이너에 보이는 범위.** `--sandbox-mount` 를 주지 않으면 실행한 자리에서 위로 가장 가까운
  `pnpm-workspace.yaml` 의 디렉터리, 없으면 가장 가까운 `.git` 의 디렉터리, 둘 다 없으면 실행한 자리다. 읽기
  전용으로 호스트와 같은 경로에 붙는다. 홈 디렉터리와 `/` 는 거절한다. 서버 인자가 가리키는 파일이 그 범위
  밖이면 거절한다.
- **`npx`·`npm` 으로 받아 띄우는 서버.** 명령이 `npx`·`npm` 일 때만 컨테이너의 `~/.npm` 에 실행 가능한
  임시 영역(512MB)을 연다. 실행기가 그 자리에 패키지를 받고 bin 을 실행해야 하기 때문이다. `node` 로 띄우는
  서버에는 열지 않고 `/tmp` 는 언제나 실행 불가다(ADR-0109). 실행기가 시작하면서 그 자리에 쓰는 것은
  발견으로 치지 않는다. 서버가 호출 중에 그 자리에 쓰거나 거기서 실행하는 것은 막지 못하고 `behavior` 발견으로만
  드러난다. 512MB 를 넘는 패키지는 받지 못한다. 실행마다 새로 받으므로 시작이 느리다.
- **녹화와 재생.** 같은 세션 파일로 재생한 두 실행의 `--json` 은 바이트 단위로 같다. 녹화와 재생의 출력은
  `sandbox.network` 값 하나만 다르다. 녹화에 없는 요청이 재생에서 나오면 `network/replay-miss` 다.
- **정리.** 컨테이너·네트워크·볼륨에는 라벨 `mcpeak.audit=1` 이 붙고 실행이 끝나면 지운다. 지우지 못하면
  리포트를 먼저 내고 남은 것과 직접 치우는 명령을 stderr 에 낸 뒤 종료 코드 1 로 끝난다. 점검 도중 프로세스를
  강제로 끝내면(Ctrl-C 등) 지울 기회가 없어 남는다. 그때는 아래 명령으로 치운다.

  ```
  docker rm -f $(docker ps -aq --filter label=mcpeak.audit=1)
  docker network prune -f --filter label=mcpeak.audit=1
  docker volume rm $(docker volume ls -q --filter label=mcpeak.audit=1)
  ```

- 격리 이미지(`mcpeak-audit-sandbox:<내용 해시>`)는 첫 실행에서 만든다. 몇 분 걸릴 수 있다.

예제는 `examples/sandbox-target-server`(일부러 취약하게 만든 표적)에 있다.

## 설계에서 정한 것

- **판정은 이 컴퓨터 안에서만 한다.** 규칙은 정규식·코드포인트 표·스키마 검사·해시이고 도구 정의를
  밖으로 보내지 않는다. 같은 입력이면 `--json` 출력이 바이트까지 같다(ADR-0104).
- **도구 호출은 기본이 읽기 전용이다.** `--probe readonly` 는 readOnlyHint 가 true 인 도구만 부른다.
  `all` 은 상태를 바꾸는 도구도 부르므로 버려도 되는 환경에서만 쓴다(ADR-0105).
- **격리 안의 네트워크는 차단이 아니라 가로채기로 관측한다.** 격리가 실제로 켜진 실행만 모든 도구를
  부른다(ADR-0107). 격리 흔적은 다 지우지 못하고, 그 자리는 안팎 표면 비교와 지속 비교가 메운다(ADR-0108).
- **서버에 진짜 비밀을 주지 않는다.** stdio 서버를 띄울 때 흔한 비밀 이름에 카나리 값을 넣고, 응답에
  그 값이 나오면 유출로 본다. `--env` 로 명시한 이름만 실제 값을 넘긴다. 어느 값도 출력에 쓰지 않는다.

## 한계

`--sandbox` 없이는 설명문과 프로토콜 표면만 본다. 서버 코드의 실제 행위는 보지 못하므로 발견 0 이
안전하다는 뜻은 아니다.

설명문 검사는 두 층이다. 문형 규칙(`desc/injection` 등)은 정해진 표현을 찾고, 점수 규칙(`desc/steering`)은
설명이 모델의 도구 사용을 조종하는 모양을 신호 19개로 잰다. 공개 중독 벤치마크 MCPTox 1,312 사례에서 둘을
합친 탐지율은 원문 99.1%, 낱말을 바꿔 쓴 변형 97.7%, 겨냥한 도구의 설명에 직접 심고 말투까지 바꾼 변형
84.5%, 다른 도구의 이름을 풀어 쓰고 말투까지 바꾼 변형 63.2% 다
(`docs/benchmark/mcp-audit-recall/RESULTS.md`). 변형은 기계적 치환이라, 사람이 공들여 다시 쓴 설명에서는 더
낮을 수 있다.

**검사 방식을 아는 공격자는 막지 못한다.** 규칙과 점수표가 이 저장소에 공개돼 있어서, 신호가 되는 낱말만
피해 쓰면 점수 규칙은 거의 잡지 못한다(실측 1.3%). 그때 남는 것은 지우면 공격이 성립하지 않는 내용, 곧 자격
증명 경로나 서버와 무관한 주소를 가리키는 사례뿐이고 전체의 10% 쯤이다. 점수 규칙은 영어 설명만 본다.

점수 규칙의 주의(medium)는 정상 도구의 1% 쯤에서도 나온다. "반드시 먼저 무엇을 부르라"고 강하게 지시하는
정상 설명이 그렇다. 발견 문장이 근거 문장과 걸린 신호를 함께 보여 주므로 읽고 판단한다.

`--sandbox` 는 한 번의 실행에서 관측된 행위만 본다. 호출 횟수나 시간이 지나야 달라지는 행동, 암호화하거나
요약해서 내보낸 값, HTTP 가 아닌 접속의 내용, 인증서 고정을 쓰는 접속의 내용은 보지 못한다. 컨테이너라는
흔적(`/.dockerenv`, cgroup)은 지우지 못해서 격리를 알아채고 얌전히 구는 서버가 있을 수 있다. 관측되지
않았다는 것은 없다는 증명이 아니다.

## 라이브러리로 쓰기

```ts
import { audit, renderReport } from "@mcpeak/audit";
```

`audit(options, dependencies)` 는 연결·파일·fetch·난수를 모두 주입받는 함수다. 꼴은 `src/audit.ts` 의
`AuditDependencies` 에 있고, CLI 배선은 `packages/cli/src/audit-command.ts` 가 예다.
