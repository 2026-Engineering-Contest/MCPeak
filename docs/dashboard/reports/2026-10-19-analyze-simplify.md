# analyze-simplify 보고서: 점검 옵션 제거, 카드 줄 제거, 안전 구획 (2026-10-19)

ADR-0117 의 세 결정을 `packages/dashboard` 에 구현했다. 실행 모델 `claude-fable-5-1`, 추론 수준 high,
서브에이전트 없음. 기점 `14c722fb`, 브랜치 `feat/analyze-simplify`.

## 1. 작업 공간

| 항목 | 값 |
|---|---|
| pwd | `/Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/analyze-simplify` |
| 브랜치 | `feat/analyze-simplify` |
| `git rev-parse HEAD` (작업 전, 커밋 없음) | `14c722fbe6c57026890470053be0951bff964ac3` |

## 2. 바꾼 파일

생성
- `packages/dashboard/src/server/passed-rules.ts` (`passedRules`, `RULE_CATALOG_KEYS`, `ruleCatalog`)
- `packages/dashboard/tests/passed-rules.test.ts`
- `packages/dashboard/web/src/analyze/PassedChecks.tsx` (안전 구획, `groupByFamily`, `NO_PASSED_CHECKS`)
- `packages/dashboard/web/src/analyze/PillarBadge.tsx` (`PillarCard.tsx` 에서 옮김)
- `packages/dashboard/web/src/analyze/sandbox-hint.ts` (`REMOTE_SANDBOX_HINT` 를 `SecurityOptions.tsx` 에서 옮김)
- `docs/adr/0117-analyze-는-점검-옵션-없이-격리를-자동으로-시도하고-서버-선택-뒤-축-카드로-결과를-고른다.md` (§7 에서 제목을 바꿔 파일 이름도 바꿨다)
- 이 보고서

삭제 (`git rm`)
- `packages/dashboard/web/src/analyze/SecurityOptions.tsx`
- `packages/dashboard/web/src/analyze/PillarCard.tsx`
- `packages/dashboard/web/src/analyze/types.ts` (`AnalyzePillar`·`AnalyzePillarId`)

수정
- `packages/dashboard/src/api-types.ts`: `PassedRule` 추가, `AnalyzeSecurityResponse.passedRules` 추가. 다른 필드 그대로
- `packages/dashboard/src/server/analyze-security.ts`: 응답 본문에 `passedRules: passedRules(report, ruleCatalog(audit))`
- `packages/dashboard/web/src/screens/AnalyzeView.tsx`: prop 없음. PageHeader → TargetBar → 보안 상세 → 비용 최적화
  상세. 두 상세는 `<section aria-labelledby>` + h2(id) + 판정 배지. 보안 상세 결과 아래 `PassedChecks`. `IDLE_DETAIL`
  문장을 "분석하기" 로
- `packages/dashboard/web/src/analyze/TargetBar.tsx`: `form`·`onFormChange` 제거, `SecurityOptions` 구획과 접힌 바의
  "보안 옵션" 칸 제거, 버튼 "분석하기"
- `packages/dashboard/web/src/analyze/build-analyze-requests.ts`: `buildAnalyzeRequests(target)`. 보안 요청은
  `buildSecurityRequest(argv, serverId, transport, INITIAL_SECURITY_FORM)`. try/catch 갈래 제거(기본 폼은 던지지 않는다)
- `packages/dashboard/web/src/analyze/pillars.ts`: `PILLARS`·`PillarDescriptor`·`AnalyzePillarId` import 제거. 요약 함수와
  `PillarSummary` 는 그대로
- `packages/dashboard/web/src/analyze/pillar-state.ts`: `firstLine` 제거(카드만 쓰던 것)
- `packages/dashboard/web/src/App.tsx`: 라우트 `{ screen: "analyze" }` 하나, `parseRoute` 가 `#/analyze` 뒤 세그먼트를
  무시, 머리 주석 라우트 표 갱신, `AnalyzePillar` import 제거
- `packages/dashboard/web/src/screens/PreCheck.tsx`: import 경로 한 줄(`sandbox-hint.js`). biome 이 import 정렬로 줄
  위치만 옮겼다
- 테스트: `tests/analyze-security.test.ts`, `tests/routes.test.ts`(SECURITY_BODY 에 `passedRules: []`),
  `web/tests/analyze-fixture-data.ts`, `web/tests/analyze-fixtures.tsx`, `web/tests/analyze-view.test.tsx`,
  `web/tests/security-detail.test.tsx`, `web/tests/analyze-pillars.test.ts`, `web/tests/build-analyze-requests.test.ts`,
  `web/tests/app.test.ts`, `web/tests/precheck.test.tsx`(import 경로 + 픽스처 `passedRules: []`),
  `web/tests/security-view.test.ts`(픽스처 `passedRules: []`)
- `docs/adr/README.md`: 0117 한 줄. `docs/adr/0116-*.md`: 상태 줄 끝에 "카드 부분은 ADR-0117 이 대체한다."
- `.changeset/analyze-pillars-dashboard.md`: 새 화면 설명으로 본문 교체. minor 유지

## 3. 검증

worktree 루트에서 순서대로.

| 명령 | 결과 |
|---|---|
| `pnpm build --force` | `Tasks: 9 successful, 9 total`, `Cached: 0 cached, 9 total` |
| `pnpm typecheck --force` | `Tasks: 9 successful, 9 total`, `Cached: 0 cached, 9 total` |
| `pnpm lint` | `Checked 730 files`, errors 0, warnings 15(전부 기존 코드) |
| `pnpm test` | `Test Files 239 passed (239)`, `Tests 5533 passed \| 25 skipped (5558)` |
| web 만 (`vitest run --config packages/dashboard/web/vite.config.ts`) | `Test Files 61 passed`, `Tests 932 passed` |
| `grep -rn "PillarCard\|SecurityOptions\|한 번에 분석\|role=\"tablist\"" packages/dashboard/web/src` | 비어 있음 |
| 대시 검사 | diff 의 추가 줄과 새 파일 전부에서 U+2014 0건 |
| 특수 문자 | `web/src` 에 U+2713(✓) 없음(배지 "해당 없음" 으로 바꿨다). `analyze-pillars.test.ts` 의 U+2212 3개는 기존 그대로 |

