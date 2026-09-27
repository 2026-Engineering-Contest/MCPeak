# MCP 도구 정의 압축 실험 (2026-09-27)

대상: npx 로 인증 없이 tools/list 를 뽑을 수 있는 공개 MCP 서버 5개.
토크나이저: gpt-tokenizer o200k_base (Anthropic 토크나이저 공개 안 됨, 근사치).
측정 단위: {name, description, input_schema} 를 compact JSON 으로 직렬화한 토큰 수 합계.

## 단계 정의
- 1단계 무손실: $schema/$id/title 제거, additionalProperties:true 제거, 빈 required 제거. 검증 의미 불변.
- 2단계 규칙 재작성: 설명에서 URL·예시 블록 제거, 이름을 되풀이하는 파라미터 설명 제거, 도구 25% 이상이 공유하는 문장을 instructions 로 승격.
- 3단계 손실: 2단계 + 스키마 안의 description·default·additionalProperties 전부 제거.

## 토큰
| server | tools | 원본 | 1단계 | 2단계 | 3단계 |
|---|---|---|---|---|---|
| notion | 24 | 17140 | 16168 (5.7%) | 16045 (6.4%) | 13712 (20.0%) |
| mongodb | 27 | 13648 | 13126 (3.8%) | 12394 (9.2%) | 3475 (74.5%) |
| firecrawl | 29 | 11458 | 11046 (3.6%) | 10737 (6.3%) | 8839 (22.9%) |
| desktop-commander | 26 | 11012 | 10604 (3.7%) | 6907 (37.3%) | 6713 (39.0%) |
| chrome-devtools | 30 | 5508 | 5023 (8.8%) | 4956 (10.0%) | 2671 (51.5%) |

## 게이트 A (ajv, json-schema-faker 표본 + 변이)
1·2단계: 11,316 표본 불일치 0. 3단계: additionalProperties 제거로 여분 필드 표본만 불일치(예상대로).

## 게이트 C (BM25, 질의=도구 이름 단어)
1·2단계에서 top1 적중·평균 순위·동반 형제 수 변화 없음(±0.07). 규칙 재작성이 어휘를 바꾸지 않아 오염도 그대로.

## 게이트 B (haiku, 서버당 요청 6개, 원본 vs 2단계 vs 3단계)
| server | 2단계 같은 도구 | 3단계 같은 도구 | 비고 |
|---|---|---|---|
| notion | 6/6 | 6/6 | 3단계에서 query-data-source 의 filter 를 못 만들어 생략 |
| mongodb | 6/6 | 6/6 | 인자까지 동일 |
| firecrawl | 6/6 | 6/6 | extract 자유형 스키마만 표현 차이 |
| desktop-commander | 6/6 | 6/6 | 3단계에서 default 가 사라져 origin:"llm" 을 매번 명시(값은 기본값과 동일) |
| chrome-devtools | 6/6 | 5/6 | 3단계에서 navigate_page 대신 new_page 선택. 파라미터 설명 제거의 부작용 |

# 2차 실험: 안전 프로필 (2026-09-27)

안전 프로필 = 1단계 무손실 + 2단계(중복 문장 승격·URL/예시 제거·이름 되풀이 설명 제거) + 2b(3개 이상 도구에 반복되는 파라미터 설명을 instructions 사전으로).
대상: 1차에 안 쓴 서버 10개.

| server | tools | 원본 | 안전 | 감소 | 게이트 A | 게이트 B 같은 도구 | 인자까지 동일 |
|---|---|---|---|---|---|---|---|
| azure | 71 | 13959 | 8159 | 41.6% | 0/5820 | 6/6 | 2/6 (intent 자유문·parameters 키 표기 차이, 둘 다 유효) |
| paypal | 28 | 9634 | 8839 | 8.3% | 0/2352 | 6/6 | 5/6 (원본·안전 모두 같은 2건이 스키마 위반: get_order·create_refund 의 ID 가 요청문의 placeholder 라 pattern 제약에 안 맞음. 압축과 무관) |
| hubspot | 21 | 8431 | 7599 | 9.9% | 0/1704 | 6/6 | 5/6 (이름 분리 방식 차이) |
| sentry | 9 | 5492 | 5013 | 8.7% | 0/912 | 6/6 | 5/6 (자유문 query 차이) |
| kubernetes | 23 | 5088 | 4644 | 8.7% | 0/2652 | 6/6 | 6/6 |
| apify | 10 | 4791 | 4333 | 9.6% | 0/744 | 6/6 | 5/6 (limit 선택 인자 추가) |
| supabase | 29 | 4165 | 3634 | 12.7% | 0/1656 | 6/6 | 5/6 (SQL 타입 표기 차이) |
| playwright | 25 | 3708 | 3044 | 17.9% | 0/1728 | 6/6 | 6/6 |
| github-legacy | 26 | 3546 | 2910 | 17.9% | 0/2496 | 6/6 | 5/6 (리뷰 body 자유문) |
| playwright-ea | 33 | 2918 | 2789 | 4.4% | 0/2172 | 6/6 | 6/6 |

