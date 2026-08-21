# ADR-0052: 부모 Coordinator가 Record/Replay Engine과 Session Store를 소유한다

- 상태: 제안
- 날짜: 2026-08-21
- 담당: record, cli
- 작성자: @ddxng5 (② replay/record 파트)
- 승인: 미승인
- 선행 결정:
  [ADR-0051](./0051-external-record-replay와-tool-카세트-경계-분리.md)

## 배경

External Record/Replay는 실제 MCP 서버 프로세스 안의 외부 호출을 관찰하고 대체해야 한다.
Node 1차 범위에서는 `NODE_OPTIONS=--import <bootstrap>`으로 서버 코드보다 먼저 훅을 설치할 수
있다. 그러나 훅이 감지한 요청과 결과를 어느 프로세스가 매칭하고 SQLite에 저장할지는 별도
결정이다.

초기 어댑터 설계 초안은 자식 Bootstrap 안에 Adapter Registry, Engine, Session Store를 모두
두고 자식이 SQLite를 직접 읽고 쓰는 구조였다. 이 방식은 구성요소 수가 적지만 다음 책임이 자식
프로세스에 함께 들어간다.

- 현재 Record/Replay 모드와 source session 선택
- 같은 요청의 반복 순번 관리
- SQLite 연결·마이그레이션·트랜잭션
- 저장 실패와 Replay miss 진단
- 정상 종료·비정상 종료에 따른 session 상태 변경

MCP 서버가 worker나 별도 프로세스를 사용하면 SQLite 작성자가 늘 수 있고, 향후 Python·Go
어댑터는 같은 저장 코드를 각 런타임에 다시 구현해야 한다. 반대로 모든 외부 트래픽을 일반 프록시로
보내면 HTTPS 인증서, 런타임별 proxy 환경 변수, 직접 소켓 호출까지 다뤄야 해 `fetch` 1차 범위를
넘는다.

CLI는 이미 실제 MCP 자식 프로세스의 시작과 종료를 조립하고 있다. 따라서 실행 세션의 수명과
저장소를 부모가 소유하고, 자식 훅은 호출 감지와 네이티브 값 변환에 집중시키는 경계를 검토한다.

## 선택지

### A안: 자식 Bootstrap이 Engine과 SQLite를 직접 소유한다

자식 안에서 모든 처리가 끝나므로 로컬 통신이 없다. 반면 저장소 코드가 대상 런타임에 들어가고,
여러 실행 주체의 순번·트랜잭션·종료 상태를 조율하기 어렵다.

### B안: 부모 CLI가 로컬 Coordinator를 띄우고 Engine과 Store를 소유한다

자식 Adapter는 정규화된 요청과 저장 결과 envelope만 Coordinator와 교환한다. 부모가 세션과
저장소의 단일 권위가 된다. 매 외부 호출마다 로컬 통신이 한 번 추가되고 내부 통신 계약을 관리해야
한다.

### C안: 일반 HTTP forward proxy가 실제 외부 요청도 대신 전달한다

대상 프로세스는 proxy를 외부 API처럼 호출하고 proxy가 Record/Replay를 모두 수행한다. 언어
중립적이지만 HTTPS MITM, 인증서 신뢰, proxy를 따르지 않는 라이브러리와 직접 소켓을 처음부터
다뤄야 한다.

## 결정

B안을 선택한다.

부모 CLI 프로세스는 실행마다 로컬 Coordinator를 만들고, Coordinator가 다음을 소유한다.

- Record/Replay mode와 source session
- Record/Replay Engine
- Coordinator wire schema version과 Adapter별 interaction schema version 검증
- `protocol + matchKey + occurrence`의 저장·조회
- Session Store와 선택된 저장 구현 연결
- session의 running·completed·failed 상태
- 저장 실패, Replay miss, schema 불일치 진단

자식 MCP 서버 프로세스에는 다음만 둔다.

- Bootstrap 설정 검증
- 활성 Adapter 설치와 복원
- 네이티브 요청의 정규화
- 실제 반환값·예외의 저장 envelope 변환
- 저장 envelope의 네이티브 반환값·예외 복원
- Coordinator Client

