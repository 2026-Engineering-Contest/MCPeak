# 토큰 소비 비교 실험: 수동 지침 대 MCPeak

같은 과제를 두 방식으로 Claude Code 에이전트에게 시켜, 완료까지 쓴 토큰과 검출 결과를 비교한다.

- **A안 (manual)**: MCP 서버 테스트 방법을 성실히 적은 md 지침만 준다. 에이전트가 클라이언트를
  직접 짜서 서버를 두드린다.
- **B안 (mcpeak)**: 같은 과제에 MCPeak 사용법을 적은 md 지침을 준다.

두 지침은 **방법 절만 다르고 나머지는 바이트 단위로 같다.** `task.md` 가 공통 본문이고
`method-manual.md` · `method-mcpeak.md` 가 방법 절이다. `build.sh` 가 둘을 이어 붙여 조건별
`CLAUDE.md` 를 만든다. 손으로 두 파일을 따로 고치지 않는다.

## 대상 서버와 정답지

| 시나리오 | 서버 | 결함 | 정답(채점자만 안다) |
|---|---|---|---|
| S1 스키마 대 구현 | `examples/weather-server/server.broken-demo.mjs` | `add` 가 필수·타입 검사를 안 한다. 스키마는 `a`,`b` 필수 number 로 선언돼 있다 | 거절돼야 할 입력 4종(`a` 누락, `b` 누락, `a` 문자열, `b` 문자열)이 성공 응답을 낸다. 결함 1개 |
| S2 요구사항 대 구현 | `examples/zod-notes-server/server.mutant.mjs` | zod 제약 세 곳이 빠졌다. 스키마에도 빠져 있으므로 스키마만 읽어서는 못 잡는다 | `requirements.md` 의 `title` 길이 1..80, `priority` enum, `limit` 정수 1..50 위반이 성공한다. 결함 3개, 위반 축 6개 |

S2 는 두 조건 모두에게 `requirements.md` 를 준다. S1 은 스키마가 곧 요구사항이므로 주지 않는다.
결함의 위치·개수는 지침에 넣지 않는다.

## 격리

에이전트는 이 저장소 안에서 돌리지 않는다. 저장소의 `node_modules` 에 MCPeak 이 있어 A안이
그것을 발견해 쓸 수 있고, B안은 소스가 보이면 문서 대신 소스를 읽어 토큰을 더 쓴다.

`build.sh` 는 `runs/<시나리오>/<조건>/` 에 서버 파일, `package.json`, `CLAUDE.md`, (S2 는)
`requirements.md` 만 복사한다. 두 조건 모두 그 디렉터리에서 `npm install` 뒤 실행한다.
B안은 `npx @mcpeak/cli` 로 npm 배포판을 쓴다. 로컬 빌드가 아니라 사용자가 받는 것과 같은 것이어야 한다.

## 실행과 측정

```bash
cd runs/s1/manual
claude -p "$(cat ../../../prompt.txt)" --output-format json --max-turns 60 > result.json
```

`prompt.txt` 는 한 줄이다. 과제는 `CLAUDE.md` 에 있고 프롬프트는 그것을 가리키기만 한다.
`result.json` 의 `usage`(input, output, cache read/creation), `total_cost_usd`, `num_turns`,
`duration_ms` 를 기록한다. 조건당 5회 돌려 중앙값을 쓴다. 모델은 두 조건 모두 같은 것으로
고정하고 결과 표에 적는다.

## 채점

에이전트의 최종 보고(`report.md`)를 정답지와 대조한다.

- 검출: 정답의 결함을 보고했는가 (S1 1/1, S2 3/3).
- 오탐: 결함이 아닌 것을 결함이라 했는가.
- 완료: 지침의 완료 기준을 채웠는가 (도구별 정상 1건, 위반 1건 이상, 보고 형식 준수).

토큰이 줄었어도 검출이 줄었으면 결과 표에 그대로 적는다. 한 값만 떼어 쓰지 않는다.

## 미리 적어 두는 한계

- 이 모델, 이 과제, 이 지침에서의 수치다. 다른 서버로 일반화하지 않는다.
- B안 지침은 `--baseline-only` 를 쓴다. 헤드리스라 승인 화면이 없기 때문이다. `repair` 와
  AI 사전보완은 이 실험에 넣지 않는다. 넣으면 그 호출 토큰도 B에 더해 따로 행을 만든다.