게이트 C: 10개 서버 모두 top1 적중·평균 순위 변화 없음 또는 소폭 개선(kubernetes 20→21, apify 8→9, supabase 26→27, github 25→26). 동반 형제 수 불변.
합계: 60/60 같은 도구. 인자 차이는 전부 자유 텍스트 필드나 선택 인자의 표현 차이이며 스키마 위반을 새로 만든 경우는 0.

# 3차 실험: 안전 프로필, 새 서버 20개, 기준 편차 측정 (2026-09-28)

대상 20개: postman(204), browserstack(46), git-cyan(28), antv-chart(27), astra(19), airtable(16), filesystem(14), circleci(13), mastra-docs(13), everything(13), browsermcp(12), line(12), hyperbrowser(10), shadcn(10), pinecone(9), netlify(9), browserbase(9), memory(9), slack-legacy(8), google-maps(7).
조건: 원본 정의 2회(a, b), 안전 프로필 1회. 서버당 요청 6개, 하이쿠. 게이트 A 전 서버 불일치 0(표본 38,712).

## 게이트 B 합계 (120건)
| 비교 | 같은 도구 | 인자까지 동일 |
|---|---|---|
| 원본a vs 원본b (기준 편차) | 116/120 | 100/120 |
| 원본a vs 안전 | 111/120 | 100/120 |

## 도구가 달라진 9건의 분류
| 서버 | n | 원본a / 원본b / 안전 | 분류 |
|---|---|---|---|
| browserstack | 2 | getFailureLogs / listSessions / askBrowserStackAI | 기준 편차 안 (원본끼리도 다름) |
| browserstack | 5 | null / listTestIds / listTestIds | 기준 편차 안 |
| netlify | 6 | null / updater / updater | 기준 편차 안 |
| netlify | 5 | null / null / netlify-coding-rules | 안전이 개선 |
| mastra-docs | 2 | mastraDocs / mastraDocs / searchMastraDocs | 동등한 대안 ("검색" 요청에 검색 도구) |
| astra | 6 | HybridSearch(queryVector:[]) / 같음 / null | 모호. 원본 호출은 빈 벡터라 실제로는 실패할 호출 |
| **browserstack** | **3** | createTestCase / createTestCase / askBrowserStackAI | **승격 결함**. "프로젝트 ID 없으면 askBrowserStackAI 먼저" 문장이 서버 전역으로 승격되자 모델이 전 요청에 적용 |
| **circleci** | **1, 2** | get_latest_pipeline_status / 같음 / null | **승격 결함**. 목록형 설명에서 공유 문장을 뽑아내자 "* Project URL:" 같은 빈 조각만 남아 설명이 읽히지 않음. 승격된 1,642자에 조건문 11개 |

압축이 만든 실제 퇴행은 3건(2.5%)이고 전부 "중복 문장 승격" 단계에서 나왔다. 1단계 무손실, 잡음 제거, 공통 파라미터 승격(2b)은 도구 선택을 바꾸지 않았다.

## 승격 단계의 두 결함
1. 문장 분리기가 목록·개조식 설명에서 공유 문장을 뽑아내면 조각이 남아 설명이 깨진다.
2. 다른 도구 이름을 언급하거나 조건문(if/must/never)이 들어간 문장은 도구 한정 지침이다. 서버 전역으로 올리면 모델이 모든 도구에 적용한다.

## 승격을 뺀 안전 프로필의 절감 (35개 서버 합계)
| 프로필 | 원본 합계 | 결과 | 감소 |
|---|---|---|---|
| 1 + 잡음 제거 + 2b + 문장 승격 | 286,884 | 241,412 | 15.9% |
| 1 + 잡음 제거 + 2b (승격 제외) | 286,884 | 247,070 | 13.9% |

승격 제외 시 서버별 감소: 최소 0.9%, 중앙값 12.2%, 최대 37.5%. 승격이 크게 기여하던 서버는 azure(41.6→22.8), circleci(34.9→21.7), desktop-commander(37.3→30.5), browserstack(12.5→8.3) 넷뿐이다.

## 실행 비교 (인증 없이 로컬에서 도는 서버 5개)
게이트 B의 호출을 원본 서버에 실제로 넣어 원본 조건과 안전 조건의 응답을 비교했다.
| 서버 | 호출 | 응답 동일 | 성공/실패 동일 | 비고 |
|---|---|---|---|---|
| filesystem | 6 | 6 | 6 | |
| everything | 6 | 6 | 6 | |
| memory | 6 | 6 | 6 | |
| git-cyan | 6 | 6 | 6 | 양쪽 모두 6건 검증 오류(작업 디렉터리 세션 미설정). 오류 본문까지 동일 |
| mastra-docs | 6 | 2 | 5 | 인자 표현 차이("./" vs ".", 경로 목록)와 n2 도구 차이가 응답 차이로 이어짐 |