`pnpm test` 출력에 "1 failed (1 total)" 네 줄이 보이는데, 이것은 CLI 실패 렌더링을 단언하는 테스트가 찍는 샘플
출력이다(`seoul-weather` 케이스). 러너의 판정은 위 Test Files 줄이다.

## 4. 테스트 변경

### 지운 테스트
- `security-detail.test.tsx`: "점검 옵션을 요청 본문의 필드로 싣는다", "기준 파일 경로가 비면 갱신 체크박스가 비활성이다",
  "http 대상이면 격리 체크박스가 비활성이고 이유를 보인다", "격리를 켜면 실행할 수 있는 명령을 말한다",
  "허용 호스트 입력은 자기 문장을 쓴다", "기준 파일을 보냈으면 그 상태를 한 줄로 보인다"(기준 파일 입력이 없어졌다),
  "상세를 바꿔도 입력한 서버가 남는다"(상세 전환이 없어졌다), "상세를 닫은 채 run 이 끝나도 보안 카드가 요약을 보인다"
  (카드 집계만 단언)
- `analyze-view.test.tsx`: "처음에는 대상 폼이 펼쳐져 있고 세 카드가 idle 이다", "성능 카드는 비활성이고 눌러도 해시가
  바뀌지 않는다", "기준 파일이 .json 이 아니면 버튼이 비활성이고 그 사유를 보인다", "카드를 누르면 해시가 바뀐다",
  "pillar 가 tokens 면 비용 상세가 펼쳐지고 카드는 선택 상태다"
- `build-analyze-requests.test.ts`: "기준 파일이 .json 이 아니면 그 문장이다"
- `analyze-pillars.test.ts`: `PILLARS` describe("순서가 보안, 비용 최적화, 성능 효율성이고 성능만 비활성이다"),
  `firstLine` describe("첫 줄만 돌려주고 CR 은 지운다")
- `app.test.ts`: "#/analyze 는 분석 화면을 열고 상세 없이 축 카드 셋을 보인다", "#/analyze/security 는 보안 상세를 연다",
  "#/analyze/tokens 는 비용 상세를 연다", "#/analyze/performance 는 개요로 연다"

### 옮긴 테스트 (카드 단언 → 상세 구획의 배지·본문)
- `analyze-view.test.tsx`: "첫 후보가 초기 선택이고 한 번에 분석이 두 요청을 같은 틱에 보낸다" → "…분석하기가…";
  "토큰 응답이 오면 비용 카드가 요약을 보이고 보안 카드는 점검 중이다" → "토큰 응답이 오면 비용 최적화 상세가 판정 배지와
  결과를 보이고 보안 상세는 점검 중이다"; "토큰이 실패해도 보안은 점검 중이고 비용 카드는 실패와 첫 줄을 보인다" →
  "…비용 최적화 상세는 실패 배지와 문장 전문을 보인다"; "둘 다 시작에 실패하면 대상 영역은 펼친 채고 두 카드가 실패다" →
  "…두 상세가 실패다"; "분석이 도는 동안 한 번에 분석은 비활성이고…" → "…분석하기는 비활성이고…"; "같은 응답을 다시
  받아도 카드 글자가 같다" → "같은 응답을 다시 받아도 비용 최적화 상세의 글자가 같다". 이름은 그대로이고 단언만 옮긴 것:
  "하나라도 시작되면 대상 영역이 접히고 대상 바꾸기가 펼친다"(보안 옵션 칸 단언 제거), "보안이 먼저 시작되면 토큰 응답
  전에도 대상 영역이 접힌다", "다시 분석을 누르면 같은 argv 로…", "다시 분석이 실패하면 상세에 머물고 CLI 문장을 보인다"
- `security-detail.test.tsx`: "한 번에 분석이 보안 본문을 POST 하고 이벤트 스트림을 연다" → "분석하기는 보안 본문에
  argv·serverId 만 싣는다"; "run 이 없다고 확인되면 카드가 실패이고 대상 영역은 접힌 채다" → "run 이 없다고 확인되면 보안
  상세가 실패 배지와 문장 전문을 보이고 대상 영역은 접힌 채다"; "done 뒤 결과를 읽으면 카드가 요약을 보이고 상세에 결과가
  있다" → "done 뒤 결과를 읽으면 보안 상세가 판정 배지와 결과를 보인다"; "GET 결과가 실패하면 보안 카드가 실패이고 상세에
  문장 전문이 있다" → "GET 결과가 실패하면 보안 상세가 실패 배지와 문장 전문을 보인다"; "첫 시작 요청이 실패하면 보안
  카드가 실패이고 첫 줄을 보인다" → "첫 시작 요청이 실패하면 보안 상세가 실패 배지와 문장 전문을 보인다"; "결과 뒤 대상
  바꾸기를 누르면 폼이 펼쳐지고 보안 옵션과 결과가 남는다" → "…폼이 펼쳐지고 결과가 남는다". 이름 그대로, 진입 줄과
  `securityCard()` → `securityDetail()` 만 바꾼 것: "run 조회만 실패하면…", "진행 문장을 로그 패널에 보인다", "점검 중에
  대상 바꾸기를 누르면…"("전부" 옵션 단언 제거), "다시 점검은 sent 요청을…", "다시 점검의 시작 요청이 실패하면…"
- `security-detail.test.tsx` 의 두 기존 상세 테스트는 비용 최적화 상세가 늘 함께 보여 범위를 좁혔다: "발견은 심각도
  배지·규칙·위치·메시지·해결을 보인다"(h3 목록을 `within(securityDetail())` 로. 비용 상세의 h3 "MCP 수정하기" 가 섞인다),
  "limits 와 CLI 리포트 원문을 보인다"("CLI 리포트 원문" 펼침이 두 상세에 하나씩 있다)
