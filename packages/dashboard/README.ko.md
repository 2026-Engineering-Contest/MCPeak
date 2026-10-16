[English](./README.md) · **한국어**

# @mcpeak/dashboard

MCP 서버 테스트 프레임워크 [MCPeak](https://github.com/2026-Engineering-Contest/MCPeak) 의 로컬 웹
UI 다. 명세를 고르고 실행하고, `generate` 의 승인 화면과 `repair` 확인을 브라우저에서 진행한다.

## 설치와 실행

```bash
npm install -g @mcpeak/dashboard
mcpeak-dashboard
```

```
대시보드: http://localhost:7357  (스위트 탐색 루트: /path/to/project)
```

명령을 실행한 디렉터리 아래에서 명세 파일을 찾는다. 목록이 비어 있으면 기동 시 찍힌 탐색 루트를
먼저 확인한다. 포트는 `--port` 로 바꾸고, `0` 이면 빈 포트를 자동으로 고른다.

## 화면

| 화면 | 하는 일 |
|---|---|
| 홈 | 찾은 명세 목록. 서버 실행 명령과 옵션을 채워 실행한다 |
| 실행 | 진행 중인 실행의 이벤트 스트림과 케이스별 결과 |
| 생성 마법사 | `generate` 의 대상 선택, 시험 실행, 승인 화면 |
| Repair 검토 | 실패한 실행의 번들로 원인 후보를 받고 검토한다 |
| 재생 | External 세션 녹화·재생 |
| 분석 | 토큰 탭은 [Optimize](https://2026-engineering-contest.github.io/MCPeak/ko/guide/optimize)의 압축 리포트, 보안 탭은 [Audit](https://2026-engineering-contest.github.io/MCPeak/ko/guide/audit)의 점검 결과 |
| 설정 | provider 와 model 등 |

## 판정은 CLI 와 같다

대시보드는 판정 로직을 따로 갖지 않는다. `@mcpeak/cli/commands` 가 공개하는 커맨드 함수를
그대로 부르고, 터미널 출력과 대화 입력 자리만 웹용 구현으로 바꿔 끼운다. 그래서 같은 명세를
CLI 로 돌리든 대시보드로 돌리든 결과가 같다. 판정 로직이 두 벌이면 언젠가 결과가 갈리고, 그날
사용자는 어느 쪽을 믿을지 알 수 없다. 배경은
[ADR-0046](../../docs/adr/0046-대시보드를-로컬-웹서버로-만든다.md)에 있다.

## 실행 환경

Node 22.18 이상.

## 문서

[대시보드 가이드](https://2026-engineering-contest.github.io/MCPeak/ko/guide/dashboard) ·
[MCPeak 문서](https://2026-engineering-contest.github.io/MCPeak/ko/)

## 라이선스

MIT