```text
부모 프로세스
CLI
 └─ Coordinator
     ├─ Record/Replay Engine
     └─ Session Store ── Memory(H1·H2) / SQLite(후속)

자식 프로세스
실제 MCP 서버
 └─ Bootstrap
     └─ Adapter ── Coordinator Client
```

Coordinator 통신은 다음 조건을 가진 내부 HTTP JSON 프로토콜로 한다.

- host는 `127.0.0.1`, port는 `0`으로 열어 OS가 빈 포트를 고른다.
- 외부 인터페이스에는 bind하지 않는다.
- 실행마다 임시 bearer token을 만들고 모든 요청에서 검증한다. token은 CSPRNG
  (`node:crypto`의 `randomBytes`)로 만들고 최소 256비트 엔트로피를 base64url로 인코딩한다.
- token은 `Authorization: Bearer <token>` 헤더로만 보낸다. query string이나 body에 싣지 않는다.
- token의 유효 기간은 현재 실행뿐이다. Coordinator가 닫힐 때 메모리에서 폐기하고, 다음 실행은
  항상 새 token을 만든다. 실행 사이에 재사용하지 않는다.
- token 비교는 길이 확인 후 `timingSafeEqual` 같은 상수 시간 비교를 쓴다. 문자열 `===`로
  비교하지 않는다.
- 인증 실패는 `401`, token은 맞지만 허용되지 않은 요청은 `403`으로 응답한다. 오류 body에는
  기대한 token, 받은 token, 그 일부나 길이를 넣지 않는다.
- token 원문은 SQLite, 설정 스냅샷, stderr, 오류 메시지에 저장하지 않는다.
- 요청·응답 크기는 각각 2 MiB를 상한으로 두며 초과는 실제 호출 우회가 아니라 명시적 실패다.
- 기본 요청 타임아웃은 5초이고 설정 가능한 범위는 1~60초다. 타임아웃은 실제 호출 fallback이
  아니라 명시적 실패다.
- Coordinator 연결 실패, 인증 실패, 알 수 없는 schema version은 fail-closed다.
- Bootstrap은 전역 훅을 설치하기 전에 같은 package/build의 배포 artifact에 포함된 정적 Adapter
  capability manifest를 읽는다. 이 manifest는 build 시 생성한 JSON이며, 실행 가능한 JavaScript
  module의 export가 아니다. 조회 과정은 module import·evaluation 없이 파일을 읽고 검증하는 전용
  reader만 사용한다. manifest는 Adapter ID, protocol, 지원하는 interaction schema version 집합만
  담으며, package/build·protocol·version 검증과 훅 설치 전에 Adapter 코드나 사용자 코드를 실행하거나
  외부 호출을 해서는 안 된다. manifest가 없거나 중복되거나 활성 Adapter와 ID가 맞지 않으면
  fail-closed한다.
- capability discovery 뒤 한 번 핸드셰이크한다. bearer token은 이 요청도 `Authorization` 헤더로만
  인증하며 JSON wire payload와 로그에는 싣지 않는다. payload에는 Coordinator wire schema version,
  아래 package/build identity, Adapter별 `ID + protocol + 지원 version 집합`, 부모가 요청한
  `interactionSchemaVersions`를 싣는다. 이 map은 Record에서 새 session에 사용할 version 또는 Replay
  source session에 저장된 version을 나타내는 선택값이지 capability 집합을 대신하지 않는다.
- Coordinator는 부모와 자식의 Adapter capability를 `ID + protocol + 지원 version 집합` 단위로
  대조한다. protocol은 빠짐없이 exact match해야 하고 부모가 지원하는 값이어야 한다. protocol이
  없거나 서로 다르거나 지원되지 않으면 version이 겹치더라도 합의하지 않는다. 그 뒤 선택값이 양쪽
  지원 집합에 있는지 확인해 활성 Adapter마다 정확히 하나의 version을 합의한다.
