# 관찰: 오류 응답 본문의 실제 형태 (이슈 #89)

관찰일: 2026-08-18. 대상: 공개 MCP 서버 5개 + 자체 서버 1개, 위반 입력 31건.

이슈 #89 는 `isError: true` 단언이 "서버가 입력을 정상 거절했다" 와 "서버가 다른 이유로 실패
했다" 를 구분하지 못한다고 적었다. 해결 후보로 `errorBodyMatchesSchema` 와 `errorBodyContains`
를 들면서, **형식을 가정하기 전에 실제 서버의 오류 응답을 관찰하라**는 선행 조건을 함께 걸었다.
이 문서가 그 관찰이다.

MCP 규격에 오류 응답 본문의 형식이 없다. 그래서 우리가 형식을 가정하면 정상 서버에서 오탐이
난다. ADR-0015 의 원칙("오탐 1건이 미탐 1건보다 비싸다")이 그대로 적용된다.

## 1. 무엇을 어떻게 관찰했나

`connectStdio` 로 서버를 띄우고, 각 툴의 첫 `required` 필드를 골라 세 종류의 위반 입력을 넣었다.
나머지 required 필드는 그럴듯한 값으로 채워 **노린 위반 하나만 남겼다.**

- `REQUIRED_OMITTED`: 그 필드를 뺀다
- `TYPE_VIOLATION`: 선언 타입을 어긴 값을 넣는다 (`string` 자리에 `12345`)
- `ENUM_VIOLATION`: enum 밖 값을 넣는다

| 서버 | SDK | 툴 수 | 관찰 건수 |
|---|---|---|---|
| `examples/weather-server` (자체) | 직접 구현 | 2 | 4 |
| `@modelcontextprotocol/server-memory` | TS | 9 | 8 |
| `@modelcontextprotocol/server-everything` | TS | 13 | 5 |
| `@modelcontextprotocol/server-filesystem` | TS | 14 | 8 |
| `mcp-server-time` (`mcp<2`) | Python | 2 | 4 |
| `mcp-server-fetch` (`mcp<2`) | Python | 1 | 2 |

툴은 서버당 최대 4개까지만 봤다. 총 31건이고 종류별로는 `REQUIRED_OMITTED` 15, `TYPE_VIOLATION`
15, `ENUM_VIOLATION` 1 이다.

## 2. 관찰 1 — 구조화된 오류 본문은 **한 건도 없었다**

31건 전부가 다음 한 가지 모양이었다.

```json
{ "content": [{ "type": "text", "text": "…" }], "isError": true }
```

`content` 의 `type` 은 31/31 이 `text` 다. `raw` 응답에 오류 코드 필드도, 위반 필드 이름을 담은
구조도 없다. TS 서버들이 내는 `MCP error -32602` 는 **문자열 안에 들어 있을 뿐** 별도 필드가
아니다.

```
MCP error -32602: Input validation error: Invalid arguments for tool echo:
  Invalid input: expected string, received number at message
```

**따라서 `errorBodyMatchesSchema` 는 대조할 구조가 없다.** 이 후보는 관찰 단계에서 탈락한다.

## 3. 관찰 2 — 본문 문구는 SDK 마다 다르고, 필드 이름이 항상 나오지 않는다

| SDK | `REQUIRED_OMITTED` | `TYPE_VIOLATION` |
|---|---|---|
| TS | `… expected array, received undefined at entities` | `… expected array, received string at entities` |
| Python | `Input validation error: 'timezone' is a required property` | `Input validation error: 12345 is not of type 'string'` |
| 자체 | `→ 'city' 는 문자열이어야 합니다.` | `→ 'city' 는 문자열이어야 합니다.` |

본문에 **위반한 필드 이름이 들어 있는 비율은 28/31** 이다. 빠진 3건은 전부 Python SDK 의
`TYPE_VIOLATION` 이다. 그쪽은 필드가 아니라 **값**을 적는다.

```
Input validation error: 12345 is not of type 'string'
```

