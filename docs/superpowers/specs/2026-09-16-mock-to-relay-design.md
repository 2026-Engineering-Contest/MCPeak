# mock 패키지를 중계기로 전환한다

대상 패키지 `@mcpeak/mock` (오너 `@storyrago`). 2026-09-16 착수 · **2026-09-18 확정.**

## 0. 이 문서의 상태

확정본이다. 같은 경로의 2026-09-16 핸드오프(설계 진행 중, §6 미결)를 대체한다. 구현은
시작하지 않았고 코드는 한 줄도 바뀌지 않았다. 핸드오프에서 §2-1 이 **뒤집혔다**(§2 각주).

## 1. 하려는 것

대시보드의 테스트 흐름에 체크박스를 하나 넣는다. 켜면 **테스트 판정 화면 앞에 실제 응답
화면이 하나 끼어든다.**

```
[체크박스 켬]
 ① 실제 응답 화면   중계기가 진짜 MCP 서버를 자식으로 띄운다
                    대시보드가 AI 를 자동으로 불러 중계기에 붙인다
                    오간 호출과 진짜 서버의 응답이 화면에 뜬다
 [다음]
 ② 테스트 판정 화면  ✓ / ✗ 만 나온다
```

**①이 존재하는 이유는 ②가 값을 보여주지 않기 때문이다.** 리포터는 툴 이름·단언 이름·
통과·실패·진단 문장만 그린다. 서버가 실제로 무엇을 돌려줬는지는 화면에도 `--json` 보고서에도
남지 않는다. 사용자가 자기 서버의 실물 응답을 볼 수 있는 자리는 ① 하나뿐이다.

**비교가 아니다.** ①과 ②는 값을 주고받지 않는다. 판정 앞에 실물을 한 번 보여줄 뿐이다.

## 2. 결정된 것

1. **AI 는 대시보드가 자동으로 부른다.** ← 핸드오프의 §2-1 을 뒤집었다. 원래는 "사람이
   자기 클로드 창에서 직접 부른다" 였으나, 자동화가 이 기능의 목적이다. 대신 `generate` 의
   provider 계층은 건드리지 않는다 (§4 「AI 호출 경로」).
2. **흉내내지 않는다. 진짜 서버가 답한다.** 목이 값을 지어내는 대신 진짜 서버를 뒤에 두고
   중계한다.
3. **테스트는 중계기를 통과하지 않는다.** 스위트는 지금처럼 `--command` 로 서버에 직접
   붙는다. 결정론성과 기존 테스트 경로를 건드리지 않기 위해서다.
4. **목 패키지를 중계기로 바꾼다.** 병행이 아니라 전환이다.
5. **패키지 이름은 `@mcpeak/mock` 을 유지한다.** `1.0.0` major 로 내용만 바꾼다. `bin` 은
   `mcpeak-mock` → `mcpeak-relay`. 디렉터리 이동이 없으므로 의존 경계 테스트
   (`packages/dashboard/tests/dependency-boundary.test.ts`)와 CONTRIBUTING §2.1 오너 표,
   커밋 scope 가 그대로다. 대가는 npm 에서 목을 기대하고 받는 사람이 생기는 것이고,
   완화는 3 단계의 CHANGELOG·README 문안이 전부다.
6. **bin 전용.** `exports` 를 내지 않는다. 공개 타입 계약이 없으면 major 없이 못 바꾸는 면이
   안 생긴다. 테스트만 내부 모듈을 직접 import 한다.

## 3. 왜 중계기여야 했나 — 조사 결과

되짚지 않아도 되도록 근거를 남긴다. 세 갈래를 차례로 지웠다.

**스위트 명세만으로는 목을 세울 수 없다.** 저장소 전체 스위트의 단언은 네 종류뿐이다
(2026-09-18 재집계).

| 단언 | 건수 |
|---|---:|
| `isError` | 114 |
| `bodyMatchesSchema` | 8 |
| `structuredContentMatchesSchema` | 6 |
| `toolExists` | 6 |

전부 모양을 보는 단언이라 **응답 알맹이가 없다.** 값을 보는 단언(`bodyEquals`·`equals`·
`contains`)은 **0 건**이다. 스위트에는 툴의 `inputSchema` 도 없다. 목 정의는 그것을 요구한다.

