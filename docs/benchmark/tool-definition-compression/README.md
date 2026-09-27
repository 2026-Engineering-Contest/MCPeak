# 도구 정의 압축 실험 재료

`docs/2026-09-27-mcp-도구-정의-압축-조사-실험.md` 의 근거 데이터와 스크립트. 원본 `tools/list`
덤프(약 3MB)는 저장소에 넣지 않았다. `dump.mjs` 로 다시 뽑는다.

## 재현

```bash
mkdir exp && cd exp && npm init -y
npm install @modelcontextprotocol/sdk@1 ajv@8 ajv-formats gpt-tokenizer json-schema-faker
cp <이 디렉터리>/*.mjs . && cp -r <이 디렉터리>/gateB .
mkdir lists out
node dump.mjs notion npx -y @notionhq/notion-mcp-server      # 서버마다 한 번. 인증 필요 서버는 EXTRA_ENV 로 더미 값
node tok.mjs                                                  # 기준선 토큰
node transform.mjs                                            # 1차: 1·2단계 (SERVERS 상수 참조)
node stage3.mjs                                               # 1차: 3단계 손실 변형
node safe.mjs azure paypal ...                                # 2차: 안전 프로필
node gateA.mjs                                                # 스키마 동치
node gateC.mjs                                                # 검색 오염
node gateB/mkprompt.mjs && node gateB/mkprompt2.mjs           # 모델용 프롬프트 생성 → 모델에 넣고 답을 gateB/answer*.json 에 저장
node gateB/score.mjs && node gateB/score2.mjs                 # 채점
```

- `RESULTS.md`: 1·2차 결과 요약
- `report-tokens.json`, `safe-tokens.json`: 토큰 표 원자료
- `gateB/requests*.json`: 게이트 B 요청문. `gateB/answer*.json`: 하이쿠 응답 원문
- `per-tool.csv`: 15개 서버 411개 도구의 원본·안전·3단계 토큰. `pertool.mjs` 가 만든다. `instructions` 승격 분량은 더하지 않은 값
- 3차: `gateB/requests3.json`, `gateB/answer3-<server>-{orig-a,orig-b,safe}.json`, `gateB/score3.mjs`. `safe2.mjs` 는 `NO_PROMOTE=1` 로 문장 승격을 끈 변형, `safe2-tokens.json` 이 그 결과
- `exec-compare.mjs`: 게이트 B 호출을 로컬 서버에 실제로 넣어 원본·안전 응답을 비교. 결과는 `exec/exec-<server>.json`