`errorBodyContains(필드이름)` 을 기본 단언으로 넣으면 이 3건이 **오탐**이 된다. 서버는 정확히
우리가 기대한 대로 거절했는데 우리 도구가 실패로 찍는다.

## 4. 관찰 3 — 크래시가 거절과 같은 모양으로 온다 (SDK 상위 API 한정)

이슈의 전제를 직접 확인했다. 같은 동작을 두 방식으로 구현한 탐침 서버를 만들어 비교했다.

| 서버 구현 | 핸들러가 예외를 던졌을 때 클라이언트가 받는 것 |
|---|---|
| 하위 API (`Server.setRequestHandler`) | **protocol 오류로 던져진다.** 우리 `core` 가 `OPERATION_FAILED` / phase `callTool` 로 변환 |
| 상위 API (`McpServer.registerTool`) | **`isError: true` 결과로 돌아온다.** 거절과 구분되지 않는다 |

상위 API 쪽 본문이 이렇다.

```
Cannot read properties of undefined (reading 'city')
```

여기에 **함정이 하나 더 있다.** 이 크래시 문구에 필드 이름 `city` 가 들어 있다. 즉
`errorBodyContains("city")` 는 이 크래시를 **통과**로 찍는다. 3절이 지적한 오탐과 방향이 반대인
미탐이 같은 단언에서 동시에 난다.

프로세스가 죽는 경우는 다르다. 그때는 `PROCESS_EXITED` 로 던져지므로 지금도 구분된다.

## 5. 결론

이슈가 든 후보 둘 다 **기본 단언으로는 못 쓴다.**

- `errorBodyMatchesSchema`: 대조할 구조가 없다 (2절).
- `errorBodyContains(필드이름)`: Python SDK 에서 오탐, 크래시 문구에서 미탐 (3절·4절).

관찰이 말해 주는 것은 이렇다.

1. **본문 형식으로는 거절과 크래시를 가를 수 없다.** 둘 다 자유 문장이고, 크래시 문구가 위반
   필드 이름을 포함할 수 있다.
2. **가를 수 있는 자리는 본문이 아니라 다른 곳이다.** 프로세스 종료(`PROCESS_EXITED`)와 하위
   API 서버의 protocol 오류(`OPERATION_FAILED`)는 이미 구분된다. 남는 사각은 **상위 API 서버의
   핸들러 예외**뿐이다.
3. 그 사각을 좁히는 현실적인 수단은 이슈가 대안으로 적은 **단계 9(케이스별 stderr 구간)** 이다.
   상위 API 서버도 예외가 나면 대개 stderr 에 흔적을 남긴다. 단언이 아니라 진단으로 가른다.

## 6. 제안

- `errorBodyMatchesSchema` 는 **버린다.** 근거는 2절이다.
- `errorBodyContains` 는 **만들되 자동 생성하지 않는다.** 사람이 자기 서버의 문구를 알고 손으로
  적는 단언으로는 유효하다. baseline 이 필드 이름으로 자동 생성하면 3절·4절이 그대로 재현된다.
- 거절과 크래시의 구분은 **단계 9 로 넘긴다.** 그 전까지는 설계서 §12 의 거짓 신호 항목을 유지
  한다.

이 셋은 서로 다른 방향("단언을 늘린다" 대 "진단으로 민다")이라 ADR 대상이다.

## 7. 재현

관찰에 쓴 스크립트는 저장소에 넣지 않았다. 일회성이고 외부 서버를 실제로 띄운다. 재현하려면
`connectStdio` 로 위 서버들을 띄우고 각 툴의 첫 required 필드에 위 세 종류의 위반 입력을 넣은 뒤
`ToolResult.raw` 를 그대로 찍으면 된다. 크래시 비교는 `McpServer.registerTool` 과
`Server.setRequestHandler` 로 같은 툴을 두 번 구현해 핸들러에서 예외를 던지면 재현된다.

