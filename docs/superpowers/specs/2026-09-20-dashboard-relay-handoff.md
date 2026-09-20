# 4 단계 핸드오프 — 대시보드에 중계기를 붙인다

새 세션에서 여기부터 시작한다. 2026-09-20 작성.

## 0. 무엇을 맡기는가

설계 확정본(`docs/superpowers/specs/2026-09-16-mock-to-relay-design.md`) §7 의 **4 단계**다.

> 대시보드에 체크박스와 화면을 붙인다. §4 「AI 호출 경로」대로. ADR 을 하나 더 쓴다 —
> "합성 경로는 MCP 를 닫아 두고 실제 응답 경로에서만 연다".

만드는 것은 대시보드의 테스트 흐름에 들어가는 체크박스 하나와, 그것을 켰을 때 판정 화면
**앞에** 끼어드는 실제 응답 화면이다. 그 화면에서 대시보드가 중계기를 띄우고, AI 를 자동으로
불러 중계기에 붙이고, 오간 호출과 진짜 서버의 응답을 보여준다.

**설계 §1 을 먼저 읽어라.** 이 화면이 왜 필요한지가 거기 있다 — 판정 화면(②)은 ✓/✗ 와
진단 문장만 그리고, 서버가 실제로 무엇을 돌려줬는지는 화면에도 `--json` 보고서에도 남지 않는다.
사용자가 자기 서버의 실물 응답을 볼 수 있는 자리는 ① 하나뿐이다. **비교가 아니다** — ①과 ②는
값을 주고받지 않는다.

## 1. 순서를 건너뛴다 — 이걸 먼저 알아야 한다

설계는 1 → 2 → 3 → 4 순서다. **사용자가 2·3 을 건너뛰고 4 를 먼저 하기로 했다.**

그래서 지금 상태는 설계가 4 단계에서 전제한 상태와 다르다.

- **목이 그대로 살아 있다.** `createMockServer` · `serveStdio` · `mcpeak-mock` bin · `src/index.ts`
  1,123 줄 전부 그대로다. 중계기는 그 **옆에 추가된** 상태다.
- `packages/mock` 의 `bin` 에 `mcpeak-mock` 과 `mcpeak-relay` 가 **둘 다** 있다.
- 목 소비자(`packages/cli/tests/http-remote-e2e.test.ts` 등)도 그대로다.

4 단계 자체에는 큰 문제가 없다 — 대시보드는 중계기 bin 만 있으면 된다. **다만 2·3 단계를
나중에 할 때 4 단계가 만든 것이 함께 흔들릴 수 있다는 것만 기억해라.** 특히 목 삭제(3 단계)는
`1.0.0` major 이고 `bin` 이름이 바뀐다.

## 2. 1 단계에서 실제로 만들어진 것

커밋 17 개. `9f271d8`(설계 확정) 다음부터다.

- bd6295c feat(mock): 중계기 기록 줄 문안을 순수 함수로 추가한다
- 39fc4cc docs(adr): 목과 External 세션 사이에 중계 층을 넣는 결정을 기록한다
- add9f70 feat(mock): stdio 서버를 Streamable HTTP 로 중계하는 startRelay 를 추가한다
- 970e732 docs(mock): 중계기 1 단계 구현 계획을 추가한다
- fe4eee1 test(mock): 중계기가 응답을 검증하지 않는다는 것을 회귀로 고정한다
- eb9c052 feat(mock): 중계기가 JSON-RPC id 를 재작성해 세션을 격리한다
- ffc971f feat(mock): 중계기가 자식 종료까지 기다려 닫히도록 한다
- 09af6d8 feat(mock): 중계기가 오간 호출을 한 줄씩 기록한다
- 1c40075 feat(mock): mcpeak-relay 진입점을 추가한다
- a7fd3da test(mock): mcpeak-relay 진입점의 왕복과 신호 종료를 E2E 로 고정한다
- b1c5df2 docs(mock): 중계기 1 단계 완료 시점의 미결 여섯 건을 계획서에 남긴다
- 9d57d13 docs(adr): 중계기의 환경변수 전달을 --env 규약으로 고정한 판단을 남긴다
- ba6dbf7 feat(mock): 중계기 --env 의 이름 파서와 값 해석기를 추가한다
- e00abf3 feat(mock): 중계기가 --env 로 지목받은 환경변수를 자식에게 물려준다
- 5e9a09d refactor(mock): 중계기 argv 파싱을 순수 함수로 떼어내고 인자 오류 문안을 고정한다
- b9b01e5 feat(mock): 중계기가 버리는 서버발 메시지를 기록한다
- 2629a24 docs(mock): 1 단계 미결 넷이 닫힌 것을 계획서에 반영한다