**빈 스키마로 때우면 알려진 결함을 재현한다.** 입력 검사가 조용히 꺼진 채 초록불이 뜨는
문제(발행본 훑기 H-5)가 그대로 나온다. 더 나쁜 것은 거절 케이스다. 주입이 없으면 미스
진단문이 `isError` 로 나가고 거절 단언이 그걸 보고 통과한다 — H-4 가 잡은 가짜 초록과
같은 구조다.

**응답을 녹화해 오는 경로도 없다.** 카세트가 ADR-0059 로 제거되면서 그 자리가 비었다.

**그리고 stdio 서버는 관찰할 수 없다.** 진짜 서버가 stdio 면 AI 클라이언트가 자기 자식
프로세스를 띄우므로 대시보드가 호출을 볼 방법이 없다. 앞에 HTTP 를 한 겹 세워야 오가는
것이 보인다. 이것이 중계기가 필요한 결정적 이유다. **자동화(§2-1)로 바뀐 뒤 이 이유는 더
강해졌다** — 사람이 눈으로 보는 창조차 없으므로 중계기의 기록이 유일한 관찰 채널이다.

## 4. 만들 것

### 표면

```bash
mcpeak-relay --port 7400 -- node ./server.mjs
```

앞이 Streamable HTTP, 뒤가 stdio 다. **뒤 서버는 stdio 만 받는다** — 진짜 서버가 이미 HTTP 면
AI 를 거기 직접 붙이면 되므로 중계기가 필요 없다.

### 구조

```
packages/mock/src/
  relay.ts          bin 진입점 — argv 파싱 · 신호 처리 · 종료 코드 · stderr 로 log 배선
  relay-server.ts   startRelay() — HTTP 기동 · 자식 spawn · 파이프 연결 (테스트가 import)
  relay-log.ts      기록 줄 문안 — 순수 함수 (테스트가 import)
```

```ts
export interface RelayOptions {
  /** 0 이면 임의 포트를 받아 handle.port 로 돌려준다. */
  port: number;
  command: string;
  args: readonly string[];
  /** 한 줄씩 부른다. bin 은 stderr 쓰기를 넣고, 테스트는 배열에 모은다. */
  log: (line: string) => void;
  json: boolean;
}

export interface RelayHandle {
  readonly port: number;
  readonly url: string;                 // http://127.0.0.1:<port>/mcp
  /** HTTP 를 닫고 자식이 실제로 끝날 때까지 기다린다. */
  close(): Promise<void>;
}

export function startRelay(options: RelayOptions): Promise<RelayHandle>;
```

`log` 주입이 요점이다. bin 전용이면서도 테스트가 stderr 를 파싱하지 않고 기록 줄을 본다.

### 중계 방식 — JSON-RPC 파이프

transport 둘을 SDK `Server`/`Client` 없이 직접 잇는다.

```
클라이언트 → POST /mcp → http.onmessage(m) → log(req, m) → stdio.send(m)
자식 서버   →            stdio.onmessage(m) → log(res, m) → http.send(m)
```

**해석하는 지점이 없다.** "값을 만들지도 바꾸지도 않는다" 가 규율이 아니라 구조로 보장된다.
`initialize` 도 지나간다 — 핸드셰이크 협상은 클라이언트와 진짜 서버가 직접 한다. 중계기가
능력을 대신 선언하면 그 순간 "진짜 서버가 답한다" 가 아니게 된다.

**SDK `Server` + `Client` 브리지는 버렸다.** SDK `Client` 는 `structuredContent` 를
`outputSchema` 로 검증한다 (`examples/live-weather-server` 의 결함 A 가 내는 `-32602` 가 그
경로다). 중계기가 `Client` 를 쓰면 진짜 서버의 잘못된 응답을 **중계기가 대신 받아서** 던지고,
사용자는 서버의 답이 아니라 중계기가 만든 오류를 본다. §2-2 가 거기서 깨진다.

### 기록 채널

호출마다 한 줄씩 **stderr** 로 낸다. stdout 은 쓰지 않는다. 사람이 읽는 줄이 기본이고
`--json` 이 한 줄 JSON 을 낸다. 이름은 CLI 의 기존 `--json` 과 맞춘다. 4 단계의 대시보드가
그 플래그를 쓴다.

```
→ tools/list
← tools/list  툴 10개
→ tools/call  get_forecast {"city":"부산"}
← tools/call  get_forecast 성공 · 1,240자 · 1.8초
← tools/call  convert_units 오류 -32602 Structured content does not match the tool's output schema
```

```json
{"dir":"req","id":3,"method":"tools/call","tool":"get_forecast","args":{"city":"부산"}}
{"dir":"res","id":3,"tool":"get_forecast","ok":true,"bytes":1240,"ms":1834}
```