부작용이 있는 툴은 호출하지 않았다. `server-filesystem` 은 읽기 툴 4개만 봤고 전용 샌드박스를
줬다.

---

# 2차 관찰: 거절과 크래시를 가르는 신호가 있는가

관찰일: 2026-08-18. 대상: 공개 서버 10개 + 자체 서버 1개(위반 입력 80건), 크래시 탐침 13건.

1차 관찰의 §5 는 "본문으로는 못 가르니 단계 9(케이스별 stderr)로 넘긴다" 로 끝났다. 2차는 그
전제를 검증했다. **결과가 그 결론마저 뒤집는다. 단계 9 로도 못 푼다.**

## 8. 크래시 탐침 — SDK 가 예외를 삼키고 로그를 안 남긴다

일부러 터지는 서버를 언어·SDK·터지는 방식으로 나눠 만들고, 클라이언트가 본 것과 stderr 를 함께
모았다.

| 탐침 | 클라이언트가 본 것 | stderr |
|---|---|---|
| **Node 상위 API · 핸들러 예외** | `isError: true` (거절과 동일) | **0 바이트** |
| **Python 상위 API · 핸들러 예외** | `isError: true` (거절과 동일) | **트레이스 없음** |
| Node 상위 · async 미처리 거부 | `PROCESS_EXITED` | 스택 전량 |
| Node 상위 · `process.exit` | `PROCESS_EXITED` | 배너 |
| Node 상위 · 메모리 부족 | `PROCESS_EXITED` · `SIGABRT` | V8 `FATAL ERROR` 블록 |
| Node 하위 API · 핸들러 예외 | `OPERATION_FAILED` | 0 바이트 |
| Python 상위 · `process.exit` | `OPERATION_FAILED` (exit 7) | 배너 + 트레이스백 |
| **Python 상위 · async 미처리 거부** | **`isError: false`, 통과** | 트레이스백 |
| Node·Python 상위 + JSON 로거 · 핸들러 예외 | `isError: true` | 스택이 JSON 한 줄 안 |

첫 두 줄이 결론을 정한다. **이슈가 지목한 바로 그 경우에 stderr 가 비어 있다.** SDK 가 핸들러
예외를 잡아 응답으로 바꾸고, 로그는 남기지 않는다. 서버 작성자가 직접 로그를 찍은 경우(JSON 로거
행)에만 흔적이 생긴다.

stderr 에 흔적이 남는 나머지는 전부 **프로세스가 실제로 죽은 경우**이고, 그것은 지금도
`PROCESS_EXITED` 로 구분된다. 즉 단계 9 가 새로 잡아 주는 것이 없다.

**한 줄은 예외다.** Python 상위 API 의 async 미처리 거부는 응답이 정상(`isError: false`)으로
돌아오는데 stderr 에 트레이스백이 남는다. **케이스는 통과로 찍히고 서버 안에서는 작업이
실패했다.** 이것은 #89 와 다른 결함이고, 단계 9 가 실제로 잡을 수 있는 유일한 종류다. 별도
이슈로 등록할 값이 있다.

## 9. 본문 지문 — 접두어로 가를 수 있는가

공개 서버 10개에 위반 입력을 넣어 80건을 모았다.

| 서버 | SDK | 관찰 | 응답 모양 |
|---|---|---|---|
| `server-memory` | TS | 12 | `MCP error -32602:` |
| `server-everything` | TS | 8 | `MCP error -32602:` |
| `server-filesystem` | TS | 12 | `MCP error -32602:` |
| `server-sequential-thinking` | TS | 2 | `MCP error -32602:` |
| `server-github` | TS | 12 | **던져짐** (`OPERATION_FAILED`, cause `-32603`) |
| `mcp-server-sqlite` | Python | 10 | `Input validation error:` |
| `mcp-server-git` | Python | 12 | `Input validation error:` |
| `mcp-server-time` | Python | 4 | `Input validation error:` |
| `mcp-server-fetch` | Python | 2 | `Input validation error:` |
| `mcp-server-calculator` | Python (FastMCP) | 2 | **`Error executing tool …:`** |
| `examples/weather-server` (자체) | 직접 구현 | 4 | 자유 문장 |