계획서는 `docs/superpowers/plans/2026-09-18-mock-relay-stage1.md` 이고, 끝에 미결 절이 있다.

상태: 목 패키지 테스트 **10 파일 · 250 건 통과**. `pnpm typecheck` · `pnpm lint` · `pnpm build` 전부 0.
**푸시는 안 됐다** — `main` 이 `origin/main` 대비 ahead 18 / behind 2 다. 리베이스가 먼저이고,
그때 ADR 번호 0101·0102 가 origin 쪽과 겹치는지 확인해야 한다.

## 3. 4 단계가 기댈 중계기의 계약 (전부 실측)

설계 문서가 아니라 **지금 코드**가 이렇게 동작한다. 추측 말고 이것을 기준으로 삼아라.

### 표면

```bash
mcpeak-relay [--port <번호>] [--json] [--env <이름>]... -- <명령> [인자...]
```

- `--port 0` 이 기본. 빈 포트를 자동으로 받는다.
- **뒤 서버는 stdio 만 받는다.** 진짜 서버가 이미 HTTP 면 AI 를 거기 직접 붙이면 되므로
  중계기가 필요 없다.
- `--env <이름>` 은 그 환경변수를 대상 서버에 물려준다. **값이 아니라 이름만** 받는다
  (ADR-0102, ADR-0097). 안 지목한 변수는 자식에게 가지 않는다 — SDK 의
  `getDefaultEnvironment()` 여섯 개(`HOME`·`LOGNAME`·`PATH`·`SHELL`·`TERM`·`USER`) 위에 얹는다.

### 기동 줄 — 포트를 아는 유일한 길

`--port 0` 이면 받은 포트를 이 줄로만 알 수 있다. **stderr** 다.

```
→ 중계기 대기 중 http://127.0.0.1:53211/mcp
```

`--json` 이면:

```json
{"dir":"up","port":53211,"url":"http://127.0.0.1:53211/mcp"}
```

**대시보드는 `--json` 을 쓰고 이 줄로 URL 을 읽어라.** 설계에 없던 표면인데 1 단계에서 필요해서
만들었다(계획서 표 E).

### 기록 줄 — `--json` 한 줄 JSON

```json
{"dir":"req","id":3,"method":"tools/call","tool":"get_forecast","args":{"city":"부산"}}
{"dir":"res","id":3,"tool":"get_forecast","ok":true,"bytes":1240,"ms":1834}
{"dir":"res","id":4,"tool":"convert_units","ok":false,"code":-32602,"message":"…"}
{"dir":"res","id":5,"tool":"boom","ok":false,"isError":true,"bytes":84,"ms":120}
{"dir":"drop","kind":"request","method":"sampling/createMessage"}
```

- `id` 는 **중계기가 매긴 것**이다. 클라이언트의 id 가 아니다 — 세션 둘이 모두 1 부터 시작하기
  때문에 재작성한다. req 와 res 를 이 값으로 짝지어라.
- `bytes` 는 결과를 직렬화한 **바이트**다. 글자수가 아니다 — 한글이 섞이면 3 배 차이난다.
- `ms` 가 결정론성 규칙에 걸리는 유일한 필드다. 스냅샷을 뜨면 이 필드를 마스킹해라.
- `drop` 은 서버가 먼저 건 요청·알림을 버렸다는 뜻이다. **서버는 응답을 기다린다.** 화면에
  보여줄 값이 있다면 이 줄이다.
- **알림(client→server)은 기록되지 않는다.** req/res 짝이 어긋나지 않게 일부러 뺐다.

### ⚠ stderr 에 JSON 이 아닌 줄이 섞인다

자식 서버의 stderr 를 `inherit` 로 흘린다. 진짜 서버가 로그를 찍으면 그게 같은 채널에 섞인다.
**대시보드는 파싱 실패한 줄을 건너뛰어야 한다.** 계획서 표 H 다.

### 수명

- **중계기당 자식 1 개를 모든 세션이 공유한다.** 중계기가 뜰 때 진짜 서버를 한 번 띄우고,
  질문이 몇 개가 오든 그 하나에 붙는다. `add_note` 처럼 상태를 가진 서버가 질문 사이에
  상태를 잃지 않게 하려는 것이다(설계 §5).