세 가지를 못박는다.

- **인자는 줄이지 않고 그대로 싣는다.** 무엇을 보냈는지가 이 화면의 존재 이유다. 줄이면
  사용자가 다시 서버 로그를 봐야 한다.
- **오류는 진짜 서버가 준 코드와 메시지를 그대로 쓴다.** 중계기가 문장을 고쳐 쓰면 사용자가
  보는 것이 진짜 원인이 아니게 된다.
- **시간은 `ms` 한 곳에만 둔다.** 결정론성 규칙에 걸리는 유일한 필드다. 테스트는 이 필드와
  사람 줄의 초 단위를 마스킹하고 비교한다.

### AI 호출 경로 (4 단계)

대시보드는 `generate` 의 provider 계층을 **쓰지 않는다.** 그 계층은 MCP 를 일부러 닫아 뒀다.

```ts
// packages/generate/src/providers.ts
["--tools", ""],
["--strict-mcp-config"],
["--mcp-config", '{"mcpServers":{}}'],
```

코덱스 쪽도 `-s read-only --ignore-user-config --ephemeral` 이다. 근거는 ADR-0079 다. 그리고
그 격리에는 이유가 있다 — `generate` 가 AI 를 부르는 목적은 **케이스 합성**인데, 거기에 MCP 를
열면 케이스를 지어내는 도중에 진짜 서버를 호출해 버릴 수 있고 결정론성과 승인 게이트가
약해진다. 노출된 표면도 `author`·`preFill`·`diagnose`·`diagnoseRejection` 넷뿐으로, 전부
`--json-schema` 를 건 일회성 구조화 출력이다. 대화 진입점이 없다.

**그래서 격리를 뒤집지 않고, 격리가 필요 없는 새 용도에 새 경로를 낸다.** 대시보드는 공동
영역(CONTRIBUTING §2.1)이고 이미 `@mcpeak/generate` 에 의존하므로, 같은 패키지가 export 하는
범용 실행기 `runProviderProcess`(command·args·stdin·env allowlist·임시 cwd·타임아웃·실패 분류)
를 재사용해 자기 argv 를 만든다. **`generate` 수정 0 줄이다.**

```
claude -p "<질문>" --output-format json \
  --strict-mcp-config \
  --mcp-config '{"mcpServers":{"target":{"type":"http","url":"http://127.0.0.1:7400/mcp"}}}'
```

## 5. 세션과 수명

**중계기당 자식 1 개를 띄워 모든 세션이 공유한다.** 중계기가 뜰 때 진짜 서버를 한 번 띄우고,
질문이 몇 개가 오든 그 하나에 붙인다. 중계기를 닫을 때 같이 닫는다.

세션당 자식 1 개를 버린 이유는 자동화 때문이다. 대시보드는 `claude -p` 를 **질문마다 새
프로세스로** 띄우므로, 세션당 자식이면 질문 하나마다 진짜 서버가 새로 뜬다. `add_note` 처럼
상태를 가진 서버는 질문 사이에 상태가 날아가고 기동 비용도 매번 든다.

대가는 파이프가 1:N 이 되는 것이다. **JSON-RPC `id` 로 응답을 어느 세션에 돌려줄지 매칭해야
한다.** 테스트가 한 건 는다 (§8-11).

**"서버 두 벌" 우려는 두 가지가 섞여 있다.** 세션 정책으로 막히는 것은 앞쪽뿐이다.

- 중계기에 클라이언트가 둘 붙는 경우 → 세션 정책의 몫
- **중계기가 살아 있는 채로 스위트가 `--command` 로 서버를 또 띄우는 경우** → 세션 정책으로
  못 막는다. 대시보드가 ① 화면을 떠날 때 중계기를 닫아야 하고 그건 4 단계다. 1 단계는
  `close()` 가 자식 종료까지 기다린다는 계약만 지키면 된다.

## 6. 사라지는 것

살아남는 것은 HTTP 서버를 세우고 트랜스포트를 다는 배선 정도다.

| | 줄 수 | 중계기에서 |
|---|---:|---|
| 구현 (`src/`) | 1,123 | 100 줄 남짓만 |
| 테스트 (`tests/`) | 1,720 | 거의 전부 대상 소멸 |

걷어내는 층: 매칭 키 생성, 응답 레지스트리, 중복 주입 거절, 미스 진단문, `inputSchema`
검사 네 축, 키 위반 검사, stdio 목 진입점.

