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
- Adapter별 schema version 검증
- `protocol + matchKey + occurrence`의 저장·조회
- Session Store와 SQLite 연결
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
     └─ Session Store ── SQLite

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
- 요청·응답 크기에 고정 상한을 두며 초과는 실제 호출 우회가 아니라 명시적 실패다.
- Coordinator 연결 실패, 인증 실패, 알 수 없는 schema version은 fail-closed다.
- 내부 endpoint와 상태 코드는 공개 API가 아니며 동일 패키지 버전의 Bootstrap과 Coordinator만
  통신한다.

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

현재 session과 Replay source session의 선택은 bearer token에 연결된 부모 Coordinator 상태다.
그 식별자를 자식 설정에 중복 전달하지 않는다. SQLite 경로와 마이그레이션 정보도 자식에 전달하지
않는다. 기존 `NODE_OPTIONS`는 덮어쓰지 않고 `--import <bootstrap>`을 안전하게 병합한다. 훅과
Coordinator Client는 MCP stdio의 stdout에 아무것도 쓰지 않는다.

Session Store의 1차 구현은 Node 내장 `node:sqlite`를 사용한다. `node:sqlite`를 플래그 없이
사용할 수 있는 런타임을 기준으로 최소 Node 버전을 `22.13.0` 이상으로 올리는 것을 이 결정에
포함한다. Node 20 지원 종료와 CI·`engines.node` 변경은 구현 PR 전에 사용자 문서와 릴리스
영향을 함께 검토한다. 별도 native SQLite 의존성은 추가하지 않는다.

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

Node 최소 버전을 올리는 비용은 있다. 그러나 이미 종료된 런타임을 위해 native SQLite 의존성과
설치 실패 면을 새로 만드는 것보다, 0.x 단계에서 런타임 기준을 명확히 올리고 내장 모듈을 사용하는
편이 배포와 재현성이 단순하다.

## 결과

- Adapter 호출마다 loopback JSON 왕복 비용이 생긴다. 외부 HTTP 지연보다 작지만 Replay 성능
  검증에는 포함한다.
- Coordinator Client와 내부 프로토콜에 자체 schema version과 payload 상한이 필요하다.
- 부모가 먼저 Coordinator를 열고 마지막에 닫는 명시적 수명주기가 생긴다.
- `core`의 프로세스 실행·종료 구현은 재사용하되 External 의미를 `core`에 넣지 않는다.
- CLI는 기존 `connectStdio({ env })` 경계를 사용해 Bootstrap 설정을 주입한다.
- dashboard는 Coordinator를 직접 소유하지 않고 CLI의 실행 조립을 호출한다.
- SQLite는 부모만 열며 자식에는 DB 경로나 라이브러리가 필요 없다.
- 프로젝트의 최소 Node 런타임과 CI 매트릭스 변경이 후속 구현의 선행 조건이 된다.
- 이 ADR 번호는 병합 직전에 다시 확인하고 충돌 시 파일명, 제목, 색인 링크를 함께 재번호한다.