- package/build identity의 wire 형식은 `{ packageName, kind, value }`로 고정하며 `kind`는
  `packageVersion` 또는 `buildId`다. Coordinator의 기대값은 부모 package/build에 내장된 metadata에서,
  Bootstrap 값은 자식 package/build에 내장된 metadata에서 읽고 사용자 설정으로 덮어쓰지 않는다.
  `packageVersion` 값은 배포된 `package.json`의 version이고 `buildId`는 빌드 시 내장한 opaque ID다.
  세 필드는 비어 있지 않은 문자열이어야 하며 앞뒤 공백과 제어 문자를 허용하지 않는다. 종류나 값을
  변환하거나 SemVer range로 비교하지 않고 `packageName`, `kind`, `value`를 모두 exact match한다.
- package/build 검증과 version 합의가 모두 성공한 뒤에만 Bootstrap이 활성 Adapter 훅을 설치한다.
  identity 필드 누락·형식 오류·종류 불일치·값 불일치를 포함해 discovery, package/build 검증,
  protocol 검증, version 합의 중 하나라도 실패하면 사용자 코드와 실제 외부 호출이 시작되기 전에
  fail-closed한다.
- 핸드셰이크 뒤에도 모든 `begin`·`complete`·`lookup` 요청에 Adapter ID, Coordinator wire schema
  version, 그 Adapter에 합의된 interaction schema version을 싣는다. Coordinator는 Adapter ID로
  합의 결과를 조회해 두 version을 함께 검증한다. 세션에 저장되는 것은 Adapter별 interaction
  version이며, wire version은 실행 중 부모·자식 통신 형식만 검증한다.
- 내부 endpoint와 상태 코드는 공개 API가 아니며 동일 package/build의 Bootstrap과 Coordinator만
  통신한다. 방어 심층 재검사에서 불일치가 발견되면 사용자 설정이 아니라 패키지 구성 또는 구현
  오류라고 진단하며 token과 사용자 값은 싣지 않는다.

Record에서는 Adapter가 요청을 정규화한 직후 Coordinator에 `begin`을 보내 interaction ID와
occurrence를 먼저 예약한다. 예약이 성공한 뒤에만 실제 외부 호출을 수행하고, 반환값 또는 예외를
encode해 `complete`로 저장한다. Coordinator의 완료 확인이 끝난 뒤 원래 반환값을 서버 코드에
돌려주거나 원래 예외를 다시 던진다. 예약·저장 실패를 실행 성공으로 숨기지 않는다. begin 뒤
자식이 종료된 interaction은 incomplete로 남고 해당 session은 성공한 Replay 원본이 될 수 없다.

Replay에서는 Adapter가 실제 외부 호출을 수행하기 전에 정규화된 요청을 Coordinator에 보낸다.
Coordinator는 source session에서 저장 결과를 조회해 반환한다. hit이면 Adapter가 네이티브 값으로
복원하고, miss이면 실제 외부 호출을 수행하지 않은 채 실패한다.

부트스트랩 설정에는 최소한 다음 값만 전달한다.

| 설정 | 의미 |
|---|---|
| `mode` | `record` 또는 `replay` |
| `coordinatorUrl` | 현재 실행의 loopback endpoint |
| `coordinatorToken` | 현재 실행에만 유효한 임시 token |
| `adapters` | 설치할 Adapter ID 목록 |
| `coordinatorSchemaVersion` | 부모·자식 내부 통신 schema version |
| `interactionSchemaVersions` | Adapter ID를 키로 하고 현재 Record 또는 source session의 저장·매칭 version을 값으로 하는 map |
| `timeoutMs` | Coordinator 요청 타임아웃 |
| `bootstrapGuard` | 현재 External 실행에서 상속된 Bootstrap을 식별하는 비밀이 아닌 표식 |

`interactionSchemaVersions`의 키 집합은 `adapters`와 정확히 같아야 한다. 빠진 키, 알 수 없는 키,
중복 Adapter ID는 Adapter 설치 전에 실패한다. 단일 scalar version으로 여러 Adapter의 계약을
대표하지 않는다.