- A안이 헤매는 원인이 지침의 부족이면 지침을 고치고 전 회차를 다시 돈다. 지침 수정 이력은
  `CHANGELOG.md` 에 남긴다.

## 에이전트 환경 격리

헤드리스 `claude -p` 는 사용자 전역 설정(MCP 서버, 스킬, 훅, 전역 CLAUDE.md)을 상속한다. 회차 2
추적에서 도구 124개, MCP 서버 12개, 스킬 87개가 들어가 시스템 프롬프트만 턴당 약 4.8만 토큰이었다.
두 조건 공통 비용이지만 잡음이 커서 `run.sh` 가 `--setting-sources project`,
`--strict-mcp-config --mcp-config empty-mcp.json`, `--disable-slash-commands` 로 잘라 낸다.
`run.sh` 는 실행 뒤 `환경: tools=… mcp=0 slash=0` 을 찍는다. mcp 와 slash 가 0 이 아니면 격리가
안 된 것이다.

## 비교 구도 변경 (2026-09-27, 회차 S1-4 · S2-2 부터)

처음 구도는 B안 에이전트가 `generate --baseline-only` 부터 직접 했다. 헤드리스라 승인 화면을 못
쓰기 때문이었는데, 그러면 MCPeak 의 실제 흐름(사람이 `generate` 를 돌리고 승인 화면에서 값을
고친다)에서 사람이 하는 일을 에이전트가 대신하게 되어 B안 토큰이 부풀었다. S1·S2 첫 구도의 결과는
`results.md` 에 그대로 남긴다.

바꾼 구도: B안은 **사람이 승인해 둔 명세** `server.suite.json` 이 있는 상태에서 시작하고,
에이전트는 `mcpeak test` 를 돌려 보고서만 쓴다. 명세 수정은 금지한다. A안은 그대로다.

`suites/s1.suite.json` 은 S1 서버에서 `city=서울` 픽스처를 주고 `--baseline-only` 로 만든 것이다.
`suites/s2.suite.json` 은 요구사항 문서를 그대로 구현한 정상 서버(`examples/zod-notes-server/server.mjs`)
에서 만든 것이다. 요구사항 문서에서 사람이 손으로 쓴 명세와 같은 내용이며, 변이 서버에 돌리면
정답 축 6개에서만 실패하는 것을 확인했다.

전제: 명세를 만들고 승인하는 사람의 시간은 토큰에 잡히지 않는다. 결과를 인용할 때 이 전제를 함께 적는다.

## S3: 도구가 많은 서버에서 전 과정 비교 (2026-09-27 추가)

가설: A안의 비용은 케이스 수에 비례하고(코드로 써야 한다), B안의 `generate` 는 케이스 수와 무관하다.
도구 2~3개에서는 차이가 없었으니 도구가 많은 서버에서 갈리는지 본다. **B안은 전 과정(generate 부터)**
을 에이전트가 한다. S1·S2 의 첫 구도와 같다.

| 항목 | 내용 |
|---|---|
| 서버 | `servers/s3.mjs`. `examples/live-weather-server` 에서 외부 API 툴 4개를 빼고 로컬 툴 6개만 남긴 사본. 메모 파일은 작업 폴더의 `.notes.json` 에 쓴다 |
| 도구 | `add_note`, `list_notes`, `convert_units`, `summarize_text`, `lookup_country`, `evaluate_expression` |
| `generate` 결과 | 50 케이스 (6 tools) |
| 정답 결함 | 1개. `convert_units` 가 `outputSchema` 에 `converted` 를 선언하고 `structuredContent` 에는 `result` 로 싣는다. 정상 입력마다 SDK 가 `-32602 Output validation error` 를 던진다. `generate` 명세로는 5 케이스가 실패한다 |
| 함정 | `evaluate_expression` 의 자리값 `"example"` 은 서버가 거절한다. 결함이 아니고 픽스처로 풀 일이다 |
| A안이 잡는 법 | 정상 입력이 오류로 돌아오므로 "허용하는 입력에 거절이 오면 결함" 규칙에 걸린다 |