- `app.test.ts`: "#/analyze 는 분석 화면을 열고 두 상세를 함께 보인다", "옛 주소 %s 도 같은 화면을 연다"
  (`#/analyze/security`·`#/analyze/tokens`·`#/analyze/performance` 세 건)
- `build-analyze-requests.test.ts`: "둘 다 되면 토큰은 argv·serverId, 보안은 buildSecurityRequest 결과다" → "대상이 되면
  토큰은 argv·serverId, 보안도 argv·serverId 뿐이다"

### 새 테스트
- `tests/passed-rules.test.ts`: "발견도 건너뜀도 없으면 카탈로그 전부가 통과다", "skipped 에 있는 family 의 규칙은 통과가
  아니다", "findings 에 있는 ruleId 는 빠지고 같은 family 의 다른 규칙은 남는다", "같은 ruleId 의 발견이 여럿이어도 한 번만
  뺀다", "순서는 카탈로그 순서이고 findings 순서와 무관하다", "같은 입력이면 JSON.stringify 가 같다", "결과에는
  id·family·summary 만 있다", "audit 가 공개하는 RULES 상수를 정한 순서대로 이은 것이다", "실제 카탈로그로도 skipped
  family 는 통째로 빠진다"
- `tests/analyze-security.test.ts`: "passedRules 는 발견·건너뜀에 걸리지 않은 규칙을 audit 카탈로그 순서로 싣는다"
- `analyze-view.test.tsx`: "보안 상세와 비용 최적화 상세가 처음부터 함께 보이고 카드 줄은 없다"
- `security-detail.test.tsx`: "처음에는 대상 폼만 펼쳐져 있고 점검 옵션이 없다", "접힌 바에 보안 옵션 칸이 없다",
  "안전 구획은 passedRules 를 family 별로 보이고 건수를 센다", "검사 항목 목록은 처음에 접혀 있다", "passedRules 가 비면
  한 줄 안내를 보인다", "안전 구획의
  글자를 HTML 로 해석하지 않는다"
- `build-analyze-requests.test.ts`: "직접 입력 갈래면 serverId 키 자체가 없다"

## 5. 임의로 판단한 것

1. **카탈로그는 상수가 아니라 `ruleCatalog(audit)` 함수다.** 사양은 "카탈로그 상수(위 상수들을 이은 것)" 라 했지만
   `analyze-security.ts` 는 `@mcpeak/audit` 를 동적 import 로만 읽고(CLI `audit-command.ts` 와 같은 이유. 값으로 정적
   import 하면 서버 시작 때 audit 전체가 로드되고 `ANALYZE_RUNTIME_UNAVAILABLE` 갈래와 테스트 fake 계약이 깨진다),
   대시보드 `src/` 어디에도 audit 값 import 가 없다. 그래서 상수 **이름** 목록 `RULE_CATALOG_KEYS` 를 두고 읽어 둔 모듈을
   받아 잇는다. 순서는 사양의 나열 순서 그대로다. 정적 상수가 더 낫다고 보면 `passed-rules.ts` 한 파일만 바꾸면 된다.
2. **`precheck.test.tsx` 에 import 경로 외에 한 줄을 더 고쳤다.** 그 파일의 `securityResponse` 픽스처가
   `AnalyzeSecurityResponse` 리터럴이라 `passedRules: []` 없이는 타입체크가 깨진다. "필드 추가로 깨지는 픽스처는 필드를
   채운다" 쪽을 따랐다. 화면 코드 `PreCheck.tsx` 는 import 한 줄뿐이고, biome 가 정렬 위치만 옮겼다.
3. **지운 테스트 중 사양 목록에 없던 것 셋**: "기준 파일을 보냈으면 그 상태를 한 줄로 보인다"(기준 파일 입력이 없다),
   "상세를 바꿔도 입력한 서버가 남는다"(상세 전환이 없다), "상세를 닫은 채 run 이 끝나도 보안 카드가 요약을 보인다"
   (카드 집계만 단언. 결과 도착 자체는 "done 뒤 결과를 읽으면…" 이 본다).
4. **안전 구획의 자리**: `SecurityResult`(한계 구획·CLI 원문 펼침으로 끝난다) 바로 아래, "다시 점검" 버튼 위. 테스트가
   DOM 순서로 단언한다. `SecurityResult` 안으로 넣지 않았다. 사용자 모드 `PreCheck` 가 같은 컴포넌트를 쓰고 그 화면은
   바뀌지 않아야 하기 때문이다.
5. **family 표시 이름은 family 문자열 그대로**(`desc`, `result` …). `security-view.ts`·`risk-text.ts` 에 family 의 한국어
   이름 표가 없다(`RISK_BY_FAMILY` 는 위험 설명 문장이다). CLI `report.ts` 도 `skipped.family` 를 그대로 찍는다.
   "검사하지 않은 것" 구획과 같은 mono 글씨다.
6. **안전 구획의 문구(오케스트레이터 지시, 실서버 확인 후)**: 규칙 summary 가 탐지 대상 서술이라 "✓ 설명에 지시가 있다"
   처럼 정반대로 읽혔다. ✓ 를 지우고 줄마다 "해당 없음" 배지(`PillarBadge`, done 톤)를 앞세우며, 제목 아래 "아래 항목을
   검사했고 해당하는 것이 없었습니다." 한 줄을 늘 보이고, 목록은 `<details>` "검사 항목 N건 보기" 로 기본 접힘이다.
7. `build-analyze-requests.ts` 의 try/catch 를 뺐다. 기본 폼(`INITIAL_SECURITY_FORM`)으로는 `buildSecurityRequest` 가
   던질 갈래가 없다.
8. `PillarSummary` 의 `headline`·`bar`·`chips`·`foot` 와 그 테스트는 남겼다. 화면은 `verdict` 만 쓰지만 사양이 요약 함수를
   남기라 했고, 계약을 줄이는 것은 이 변경의 목적이 아니다.
