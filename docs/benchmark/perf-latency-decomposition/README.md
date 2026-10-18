# MCP 서버 지연 분해 실험 재료

`docs/2026-10-18-perf-지연-분해-방법론-조사-실험.md` 의 근거 스크립트와 결과표.
공개 MCP 서버 19개는 저장소에 넣지 않았다. 아래 순서로 다시 받는다.

```bash
mkdir servers && cd servers && npm init -y
npm install @h1deya/mcp-server-weather @upstash/context7-mcp @openbnb/mcp-server-airbnb \
  mcp-package-version @kazuph/mcp-fetch @pinkpixel/web-scout-mcp @professional-wiki/mediawiki-mcp-server \
  @tokenizin/mcp-npx-fetch fetch-mcp @kimtaeyoon83/mcp-server-youtube-transcript @cyanheads/pubmed-mcp-server \
  @pinkpixel/npm-helper-mcp @kazuph/mcp-github-pera1 github-repo-mcp npm-search-mcp-server open-meteo-mcp \
  hackernews-mcp wikipedia-mcp-server arxiv-mcp
cd .. && npm install @modelcontextprotocol/sdk@1       # 하네스용
node driver.mjs plans/weather.json out/weather.json     # 서버 하나 측정 (plans 의 경로는 ../servers 기준)
node analyze.mjs out/*.json                             # 집계표
```

| 파일 | 역할 |
|---|---|
| `preload.mjs` | `NODE_OPTIONS=--import` 로 서버에 주입. `globalThis.fetch`·`node:http`·undici 의 외부 호출 시각과 본문을 기록 |
| `driver.mjs` | SDK 클라이언트로 도구를 호출하고 호출 구간을 기록 |
| `analyze.mjs` | 호출 구간 안의 외부 호출을 모아 외부 대기·서버 처리·의존/독립을 집계 |
| `plans/` | 서버별 호출 계획 (도구와 입력) |
| `RESULTS-all.txt` | 19개 서버 최종 집계표. **node:http 경로의 extWait 은 헤더 수신 기준이라 과소, compute 는 과대다.** 보고서의 보정 참조 |
| `verification/` | 반박 팀이 만든 검증 스크립트. `t1-httpfinish.mjs`(finish 이벤트 시점 확인), `t2-docker-fanout.mjs`(팬아웃 효과), `t3-falsedep.mjs`(입력 반향 거짓 의존), `preload2~4.mjs`(본문 끝·http2·CPU 분리 관측), `mark.mjs`·`rdriver.mjs`(독립 계측), `fan.mjs`(요청 직접 재현) |

이 하네스는 조사용이다. 알려진 결함을 그대로 두었다. `preload.mjs` 의 node:http 종료 시각이 헤더 수신
시점이고, http2 채널을 구독하지 않으며, 요청 헤더를 기록하지 않는다. 제품 구현에서는 보고서의
"설계에 반영할 것" 을 따른다.
