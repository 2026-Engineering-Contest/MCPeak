# MCPTox 재현율 측정: audit 의 desc 가족

`mcpeak audit` 의 정적 층(설명문 규칙, `desc/*`)이 공개 중독 도구 벤치마크를 얼마나 잡는지 잰다.
검토 문서(`docs/2026-10-03-audit-검사-목록-보강-검토.md` §5)의 "충분하다고 말할 수 없고 측정해야
한다" 에 대한 첫 실측이다. 이 값은 계획의 통과 조건이 아니라 **기록**이다. CI 에 넣지 않는다.

## 데이터

[MCPTox](https://github.com/zhiqiangwang4/MCPTox-Benchmark)(AAAI-26). 실제 MCP 서버 45개에 중독 도구를
심은 사례 집합이다. 저장소에 라이선스가 없어 **이 저장소에는 사례를 한 건도 넣지 않는다.** 측정할 때마다
`fetch.mjs` 가 임시 디렉터리에 받는다.

사례 단위는 `response_all.json` 의 `malicious_instance` 중 `wrong_data` 가 0 인 것이다. 논문이 집계한
1,312 사례가 이 집합이다. 각 사례의 `poisoned_tool`("Tool: <이름>\nDescription: <설명>")을 도구 하나로
만들어 `collectStrings` → `runDescRules` 에 넣는다. 서버 이름은 사례의 `server_name` 이다.

## 실행

```
pnpm build
node docs/benchmark/mcp-audit-recall/fetch.mjs            # 마지막 줄이 받은 경로
node docs/benchmark/mcp-audit-recall/measure.mjs <경로>    # 표. --json 이면 JSON
```

`measure.mjs` 는 빌드된 `packages/audit/dist` 를 읽는다. 규칙을 고친 뒤에는 다시 빌드한다.

## 판정

- **탐지**: 심각도가 medium 이상인 `desc` 발견이 하나라도 있는 사례. 종료 코드를 2 로 만드는 기준과 같다.
- **언급**: info 를 포함해 `desc` 발견이 하나라도 있는 사례. `desc/sensitive-path` 단독과
  `desc/cross-origin` 단독은 info 라 탐지로 세지 않는다.

같은 MCPTox 커밋과 같은 규칙이면 출력이 바이트까지 같다. 결과는 `RESULTS.md` 에 커밋 SHA 와 함께 적는다.

## 아직 재지 않은 것

검토 문서가 함께 재라고 한 회피 변형(arXiv 2605.24069 의 패러프레이즈·동형문자·base64·비영어)은 이
스크립트에 없다. 그 변형 집합은 받아 올 경로가 정해지지 않았다. 정밀도 기준(정상 서버 20개에서 발견 0)도
여기가 아니라 `packages/audit/tests/fixtures/benign/` 과 E2E 가 맡는다.