9. `analyze-security-e2e.test.ts`(직렬 E2E)는 손대지 않았다. `passedRules` 단언은 유닛(`analyze-security.test.ts`)이
   실제 `@mcpeak/audit` 카탈로그로 본다.

## 6. 남은 위험

- 실환경(브라우저) 확인을 하지 않았다. C3 보고서처럼 `pnpm dashboard` 로 띄워 두 상세의 배치·배지·안전 구획을 눈으로
  봐야 한다(오케스트레이터가 live-weather-server 로 안전 구획은 확인했고 그 결과로 문구·접힘을 바꿨다).
- 격리 없는 점검이 서버 코드를 사용자 머신에서 그대로 실행한다(ADR-0117 결과). 대시보드 화면에 그 사실을 말하는 문장은
  없다. 필요하면 보안 상세 머리나 `limits` 줄에 더한다.
- `#/analyze/<segment>` 가 전부 같은 화면이라 잘못된 주소도 조용히 열린다. 의도한 동작(옛 링크 유지)이지만 리다이렉트도
  정규화도 없다.

## 7. 두 단계 흐름·카드 복원

사용자 결정으로 §1~§6 의 "카드 줄 제거·두 상세 상시 펼침" 을 버리고, 카드 구조(ADR-0116)를 되살린 위에 서버 선택 →
결과 두 단계를 얹었다. 점검 옵션 제거, "분석하기", `passedRules`·`PassedChecks`, `sandbox-hint.ts`, `PillarBadge.tsx`
는 그대로다. 같은 worktree, 커밋 없음. 실행 모델 `claude-opus-5-5`, 추론 수준 high, 서브에이전트 없음.

### 7.1 화면

- 서버 선택 단계: 두 축 상태가 모두 idle 이면 `PageHeader` 와 대상 영역(접속 폼·"분석하기")뿐이다. 카드 줄·상세·빈 안내가
  없다. 라우트가 `#/analyze/security` 여도 상세를 그리지 않고 해시는 그대로다.
- 결과 단계: 어느 축이든 idle 을 벗어나면 대상 영역(성공 시작 뒤에는 접힌 바) 아래 카드 셋, 라우트에 축이 있으면 그 아래
  상세. 둘 다 시작에 실패해도 결과 단계이고 카드가 실패를 보인다(대상 영역은 펼친 채). 대상 바꾸기로 폼을 펼쳐도 카드는 남는다.
- `PageHeader` 설명은 14c722fb 의 것으로 되돌렸다.
- 보안 카드 칩: 다섯 칩 뒤에 `안전 N`(done 톤). 보안 상세: 안전 구획이 발견 목록 바로 다음, 권한 조합 경고·"검사하지 않은
  것" 위다.

### 7.2 바꾼 파일

되살림(14c722fb 에서 `git show` 로 가져와 고침)
- `packages/dashboard/web/src/analyze/PillarCard.tsx`: `PillarBadge`·`TONE_STYLE` 정의를 빼고 `PillarBadge.tsx` 에서 import.
- `packages/dashboard/web/src/analyze/types.ts` (`AnalyzePillar`, `AnalyzePillarId`), 원문 그대로.
- `packages/dashboard/web/src/analyze/pillar-state.ts` (`firstLine` 포함), 원문 그대로.
- `packages/dashboard/web/src/analyze/pillars.ts`: `PILLARS`·`PillarDescriptor` 복원, `securitySummary` 칩에 `안전` 추가.
- `packages/dashboard/web/src/App.tsx`: `parseRoute` 의 `pillar`, `AnalyzeView pillar` 복원. 라우트 표 주석에 단계 설명.

수정
- `packages/dashboard/web/src/screens/AnalyzeView.tsx`: 14c722fb 구조 + 옵션 제거 + `hasResults` 단계 판정.
- `packages/dashboard/web/src/analyze/SecurityResult.tsx`: 선택 prop `passedChecks?: ReactNode` 를 발견 목록 다음 자리에 끼운다.
- `packages/dashboard/web/src/analyze/PillarBadge.tsx`: `TONE_STYLE` 을 export(카드의 칩·막대가 쓴다), 주석.
- 테스트: `analyze-fixtures.tsx`(`showDetail`·`securityCard`·`costCard` 복원, `securityDetail`·`costDetail` 은 펼친
  `tabpanel` 을 id 로 찾는다), `analyze-view.test.tsx`, `security-detail.test.tsx`, `app.test.ts`, `analyze-pillars.test.ts`,
  `precheck.test.tsx`.