- `close()` 는 **멱등**이다. 두 번 불러도 안전하고, 두 번째 호출은 첫 번째의 결과를 기다린다.
- SIGINT·SIGTERM 에 자식까지 종료된다. 종료 코드 0.

### ⚠ 대시보드가 중계기를 닫아야 한다

설계 §5 가 1 단계 범위 밖으로 미뤄 둔 것이 이것이다.

> 중계기가 살아 있는 채로 스위트가 `--command` 로 서버를 또 띄우는 경우 → 세션 정책으로 못
> 막는다. 대시보드가 ① 화면을 떠날 때 중계기를 닫아야 하고 그건 4 단계다.

**①에서 ②로 넘어갈 때 중계기를 닫아라.** 안 닫으면 판정 실행이 같은 서버를 또 띄운다.

## 4. 설계 §4 가 틀렸다 — 실측으로 확인했다

설계 §4 「AI 호출 경로」는 이렇게 적었다.

> 같은 패키지가 export 하는 범용 실행기 `runProviderProcess`(command·args·stdin·env
> allowlist·임시 cwd·타임아웃·실패 분류)를 재사용해 자기 argv 를 만든다. **`generate` 수정
> 0 줄이다.**

**`runProviderProcess` 는 `@mcpeak/generate` 의 진입점에서 export 되지 않는다.**
`packages/generate/src/index.ts:135-140` 이 re-export 하는 것은 **타입**뿐이다
(`ProviderProcessSpec` · `ProviderProcessResult` · `ProviderProcessDeps` ·
`ProviderProcessChild` · `ProviderFailureClassification`). 함수는 목록에 없다.
`package.json` 의 `exports` 도 `"."` 하나뿐이라 하위 경로로 우회할 수도 없다.

즉 **"`generate` 수정 0 줄" 은 성립하지 않는다.** 세 갈래 중 하나를 골라야 하고, 이건 설계
결정이라 ADR 감이다.

1. `generate/src/index.ts` 에 `runProviderProcess` 를 export 로 한 줄 더한다 — 가장 작다.
   대가는 `generate` 의 공개 표면이 넓어지는 것이고, 한 번 나가면 major 없이 못 줄인다.
2. 대시보드가 자기 실행기를 쓴다 — `generate` 무수정. 대가는 타임아웃·실패 분류·임시 cwd·
   출력 상한이 두 곳에 사는 것이다.
3. 공용 실행기를 아래 계층으로 내린다 — 가장 크고 이 단계에서 할 일은 아니다.

**어느 쪽이든 §4 의 나머지는 유효하다.** `generate` 의 provider 계층 자체는 건드리지 마라.
그 계층이 MCP 를 일부러 닫아 둔 이유(ADR-0079)가 있다 — 케이스 합성 도중에 진짜 서버를
호출해 버리면 결정론성과 승인 게이트가 약해진다. 격리를 뒤집지 말고, 격리가 필요 없는 새
용도에 새 경로를 내라. 그게 쓸 ADR 의 주제다.

AI 를 부르는 argv 는 이 모양이다(설계 §4).

```
claude -p "<질문>" --output-format json \
  --strict-mcp-config \
  --mcp-config '{"mcpServers":{"target":{"type":"http","url":"http://127.0.0.1:7400/mcp"}}}'
```

## 5. ⚠ 의존 경계 테스트가 막는다

`packages/dashboard/tests/dependency-boundary.test.ts` 가 **정확한 일치**를 단언한다.

```ts
expect(declaredInternalPackages(manifest("dashboard")))
  .toEqual(await importedInternalPackages("dashboard"));
```

`package.json` 의 `@mcpeak/*` 의존 목록과 `src`·`web/src` 가 실제로 import 하는 목록이
**같아야** 한다. 지금 대시보드는 `core`·`generate`·`record`·`runner`·`cli` 를 의존하고
**`mock` 은 의존하지 않는다.**

그런데 4 단계는 `mcpeak-relay` bin 을 spawn 해야 한다. 여기서 부딪힌다.

- `@mcpeak/mock` 을 의존에 더하고 **소스에서 import 하지 않으면** 이 테스트가 깨진다.
- 중계기는 **bin 전용**이라 import 할 것이 없다 — 설계 §2-6 이 `exports` 를 내지 않기로 했다.