현재 session과 Replay source session의 선택은 bearer token에 연결된 부모 Coordinator 상태다.
그 식별자를 자식 설정에 중복 전달하지 않는다. SQLite 경로와 마이그레이션 정보도 자식에 전달하지
않는다. 설정은 자식 전용 env로 전달하고 argv에는 넣지 않는다. Bootstrap은 설정을 읽고 검증한
직후 bearer token을 포함한 Coordinator 설정 env를 삭제한다. `bootstrapGuard`만 아래 손자
프로세스 fail-closed 판정을 위해 남기며, 비밀값이나 session 식별자를 포함하지 않는다.

`NODE_OPTIONS` 병합 대상은 호출자가 자식 `env`에 명시한 값뿐이다. 부모 Codex/CLI 프로세스의
`process.env.NODE_OPTIONS`를 암묵적으로 상속하지 않는다. 호출자 값을 Node 옵션 단위로 파싱해
실행 코드를 선적재할 수 있는 `--require`·`-r`·`--import`·`--loader`·`--experimental-loader`와 각
`=` 형식이 있으면 조용히 제거하지 않고 자식 실행 전에 지원 오류로 거부한다. 그래야 호출자 코드보다
Bootstrap이 항상 먼저 실행된다. `--import` 대상은 Windows 절대경로 문자열이 아니라 `file://` URL로
만들고, 허용된 나머지 호출자 옵션 뒤에 Bootstrap URL을 병합한다. 훅과 Coordinator Client는 MCP
stdio의 stdout에 아무것도 쓰지 않는다.

MCP 서버가 Node 손자 프로세스를 만들면 `NODE_OPTIONS`의 Bootstrap import와 `bootstrapGuard`는
상속될 수 있지만, Coordinator 설정 env는 이미 부모 자식의 Bootstrap에서 제거됐다. 이때
Bootstrap은 조용히 비활성화하지 않고 **지원하지 않는 중첩 Node 프로세스**로 판정해 사용자 코드가
실행되기 전에 fail-closed한다. 그래야 Replay 중 손자 프로세스의 `fetch`가 실제 네트워크로 빠지는
것을 정상 지원처럼 숨기지 않는다. guard와 설정이 모두 없는 일반 Bootstrap import만 경고와
stdout 출력 없이 비활성화하며, 설정 일부만 남은 경우도 손상된 구성으로 보고 fail-closed한다.

H1·H2의 외부 호출 0회 보장은 계측된 주 MCP 서버 프로세스의 Node 내장 `fetch` 경계에 한정한다.
외부 호출을 별도 Node·비Node 프로세스에 위임하는 서버는 1차 지원 범위가 아니다. 상속된 Node
손자는 위 규칙으로 막고, 임의로 `env`나 실행 옵션을 다시 구성하는 프로세스 트리까지 투명하게
계측한다고 주장하지 않는다. 수직 E2E에는 Node 손자 실행이 실제 사용자 코드와 외부 endpoint에
도달하기 전에 실패하는 경우를 포함한다.

Session Store 계약의 첫 구현은 Node 20에서 동작하는 인메모리 Store로 한다. 이 구현으로 실제 MCP
서버를 Record와 Replay에서 모두 실행하고, 지원하는 주 프로세스의 Node 내장 `fetch`가 Replay에서
외부 endpoint를 0회 호출함을 먼저 검증한다. SQLite 영속 Store는 같은 계약의 후속 구현이며,
`node:sqlite` 채택과 최소 Node 상향은 저장소 전체에 영향을 주는 별도 런타임 ADR과 이슈 #228에서
결정한다. 이 ADR은 특정 저장 매체나 Node 상향을 Coordinator 구조의 선행 조건으로 만들지 않는다.
영속 Store의 경로와 마이그레이션 정책도 그 후속 결정에서 고정한다.