접두어 분포는 `MCP error -32602:` 34, `Input validation error:` 28, `Error executing tool X:` 2,
던져짐 12, 자유 문장 4 다.

**충돌이 네 군데서 난다.**

1. **FastMCP 는 거절과 크래시가 같은 접두어다.** `mcp-server-calculator` 의 정상 거절이
   `Error executing tool calculate: 1 validation error for …` 이고, 탐침의 크래시가
   `Error executing tool sync_throw: 'NoneType' object has no attribute 'upper'` 다.
2. **하위 API 서버는 오류 코드가 같다.** `server-github` 의 거절도, 탐침 크래시도 던져지고
   `cause.code` 가 둘 다 `-32603` 이다. `-32602`(잘못된 인자)와 `-32603`(내부 오류)이 갈리기를
   기대했지만 서버가 자기 검증 실패를 내부 오류로 감싼다.
3. **손으로 거절하는 서버는 자유 문장이다.** 우리 `weather-server` 의
   `→ 'city' 는 문자열이어야 합니다` 는 크래시 문구와 모양이 같다.
4. **1차 관찰의 필드 이름 규칙도 여전히 깨진다.** Python 타입 위반은 필드를 안 적고, 크래시
   문구는 필드를 적는다(`reading 'city'`).

## 10. 결론 — 자동 판정은 불가능하다

거절과 크래시를 **자동으로** 가르는 신호가 응답에도, stderr 에도, 오류 코드에도 없다.

- 응답 본문: 접두어가 SDK마다 다르고 FastMCP 는 거절과 크래시가 같다.
- 오류 코드: 하위 API 서버에서 둘 다 `-32603` 이다.
- stderr: 상위 API 의 핸들러 예외에는 아예 없다.

가능한 것은 **반대 방향**이다. "크래시를 찾는다" 가 아니라 **"거절임을 확인한다"** 는 된다.
아래 세 지문은 SDK 검증이 낸 거절임을 양성으로 확인해 준다.

```
MCP error -32602:            (TS SDK)
Input validation error:      (Python 하위 SDK)
Error executing tool …: N validation error for …   (FastMCP + pydantic)
```

관찰 80건 중 64건이 이 셋 중 하나에 걸린다. 나머지 16건은 던져진 것(12)과 손으로 거절하는
서버(4)다. 그 16건은 **거절인지 크래시인지 확인할 수 없다**가 정확한 상태다.

## 11. 수정된 제안

- **판정을 바꾸는 자동 규칙은 만들지 않는다.** 오탐 없이 크래시를 지목할 방법이 없다. ADR-0015 의
  원칙에 따라 오탐 있는 규칙보다 미탐을 택한다.
- **양성 확인을 표시한다.** 위반 케이스가 통과했을 때 "거절 근거 확인됨" 과 "확인 못 함" 을
  나눠 보여준다. 커버리지 화면이 건너뛴 툴을 고지하는 것과 같은 성격이고, 판정을 안 바꾸므로
  `--json` 과 승인 지문이 안전하다.
- **단계 9 는 #89 의 해법이 아니다.** 다만 §8 의 마지막 줄(async 실패가 통과로 찍히는 경우)을
  잡는 별도 가치가 있다. 그 근거로 다시 평가한다.
- **새 이슈 하나.** "서버 안에서 async 작업이 실패했는데 응답은 정상이라 케이스가 통과한다."

## 12. 표본의 한계

- 공개 서버 10개는 전부 TS SDK 또는 Python SDK 를 쓴다. Go·JVM 구현체는 못 봤다.
- 툴은 서버당 6개까지만 봤다.
- 크래시 탐침은 우리가 만든 것이다. 실제 사용자 서버의 크래시 분포와 같다는 보장은 없다.
- `mcp-server-commands` 는 셸을 실행하므로 제외했다.