**먼저 정할 것**: 의존을 선언하고 경계 테스트를 고칠지(bin-only 의존을 예외로 인정), 아니면
의존 없이 bin 경로를 찾을지. 의존 방향 자체는 문제없다 — `dashboard → mock` 은 아래쪽이다.
**남의 패키지를 고치는 것은 오너 허락을 받았다**(사용자 확인). 그래도 판단은 기록해라.

## 6. 알아둘 함정

- **대시보드 web 테스트 81 건이 이미 깨져 있다.** `window.localStorage.clear is not a function`
  — jsdom 환경 문제이고 중계기 작업과 무관하다. 1 단계 커밋은 dashboard 파일을 하나도
  건드리지 않았다. **당신이 깬 것이 아니니 여기에 시간을 쓰지 마라.** 다만 당신의 변경이
  초록인지 빨강인지 구별하려면 시작 전에 기준선을 한 번 찍어 둬라.
- **`pnpm build` 가 성공해도 turbo 캐시가 낡은 `dist` 를 복원할 수 있다.** 고친 심볼이 `dist` 에
  실제로 있는지 grep 해라. 없으면 그 패키지에서 `npx tsdown --config-loader native`.
- **`grep -c` 의 건수는 stdout 이고 종료 코드는 `$?` 다.** 0 건일 때 grep 은 exit 1 이다.
  파이프 뒤에서 `$?` 를 읽으면 `head`·`tail` 의 값을 본다.
- **회귀 테스트를 새로 썼으면 수정을 빼고 한 번 돌려 실패하는 것을 봐라.** 1 단계에서 이걸로
  "아무것도 검증하지 않던 테스트" 를 두 번 잡았다. 특히 §8-13 은 자식이 죽는 이유가 중계기가
  아니라 stdin 이 닫혀서였다 — 고치기 전까지 OS 동작을 확인하고 있었다.
- **`packages/mock/tests/stdio-e2e.test.ts` 가 미커밋 상태로 남아 있다.** #418 관련 주석 5 줄이고
  사용자 것이다. 커밋 범위에 넣지 마라.

## 7. 1 단계에서 닫지 못한 것

계획서 미결 절에 있다. 1·2·3·5 는 닫혔고 둘이 남았다.

- **§8-13 이 0.85 초 → 2.86 초로 느려졌다.** 정상이다. 자식이 SIGTERM 을 실제로 받아야 죽도록
  고친 결과다. 기록만 해 둔다.
- **dashboard web 81 건 실패.** 위 함정 항목.

그리고 실측으로 알게 된 것 하나 — **`id: null` 갈래는 닿지 않는 길이다.** SDK 의
`JSONRPCMessageSchema` 가 `onmessage` 앞에서 거절한다. `relay-server.ts` 의 `id === null`
조건과 `"method" in message` 가드는 지금 실행되지 않고 테스트도 덮지 못한다. 안전망으로
남겼고 주석에 그렇게 적혀 있다. 덮은 척하지 않는다.

## 8. 착수 순서 제안

1. **`git fetch` 로 `main` 과의 격차를 먼저 봐라.** 하루 사이에 커밋이 여럿 들어오기도 한다.
   지금 로컬이 ahead 18 / behind 2 다.
2. 대시보드 기준선을 찍어라 — 지금 무엇이 초록이고 무엇이 빨강인지.
3. **설계 §1 과 §4 를 읽어라.** 이 핸드오프는 §4 가 틀린 곳과 실측 계약만 담았다.
4. `superpowers:brainstorming` 으로 화면과 흐름을 먼저 정해라. 체크박스가 어디 들어가는지,
   ①에서 무엇을 보여주는지, ②로 넘어갈 때 중계기를 어떻게 닫는지가 코드보다 먼저다.
5. §4(실행기)와 §5(의존 경계) 두 판단을 먼저 닫아라. 둘 다 ADR 감이다.
6. 그 다음 계획서를 쓰고 태스크로 쪼개라.

**규칙은 `CLAUDE.md` 와 `CLAUDE.local.md` 가 전부다.** 특히 — 커밋·푸시는 사람이 한다.
기능 구현 전에 타입 시그니처와 테스트를 먼저 제시하고 확인을 받는다. 확신 없는 API 는
추측하지 말고 실제로 확인한다(이 문서의 §4 가 그렇게 해서 나왔다).
