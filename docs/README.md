# docs

문서는 패키지별 폴더로 나눠 둡니다. 패키지 소스 폴더(`packages/<이름>/`)는 그대로 두고, `docs/` 안에서만 나눕니다.

| 폴더 | 내용 |
|---|---|
| [adr/](./adr/) | 설계 결정 기록. 번호가 전역이라 한 곳에 둡니다. 색인의 「담당」 열이 패키지입니다. |
| [core/](./core/) | 프로토콜 클라이언트 · 트랜스포트 · 프로세스 수명주기 |
| [runner/](./runner/) | 명세 실행 · matcher · 리포터 |
| [generate/](./generate/) | 스키마에서 명세 생성 · AI provider 호출 |
| [record/](./record/) | External 세션 녹화 · 재생 · 마스킹 |
| [mock/](./mock/) | 목 서버 · 응답 주입 |
| [cli/](./cli/) | mcpeak 명령 진입점 · 시험 실행 · repair |
| [dashboard/](./dashboard/) | 로컬 웹 UI · analyze 화면 |
| [optimize/](./optimize/) | 도구 정의 압축 · 프록시 |
| [audit/](./audit/) | 사전 보안 점검 · 격리 실행 |
| [perf/](./perf/) | 도구 호출 지연 분해 |
| [release/](./release/) | npm 배포 · 버저닝 · 릴리스 워크플로 |
| [common/](./common/) | 특정 패키지에 속하지 않는 문서 (데모, 예제 서버 E2E, 경쟁 도구 비교, 벤치마크) |
| [assets/](./assets/) | 그림 파일 |

패키지 폴더 안은 다음과 같이 나눕니다.

- 폴더 바로 아래: 날짜가 붙은 설계·조사·인수인계 문서
- `specs/`: 설계 명세
- `plans/`: 구현 계획
- `reports/`: 작업 보고서
- `benchmark/`, `mockups/`: 실험 스크립트와 화면 목업

저장소 전체에 걸치는 문서는 여기 그대로 둡니다.

- [architecture.md](./architecture.md): 전체 구조와 병렬 작업 방식
- [adoption.md](./adoption.md): 도입 실적
- [task-integration-ledger.tsv](./task-integration-ledger.tsv): 작업 단위 통합 SHA 장부