**무효가 되는 ADR 네 건**: 0005 목 데이터 전략, 0007 stdio 진입점, 0048 목이 `inputSchema` 를
검사한다, 0057 목과 External 세션의 경계.

**같이 깨지는 자리**: `packages/cli/tests/http-remote-e2e.test.ts` (유일한 코드 소비자,
`createMockServer` 로 네트워크 없이 `--url` 경로를 돈다), `mcpeak-mock` 을 문자열로 기대하는
CLI 테스트들, `examples/mock-server`, README·`docs/2026-08-21-팀-테스트-가이드.md`·
`docs/adoption.md`.

## 7. 단계 순서

CLAUDE.md 가 "한 번에 한 패키지" 를 요구하고 목 소비자가 남의 영역에 있으므로 끊어 간다.
단계 사이에는 사람이 만든 통합 SHA 를 확인하고 넘어간다.

1. **중계기 파일을 추가한다. 목 파일은 한 줄도 건드리지 않는다.** 아무것도 안 깨진다.
   터미널에서 손으로 전체 흐름을 돌려볼 수 있는 상태까지. 끝에 ADR 을 쓴다 — "목과 External
   세션 사이에 중계 층을 넣는다".
2. **목 소비자를 하나씩 옮긴다.** CLI 테스트는 공동 영역이라 이슈를 열고 오너에게 알린다.
   `http-remote-e2e.test.ts` 가 쓰던 `createMockServer` 자리를 무엇으로 대체할지 여기서 정한다.
3. **목을 지운다.** `1.0.0` changeset · README · `description` 갱신을 여기 묶는다.
4. **대시보드에 체크박스와 화면을 붙인다.** §4 「AI 호출 경로」대로. ADR 을 하나 더 쓴다 —
   "합성 경로는 MCP 를 닫아 두고 실제 응답 경로에서만 연다".

## 8. 1 단계 테스트 목록

유닛 — `startRelay` 를 in-process 로 띄우고 HTTP 클라이언트로 붙는다.

1. `tools/list` 가 진짜 서버가 선언한 목록 그대로 온다
2. `tools/call` 결과가 `structuredContent` 까지 바이트 그대로 온다
3. **잘못된 `structuredContent` 를 내는 서버를 뒤에 두면, 중계기가 걸러내지 않고 클라이언트까지
   그대로 간다** — SDK `Client` 브리지를 버린 이유를 고정하는 회귀 테스트. "중계기에
   `outputSchema` 검증을 넣으면 이 테스트가 실패한다" 를 주석으로 박는다
4. `isError: true` 응답이 프로토콜 오류로 바뀌지 않는다
5. 서버가 모르는 메서드에 대해 서버가 낸 `-32601` 이 그대로 온다
6. 기록 줄이 요청·응답 한 쌍으로 순서대로 나온다
7. `--json` 줄이 파싱되고 필드가 맞다
8. 뒤 서버가 죽어도 `close()` 가 멈추지 않는다
9. `close()` 뒤 자식 프로세스가 남지 않는다
10. `relay-log` 순수 함수 — 인자 없는 호출, 오류 코드, 큰 결과
11. **세션 둘이 번갈아 호출해도 응답이 섞이지 않는다** (§5 의 `id` 매칭)

E2E — 직렬 전용 웨이브로 분리한다.

12. `mcpeak-relay` 를 spawn 해 결정론적 `examples/weather-server` 를 중계하고 HTTP 로 왕복
13. `SIGINT` 에 자식까지 종료된다

## 9. 주의사항

- **결정론성.** 중계기를 지나는 응답은 진짜 서버가 내므로 같은 입력에 같은 결과라는 보장이
  없다. 그래서 §2-3 으로 테스트 경로에서 뺐다. 이 구분이 흐려지면 안 된다.
- **회귀 테스트는 수정을 빼고 한 번 돌려 실패하는 것을 본다.** 특히 8-3 · 8-11.
- **빌드 산출물을 의심한다.** E2E 는 빌드 후에만 의미가 있고, turbo 캐시가 낡은 `dist` 를
  복원해도 빌드는 성공했다고 찍힌다. 고친 심볼이 `dist` 에 실제로 있는지 확인한다.
- **커밋·발행은 사람이 한다.** 이 문서도 커밋하지 않았다.

## 10. 다음 할 일

1. 이 문서를 사용자가 검토한다.
2. 1 단계 구현 계획을 쓴다.