채점: 결함 1/1(`convert_units` 출력 모양), 오탐(`evaluate_expression` 을 결함으로 적으면 오탐).

## 실행 폴더는 저장소 밖에 둔다 (S3 회차 1 에서 발견)

S3 회차 1 추적에서 격리된 에이전트가 대시 기호 검사를 했다. 그 규칙은 사용자 전역 `~/.claude/CLAUDE.md`
에만 있다. `init` 이벤트의 `memory_paths` 에 이 프로젝트의 자동 메모리 경로도 있었다. 실행 폴더가
저장소 안이라 `CLAUDE.md` 자동 탐색이 상위의 팀 `CLAUDE.md`, `CLAUDE.local.md`, 전역 지침을 모두
읽어 들인 것이다. 또 `run.sh` 가 `trace.jsonl` 을 같은 폴더에 쓰고 있어 에이전트가 자기 로그를 `cat`
했다.

고친 것: 실행 폴더를 `~/.mcpeak-bench/runs/` (환경변수 `MCPEAK_BENCH_RUNS` 로 바꿀 수 있다)로
옮기고, 실행 기록은 `logs/trial-N/` 에 따로 쓴다. 전역 `~/.claude/CLAUDE.md` 는 여전히 읽힌다
(`--bare` 는 API 키 인증만 받아 쓸 수 없다). 규칙 세 줄이고 두 조건 공통이라 그대로 두고 여기 적는다.
S1·S2 의 기존 회차와 S3 회차 1 은 이 오염이 있는 상태의 값이다.

## 조건 C: 에이전트용 파이프라인 (2026-09-27 추가, 실험용)

"사람용 흐름을 에이전트에게 그대로 시키면 턴이 늘어 토큰이 는다" 는 관측에서 나온 실험 버전이다.
기존 CLI 는 바꾸지 않고, `agent-pipeline/mcpeak-agent.mjs` 가 `@mcpeak/cli` 를 자식 프로세스로
불러 다음을 명령 하나로 한다.

1. `generate --baseline-only` 로 명세 생성
2. `test --json` 으로 실행
3. 정상 케이스가 서버 거절 메시지로 실패한 것만 **좁은 LLM 호출**(툴 이름·입력·오류 문장만, 도구 없음)로
   자리값인지 결함인지 분류. Output validation 오류와 거절 케이스 실패는 LLM 없이 결함 확정
4. 자리값이면 `mcpeak.fixtures.json` 을 쓰고 1~2 를 한 번 더(재시도 상한 1회)
5. `task.md` 형식의 `report.md` 작성, 요약 한 화면 출력

에이전트는 명령 하나를 실행하고 요약을 읽고 보고서를 제출한다. 내부 LLM 호출의 토큰과 비용은
`agent-usage.json` 에 남고 `run.sh` 가 조건 C 의 총비용에 더한다. 회계에서 빠지는 것은 없다.

조건 이름은 `agent`, 지침은 `method-agent.md`. S1 과 S3 에서 A안과 비교한다. S2 는 요구사항
문서의 제약을 손으로 써야 해서 이 파이프라인의 범위 밖이다.

```bash
CONDS="agent" ./run-batch.sh "s3:2,3,4" "s1:9,10,11"
```

유닛테스트: `node --test agent-pipeline/tests/lib.test.mjs` (인메모리, 픽스처만).

## 후속: 대시보드 "한 번에 검증" (2026-09-28)

조건 C 의 결론을 제품에 옮긴 것이 ADR-0103 이다. `cli` 의 `autoReviewIO` 가 generate 의 승인
질문에 정책대로 답하고, 대시보드 `verify` 플로우가 generate 와 test 를 잇는다. 실험용 래퍼
`agent-pipeline/` 은 그대로 실험 기록으로 남기고 제품에는 넣지 않았다(사전보완이 이미 있다).

함정: 대시보드를 **Claude Code 세션 안에서** 띄우면 `CLAUDECODE` 환경변수가 자식 `claude` 에
상속돼 provider 가 `providerFailed` 로 끝난다. 실측할 때는 `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT`
로 띄운다. 사용자 터미널에서는 생기지 않는다.