부모는 Store 쓰기 직전과 화면·리포트·번들·로그·오류 메시지로 내보내기 직전에 최신 노출 마스킹을
강제한다. Store에는 자식 Adapter가 최신 노출 마스킹을 적용해 보낸 interaction만 저장하며 원문은
저장하지 않는다. 세션 version으로 만든 canonical matching 데이터는 그보다 먼저 matchKey 계산에만
쓰고, 저장 outcome을 다시 matchKey 입력으로 사용하지 않는다. Replay는 의도적으로 이 마스킹된
저장 outcome을 복원하며 원문 복원을 보장하지 않는다는 제한은 ADR-0053을 따른다. 조회 중 최신 목록에
따른 추가 마스킹이 필요해도 반환값만 안전하게 만들고 Store 원본을 되쓰지 않는다. 저장본 변경은
사용자가 명시적으로 실행하는 세션 재마스킹 명령에서만 허용하며, 그 명령의 이름과 백업·실패 정책은
세션 관리 CLI 결정에서 정한다.

## 이유

Coordinator는 새로운 제품 기능이 아니라 프로세스 사이의 책임 경계다. 실제 외부 요청의 의미는
Adapter가 알고, 세션과 저장소의 의미는 부모가 안다. Engine과 Store를 부모에 두면 양쪽이 서로의
세부 구현을 알지 않아도 된다.

부모가 단일 저장 작성자이므로 occurrence와 transaction을 한곳에서 관리할 수 있다. 자식이
비정상 종료돼도 부모가 session을 failed로 마무리할 수 있고, dashboard나 후속 CLI가 세션을
조회할 때 자식 런타임의 저장 구현을 불러올 필요가 없다. 향후 Python·Go 어댑터도 같은 내부
프로토콜을 구현하면 동일 Engine과 Store를 사용한다.

로컬 HTTP는 named pipe나 추가 file descriptor보다 프로세스 기동 코드 변경이 적고 운영체제별
차이가 작다. 일반 forward proxy와 달리 실제 외부 트래픽을 중계하지 않으므로 HTTPS 인증서를
가로채지 않는다. loopback, 임시 token, 크기 상한으로 내부 endpoint의 범위를 제한한다.

저장 매체 선택을 Coordinator 책임 경계와 분리하면 Node 런타임 정책이 결정되는 동안에도 Node 20
인메모리 수직 기능으로 프로세스 경계와 지원하는 `fetch`의 Replay 외부 호출 0회를 검증할 수 있다.
이후 SQLite를 채택하더라도 Adapter와 Engine 계약은 바뀌지 않는다. 런타임 상향과 내장 모듈의
배포 비용은 저장소 전체 오너가 별도 ADR에서 판단한다.

## 결과

- Adapter 호출마다 loopback JSON 왕복 비용이 생긴다. 외부 HTTP 지연보다 작지만 Replay 성능
  검증에는 포함한다.
- Coordinator Client와 내부 프로토콜에 자체 schema version과 payload 상한이 필요하다.
- 부모가 먼저 Coordinator를 열고 마지막에 닫는 명시적 수명주기가 생긴다.
- `core`의 프로세스 실행·종료 구현은 재사용하되 External 의미를 `core`에 넣지 않는다.
- CLI는 기존 `connectStdio({ env })` 경계를 사용해 Bootstrap 설정을 주입한다.
- dashboard는 Coordinator를 직접 소유하지 않고 CLI의 실행 조립을 호출한다.
- SQLite를 채택할 경우 부모만 열며 자식에는 DB 경로나 라이브러리가 필요 없다.
- 인메모리 Store로 Node 20 최소 수직 기능을 먼저 검증하고, SQLite는 같은 Store 계약의 후속
  구현으로 교체한다.
- 세션을 소유하는 부모 경로에는 목록·삭제·명시적 재마스킹 명령이 후속으로 필요하다. 읽기 경로는
  이 명령을 대신해 저장본을 수정하지 않는다.
- 한 명령이 MCP 서버에 두 번 연결하는 `--determinism` 흐름과 External session의 조합은 H1·H2에서
  허용하지 않는다. 두 실행의 session 수명과 source 선택은 후속 CLI 결정에서 정한다.
- 복수 Adapter 핸드셰이크와 요청별 Adapter/version 불일치, 상속된 Node 손자의 fail-closed를
  프로토콜 테스트로 고정한다.
- 이 ADR 번호는 병합 직전에 다시 확인하고 충돌 시 파일명, 제목, 색인 링크를 함께 재번호한다.