- 문서: ADR-0117(본문 개정, 파일 이름 변경), `docs/adr/README.md` 0117 줄, ADR-0116 상태 줄("ADR-0117 이 두 단계 흐름을
  더한다."), `.changeset/analyze-pillars-dashboard.md`, 이 보고서.

손대지 않음: `TargetBar.tsx`(앞 작업의 접힌 바 그대로), `build-analyze-requests.ts`(`describeTarget` 이 이미 있다),
`PassedChecks.tsx`, `sandbox-hint.ts`, 서버 쪽 전부.

### 7.3 테스트 이름 변화 (14c722fb 기준)

되살린 것(§4 에서 지웠던 것)
- `security-detail.test.tsx`: "상세를 바꿔도 입력한 서버가 남는다", "상세를 닫은 채 run 이 끝나도 보안 카드가 요약을 보인다",
  카드 단언으로 돌아간 "run 이 없다고 확인되면 카드가 실패이고 대상 영역은 접힌 채다", "done 뒤 결과를 읽으면 카드가 요약을
  보이고 상세에 결과가 있다", "GET 결과가 실패하면 보안 카드가 실패이고 상세에 문장 전문이 있다", "첫 시작 요청이 실패하면
  보안 카드가 실패이고 첫 줄을 보인다"
- `analyze-view.test.tsx`: "성능 카드는 비활성이고 눌러도 해시가 바뀌지 않는다", "카드를 누르면 해시가 바뀐다", "토큰 응답이
  오면 비용 카드가 요약을 보이고 보안 카드는 점검 중이다", "토큰이 실패해도 보안은 점검 중이고 비용 카드는 실패와 첫 줄을
  보인다", "같은 응답을 다시 받아도 카드 글자가 같다"
- `analyze-pillars.test.ts`: "firstLine > 첫 줄만 돌려주고 CR 은 지운다", "PILLARS > 순서가 보안, 비용 최적화, 성능 효율성이고
  성능만 비활성이다"

바꾼 것(14c722fb 이름 → 지금 이름)
- "처음에는 대상 폼이 펼쳐져 있고 세 카드가 idle 이다" → "처음에는 서버 선택과 분석하기만 있고 카드·상세가 없다"
- "첫 후보가 초기 선택이고 한 번에 분석이 두 요청을 같은 틱에 보낸다" → "… 분석하기가 두 요청을 같은 틱에 보낸다"
- "분석이 도는 동안 한 번에 분석은 비활성이고 …" → "분석이 도는 동안 분석하기는 비활성이고 …"
- "둘 다 시작에 실패하면 대상 영역은 펼친 채고 두 카드가 실패다" → "둘 다 시작에 실패해도 카드 단계로 가서 두 카드가 실패다"
- "pillar 가 tokens 면 비용 상세가 펼쳐지고 카드는 선택 상태다" → "pillar 가 tokens 면 비용 상세가 카드 아래 펼쳐지고 카드는
  선택 상태다"(결과 단계에서 연다. idle 안내 단언은 뺐다)
- "처음에는 대상 폼과 보안 옵션이 펼쳐져 있다" → "처음에는 대상 폼만 펼쳐져 있고 점검 옵션이 없다"
- "한 번에 분석이 보안 본문을 POST 하고 이벤트 스트림을 연다" → "분석하기는 보안 본문에 argv·serverId 만 싣는다"
- "결과 뒤 대상 바꾸기를 누르면 폼이 펼쳐지고 보안 옵션과 결과가 남는다" → "… 결과와 상세가 남는다"
- "발견 0 이면 … 칩은 다섯 개가 0 이다" → "… 칩은 여섯 개가 0 이다"
- `app.test.ts`: "#/analyze 는 분석 화면을 열고 상세 없이 축 카드 셋을 보인다" → "#/analyze 는 분석 화면을 서버 선택 단계로
  열고 카드·상세가 없다". "#/analyze/security 는 보안 상세를 연다", "#/analyze/tokens 는 비용 상세를 연다",
  "#/analyze/performance 는 개요로 연다" → `it.each` "서버 선택 단계에서 %s 여도 상세가 없고 주소는 그대로다"(세 주소)

새로 넣은 것
- `analyze-view.test.tsx`: "분석하기를 누르면 카드 셋이 나타나고 대상 영역이 접힌다", "1단계에서 #/analyze/security 여도
  상세가 없다", "1단계에서 pillar 가 있던 채로 분석하기를 누르면 그 상세가 펼쳐진다"
- `security-detail.test.tsx`: "접힌 바에 보안 옵션 칸이 없다"(§4 의 것 유지), "보안 상세에서 안전 구획이 검사하지 않은 것보다
  앞에 있다", "보안 카드에 안전 칩이 passedRules 수를 보인다". §4 의 안전 구획 네 건은 유지(첫 건의 "결과 아래, 다시 점검
  위" 순서 단언은 새 순서 테스트로 옮겼다).
- `app.test.ts`: "결과 단계에서 #/analyze/security 로 가면 보안 상세가 카드 아래 펼쳐진다"(`parseRoute` 의 pillar 가 실제로
  화면에 닿는지 본다. 끝에 `#/analyze/performance` 로 가면 상세가 닫히고 주소는 그대로인지도 본다)
- `analyze-pillars.test.ts`: "안전 칩은 다섯 칩 뒤에 오고 passedRules 수를 done 톤으로 센다"
- `precheck.test.tsx`: "PreCheck 결과에는 안전 구획이 없다"

지운 것(§4 에서 이미 지웠고 되살리지 않음): 점검 옵션 다섯 건, "기준 파일이 .json 이 아니면 …", "기준 파일을 보냈으면 …".
§4 에서 만든 상시 펼침 단언("보안 상세와 비용 최적화 상세가 처음부터 함께 보이고 카드 줄은 없다", app 의 "옛 주소 %s 도
같은 화면을 연다")은 이번에 없앴다.

테스트를 먼저 바꾸고 돌려 69건 실패(카드·라우트 없음)를 확인한 뒤 구현했다. `PreCheck` 의 새 테스트는 구현 전에도 녹색이어야 하는
회귀 방지 단언이다(사전 점검은 처음부터 안전 구획을 그리지 않는다). 첫 실행의 실패 목록은 잘라 봐서 이 건의 녹색을 따로 확인하지는 않았다.

### 7.4 검증

worktree 루트에서.

| 명령 | 결과 |
|---|---|
| `pnpm build --force` | `Tasks: 9 successful, 9 total`, `Cached: 0 cached, 9 total` |
| `pnpm typecheck --force` | `Tasks: 9 successful, 9 total`, `Cached: 0 cached, 9 total` |
| `pnpm lint` | 오류 0, 경고 14(전부 `website/.vitepress/theme/components/HomeLanding.vue`, 앞과 같음) |
| `pnpm test` | `Test Files 239 passed (239)`, `Tests 5549 passed / 25 skipped (5574)` |

`pnpm test` 출력의 "1 failed (1 total)" 줄은 다른 패키지 테스트가 일부러 실패시키는 케이스(`seoul-weather` 등)가 찍는 출력이다. 판정은 요약 줄이다.
lint 의 서식 오류 셋(`PillarBadge.tsx`, `AnalyzeView.tsx`, `security-detail.test.tsx`)은 `biome check --write` 를
`packages/dashboard/web` 에만 돌려 고쳤다.

### 7.5 임의로 판단한 것

1. **단계는 상태를 따로 두지 않는다.** `hasResults = tokens.state.kind !== "idle" || security.state.kind !== "idle"`.
   두 훅에 idle 로 돌아가는 전이가 없어(`setState` 갈래가 running·done·failed 뿐) 한 번 넘어가면 돌아가지 않는다. 토큰 훅이
   `start` 첫 줄에서 동기로 running 이 되므로 분석하기를 누른 그 렌더에서 결과 단계가 된다.
2. **안전 구획 자리는 결함 목록 바로 다음, 권한 조합 경고 위다.** 사양 "발견 목록 바로 다음, 검사하지 않은 것 위" 는 권한
   조합 경고(흐름 발견) 앞뒤 둘 다 만족할 수 있었다. 글자 그대로 "바로 다음" 을 따랐다. 흐름 경고 뒤로 옮기려면
   `SecurityResult.tsx` 의 `{passedChecks}` 한 줄을 옮기면 된다.
3. **슬롯은 `passedChecks?: ReactNode`** 다(`passedRules` 배열을 받는 대신). `SecurityResult` 가 `PassedChecks` 를 몰라도 되고,
   사전 점검은 아무것도 넘기지 않는다.
4. **서버 선택 단계에서 축 주소였으면 분석하기 직후 그 상세가 펼쳐진다.** 사양은 "상세는 라우트 pillar 가 있을 때" 라
   그대로 따랐고, 이를 테스트("1단계에서 pillar 가 있던 채로 …")로 고정했다.
5. **ADR-0117 파일 이름을 바꿨다.** 제목의 "두 상세를 함께 펼친다" 가 더는 사실이 아니다. 파일은 untracked 라 `mv` 로
   바꿨고 `docs/adr/README.md` 와 이 보고서 §2 의 경로를 함께 고쳤다. ADR 본문은 선택지에 (b)(상시 펼침)를 남기고 (c) 를
   결정으로 적었다.
6. **결과 단계의 idle 안내 문장은 남겼다.** 지금 흐름에서는 보이지 않지만 `PillarState` 가 idle 을 가지므로 상세 본문의
   갈래를 지우지 않았다. 문장은 "분석하기" 로 맞췄다.
7. **안전 구획 HTML 미해석 테스트의 `<i>` 단언을 바꿨다.** 카드의 분포 막대 칸이 `<i>`(부모가 `aria-hidden`)라
   `i:not([aria-hidden])` 이 걸렸다. "규칙 id 가 만든 `<i>`(글자 `x`) 가 없다" 로 좁혔다. 단언의 뜻은 같다.

### 7.6 남은 위험

- 실환경(브라우저)에서 두 단계 전환, 카드 칩 여섯 개의 줄바꿈(좁은 폭에서 칩이 두 줄이 될 수 있다), 안전 구획 위치를 눈으로
  보지 않았다.
- git 색인 상태: 앞 작업이 `git rm` 으로 색인에서 지운 `PillarCard.tsx`·`analyze/types.ts` 를 이번에 되살려, `git status`
  가 `D ` 와 `??` 를 함께 보인다. 사람이 `git add` 하면 수정 또는 변경 없음으로 정리된다. 색인은 건드리지 않았다.
- `SecurityOptions.tsx` 는 여전히 색인에서 지운 상태다(의도).

## 8. 자동 격리

사용자 결정(2026-10-19): "분석하기" 는 Docker 격리를 자동으로 시도하고, 쓸 수 없으면 로컬 readonly 로 간다. 고르는 옵션은
여전히 없다. 같은 worktree, 커밋 없음. 실행 모델 `claude-opus-5-5`, 추론 수준 high, 서브에이전트 없음. Docker 컨테이너를
띄우지 않았다(이 머신의 Docker 데몬은 꺼져 있었다).

### 8.1 확인한 것(코드)

- **격리 적용 기준.** audit `startSandbox`(`packages/audit/src/audit.ts`)는 `target.kind === "stdio"` 이고
  `backend.commands`(`sandbox/docker.ts` 의 `["node", "npx", "npm"]`)에 실행 명령의 basename 이 있을 때만 격리한다. 아니면
  `unsupported-command` 로 격리 없이 돈다. 같은 목록이 `report.ts` 의 `SANDBOX_COMMANDS` 다.
- **CLI 가 audit 보다 먼저 거절하는 자리.** `cli/src/audit-command.ts` 의 `sandboxOptions` 는 audit 를 부르기 전에
  `resolveMountRoot`(`audit-sandbox-target.ts`)로 마운트 범위를 정한다. 서버 인자가 범위 밖의 실제 파일이거나 범위가
  홈·`/` 이면 `SandboxTargetError` 를 던지고 `오류 [CLI_USAGE]: …` 로 끝난다. 명령 판정보다 앞이라 python 대상에
  `--sandbox` 를 실어도 이 거절을 탈 수 있다. 대시보드 루트 밖에 있는 서버(`~/.claude.json` 후보의 절대경로 스크립트 등)는
  node 라도 이 거절을 탄다.
- **격리 안의 호출 정책.** `sandboxOptions` 의 `probe: input.probeExplicit ? input.probe : "all"`, 그리고 파서의
  `probe: probe ?? "readonly"`. 대시보드는 `probe` 를 보내지 않으므로 격리 안은 `all`, 밖은 `readonly` 다. 의도와 같아
  고치지 않았다.
- **Docker 를 못 쓸 때.** `docker.ts` 의 `detect()` 가 `docker version` 이 ENOENT 면 `docker-missing`, 그 밖의 실패면
  `daemon-down` 이다. `audit()` 은 그때 `auditDirect(…, started.unavailable)` 로 격리 없이 돌고(`options.probe` = readonly)
  `report.sandbox = { status: "unavailable", reason }` 을 싣는다.

### 8.2 바꾼 파일

- `web/src/analyze/build-analyze-requests.ts`: 격리할 수 있는 대상(transport stdio, argv 가 `--command <명령>` 으로 시작,
  basename 이 node·npx·npm)이면 `buildSecurityRequest(…, { ...INITIAL_SECURITY_FORM, sandbox: true })` 에
  `sandboxOptional: true` 를 더한다. `build-security-request.ts` 와 그 테스트는 그대로다.
- `web/src/analyze/security-execution.ts`(새 파일): `securityExecution(response)` 순수 함수. ran → "격리 실행(Docker)",
  unavailable → "로컬 실행(<probe>): <sandboxLine 첫 줄>"(없으면 `reason.detail` 첫 줄), `sandboxFallbackReason` 이 있으면
  "로컬 실행(<probe>): <그 사유>", 그 밖 → "로컬 실행(<probe>): 격리할 수 없는 대상입니다".
- `web/src/analyze/pillars.ts`: 보안 카드 `foot` 가 `<실행 방식> · <기준 파일 문장 또는 호출 수>` 다.
- `web/src/screens/AnalyzeView.tsx`: 보안 상세 머리(제목·배지 줄)에 실행 방식 한 줄. 문서 주석 갱신.
- `src/api-types.ts`: 요청 `sandboxOptional?: boolean`, 응답 `sandboxFallbackReason: string | null`.
- `src/server/analyze-security.ts`: `prepareSecurityRun` 이 `sandbox` 와 `sandboxOptional: true` 가 함께 오면 격리 플래그만 뺀
  `fallbackArgv` 를 함께 낸다. `analyzeSecurity` 는 `context.fallbackArgv` 가 있고 첫 실행이 리포트 없이 `오류 [CLI_USAGE]: `
  로 끝나면 `fallbackArgv` 로 한 번 더 돌고, 첫 줄에서 머리를 뗀 글자를 `sandboxFallbackReason` 에 싣는다.
- `src/server/routes.ts`: `sandboxOptional` 형식 검사, `fallbackArgv` 를 `analyze` 의 context 로 넘긴다.
- 문서: ADR-0117(제목·결정 5·이유·결과 개정, 파일 이름 변경), `docs/adr/README.md` 0117 줄, 이 보고서 §2 경로,
  `.changeset/analyze-pillars-dashboard.md`.

### 8.3 테스트 변화

먼저 바꾸고 돌려 실패를 확인했다(서버 7건, web 11건과 새 파일 import 실패). 구현 뒤 녹색.

- 이름을 바꾼 것: "대상이 되면 토큰은 argv·serverId, 보안도 argv·serverId 뿐이다" → "node 대상이면 보안 요청에 격리
  시도(sandbox·sandboxOptional)를 싣고 토큰은 argv·serverId 뿐이다". "분석하기는 보안 본문에 argv·serverId 만 싣는다" →
  "분석하기는 node 대상이면 보안 본문에 argv·serverId 와 격리 시도만 싣는다". `analyze-pillars.test.ts` 의 foot 두 건은
  "실행 방식 뒤에" 를 이름에 더하고 기대 글자를 바꿨다.
- 단언만 바꾼 것: "직접 입력 갈래면 serverId 키 자체가 없다", "첫 후보가 초기 선택이고 분석하기가 두 요청을 같은 틱에
  보낸다"(보안 본문에 sandbox·sandboxOptional).
- 새로 넣은 것
  - `build-analyze-requests.test.ts`: "npx·npm 은 경로가 붙어도 basename 으로 본다", "http 대상이면 보안 요청에 sandbox 키가
    없다", "격리 이미지가 실행하지 않는 명령(python 등)이면 보안 요청에 sandbox 키가 없다"
  - `security-execution.test.ts`(새 파일 8건): ran, unavailable(sandboxLine 첫 줄), 여러 줄, sandboxLine 없음, 범위 거절 사유,
    격리 요청 없음, probe 반영, 같은 응답 두 번 같은 글자
  - `security-detail.test.tsx`: "격리가 돌았으면 카드 요약 줄과 상세 머리에 격리 실행(Docker) 이 보인다", "Docker 를 못
    썼으면 카드와 상세 머리에 로컬 실행(readonly) 과 사유 첫 줄이 보인다", "격리를 보내지 않은 요청의 응답이면 격리할 수 없는
    대상이라고 보인다", "격리 대상 판정에서 거절돼 다시 돌았으면 그 사유가 보인다"
  - `analyze-security.test.ts`: prepare 3건(fallbackArgv 있음·sandbox 없음·sandboxOptional 없음), analyze 6건(리포트면 null,
    CLI_USAGE 면 다시 돌고 사유, 다시 돈 실행도 실패, fallbackArgv 없으면 한 번, CLI_USAGE 아닌 실패면 한 번, 실제
    `runAuditCommand` 가 범위 밖 서버 인자를 거절한 문장이 사유)
  - `routes.test.ts`: "prepare 가 fallbackArgv 를 내면 analyze 의 context 로 넘긴다", 형식 오류 목록에
    `sandboxOptional: "yes"`
- 응답 픽스처 넷(`analyze-fixture-data.ts`, `analyze-pillars.test.ts`, `precheck.test.tsx`, `security-view.test.ts`)에
  `sandboxFallbackReason: null` 을 더했다.

### 8.4 검증

worktree 루트에서.

| 명령 | 결과 |
|---|---|
| `pnpm build --force` | `Tasks: 9 successful, 9 total`, `Cached: 0 cached, 9 total` |
| `pnpm typecheck --force` | `Tasks: 9 successful, 9 total`, `Cached: 0 cached, 9 total` |
| `pnpm lint` | 오류 0, 경고 14(앞과 같음) |
| `pnpm test` | `Test Files 240 passed (240)`, `Tests 5574 passed / 25 skipped (5599)` |

lint 의 서식 오류(줄바꿈·import 순서)는 `biome check --write` 를 `packages/dashboard` 아래에만 돌려 고쳤다.

### 8.5 임의로 판단한 것

1. **명령 판정을 대시보드도 한다.** 사양은 "audit/CLI 가 걸러 주면 중복하지 않는다" 였다. audit 는 거르지만 CLI 의
   마운트 범위 판정이 그보다 앞이라, python 대상에 `--sandbox` 를 실으면 격리와 상관없는 이유로 분석이 실패할 수 있다.
   그래서 대시보드도 같은 목록으로 거른다. 목록이 audit 와 갈라지면 격리할 수 있는 명령이 로컬로 도는 쪽으로만 틀린다.
2. **범위 판정 거절은 대시보드 서버가 격리 없이 다시 돌린다.** 사양에 없던 갈래다. 이것이 없으면 대시보드 루트 밖의 서버를
   분석할 때 전에는 되던 분석이 `CLI_USAGE` 로 실패한다. CLI 는 고칠 수 없으므로(다른 오너) 대시보드 서버가 다시 돈다.
   거절은 서버를 띄우기 전이라 다시 돌아도 부작용이 없다. 판정은 "리포트 없이 `오류 [CLI_USAGE]: ` 로 시작" 이다. 다른
   사용법 오류도 같은 머리지만, 그때는 다시 돈 실행이 같은 문장으로 끝나 결과가 같다.
3. **다시 돌기는 요청 필드 `sandboxOptional` 로 켠다.** 사전 점검(`PreCheck`)은 사용자가 격리를 고른 것이라 조용히 격리
   없이 돌면 안 된다. 그래서 분석하기만 이 필드를 보낸다. 사양의 `sandbox` 값(`{ compareHost: false, allowHosts: [] }`)은
   그대로이고, 본문에 이 필드 하나가 더 붙는다.
4. **사유는 `sandboxLine` 을 쓴다.** `report.sandbox.reason` 은 `{ code, detail }` 이고 `detail` 이 비는 경우가 많다
   (`docker-missing`·`daemon-down`). 응답에 이미 있는 audit 문장(`sandboxLine`, "행위 관측 안 함: Docker 데몬이 응답하지
   않습니다. …")의 첫 줄을 쓰고, 없을 때만 `detail` 첫 줄이다. 카드 요약 줄로는 길다.
5. **괄호 안은 리포트의 `probe` 다.** 사양 문구는 "readonly" 고정이었다. 분석하기의 로컬 실행은 늘 readonly 라 화면 글자는
   같고, probe 가 다른 응답에서 거짓말을 하지 않는다.
6. **카드 요약 줄은 실행 방식을 앞에 붙인다.** 기존 글자(기준 파일 문장 또는 "도구 N개 호출 (probe …)")는 ` · ` 뒤에 남겼다.
   격리 실행에서는 probe 가 all 일 수 있어 그 정보가 사라지지 않게 했다.
7. **범위 거절 문장도 진행 로그에 찍힌다.** 첫 실행의 stderr 를 걸러 내지 않았다. 로그에 `오류 [CLI_USAGE]: …` 가 먼저 보이고
   격리 없는 실행이 이어진다. 결과 화면은 실행 방식 줄로 같은 사유를 보인다.

### 8.6 남은 위험

- 실제 Docker 로 격리 실행을 돌려 보지 않았다(지시대로). 첫 실행 이미지 빌드 시간, 진행 로그 표시, 격리 안 `all` 호출의
  결과 화면은 오케스트레이터 확인이 필요하다. 이 머신은 데몬이 꺼져 있어, 지금 `pnpm dashboard` 로 분석하면
  "로컬 실행(readonly): 행위 관측 안 함: Docker 데몬이 응답하지 않습니다. …" 갈래가 보여야 한다.
- 격리 안에서는 쓰기 도구도 호출한다. 컨테이너 밖에 닿는 부작용(서버가 원격 API 에 쓰기 요청을 보내는 것)은 네트워크가
  실제 전달이면 막지 못한다. CLI `--sandbox` 기본과 같은 성질이다.
- 범위 거절 판정이 CLI 문장의 머리(`오류 [CLI_USAGE]: `)에 기댄다. CLI 가 머리를 바꾸면 다시 돌기가 꺼지고 전처럼 실패로
  보인다(조용히 틀리지는 않는다). 실제 `runAuditCommand` 로 이를 보는 유닛 테스트를 두었다.
- 실행 방식 줄의 사유는 audit 문장이라 길다. 좁은 카드에서 요약 줄이 여러 줄로 접힐 수 있다.

### 8.7 안전 구획의 행위·네트워크 규칙 결함 수정

오케스트레이터의 실서버 확인(live-weather)에서 드러났다. 격리를 요청하지 않은 실행(원격·python 등, 그리고 §7 까지의
모든 실행)은 audit 가 behavior·network 를 `report.skipped` 에 넣지 않는다. 그래서 `passedRules` 가 돌지 않은 행위·네트워크
규칙 13건을 통과로 셌다(34건, 정답은 21건). `server/passed-rules.ts` 의 `passedRules` 가 두 family 를
`report.sandbox?.status === "ran"` 일 때만 통과 후보로 두게 고쳤다. `report.sandbox` 가 없거나 `unavailable` 이면 뺀다.

- `passed-rules.test.ts` 새 테스트: "sandbox 가 없으면 behavior·network 규칙은 통과가 아니다", "sandbox 가 unavailable 이면
  behavior·network 규칙은 통과가 아니다", "격리가 실제로 돌았고 발견이 없으면 behavior·network 규칙도 통과다", "실제 카탈로그로도
  격리 없는 실행에는 behavior·network 통과가 없다". 앞의 셋 가운데 두 건과 넷째가 구현 전에 실패했다.
- `analyze-security.test.ts` "passedRules 는 발견·건너뜀에 걸리지 않은 규칙을 audit 카탈로그 순서로 싣는다": 끝 줄이 network 의
  마지막 규칙이라는 단언은 격리가 돈 리포트로 옮겼고, 격리 없는 SAMPLE 에는 behavior·network 가 없다는 단언을 더했다.
