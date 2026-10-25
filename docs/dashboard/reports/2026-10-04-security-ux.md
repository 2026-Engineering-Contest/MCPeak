# security-UX 보고서 (보안 탭: 점검 시작 즉시 다음 단계로, 결과 화면 가시성)

사용자가 실제 화면을 보고 요청한 후속이다. 오케스트레이터는 `ohmymcp-f3`.

## 작업 공간

| 항목 | 값 |
|---|---|
| pwd | `/Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/mcpeak-security-ux` |
| 브랜치 | `feat/security-ux-steps-visibility` |
| HEAD, 기점 | `54dbfa0` (`main`). 커밋하지 않았다. 변경은 작업 트리에만 있다 |

진입할 때 작업 트리는 비어 있었고 HEAD 는 `54dbfa0` 이었다.

## 변경 파일

- `packages/dashboard/web/src/analyze/SecurityPanel.tsx` (세 단계)
- `packages/dashboard/web/src/analyze/SecurityResult.tsx` (위계와 색)
- `packages/dashboard/web/src/analyze/security-view.ts` (`SEVERITY_TONE` 추가. 기존 함수는 그대로)
- `packages/dashboard/web/tests/security-panel.test.tsx` (27개에서 32개)
- `packages/dashboard/web/tests/security-view.test.ts` (9개에서 10개)
- `.changeset/dashboard-security-ux.md` (새 파일)

허용 Files 밖은 건드리지 않았다. 이 보고서만 예외다.

## A. 단계 전환

- `STEPS = ["서버 선택", "점검", "결과"]`. 단계는 상태로 두지 않고 구한다. `result` 가 있으면 2, `runId` 가 있으면 1, 아니면 0.
- 0 서버 선택: 폼과 옵션, 버튼 `점검 시작`. POST 중에만 비활성이고 라벨이 `점검 중…` 이다. POST 가 성공하면 그 순간 1 로 간다. 실패하면 0 에 머물고 서버 문장을 alert 로 보인다.
- 1 점검: 폼을 그리지 않는다. `← 서버 다시 고르기` 버튼, 그 옆에 `점검은 중단되지 않고 끝까지 돕니다.`, 그 아래 `점검 대상: <명령 또는 URL>`(`describeRun("audit", sent.argv).server`), 그리고 진행 패널이다.
- 1 에서 0 으로: 결과 읽기가 400 이거나 run 이 없다고 확인되면 돌아가 문장을 alert 로 보인다.
- 2 결과: 이전과 같다. `다시 점검` 은 POST 성공 뒤 1 로 간다. POST 가 실패하면 앞 결과를 둔 채 그 위에 문장을 보인다.

## B. 결과 화면

글자와 순서는 바꾸지 않았다. 지시의 항목을 그대로 따랐고, 톤 표는 `security-view.ts` 의 `SEVERITY_TONE` 에 있다.

| 자리 | 한 것 |
|---|---|
| 판정 줄 | 네 집계를 둥근 칩으로. 숫자만 굵다. 0건인 칩은 정보 톤. 줄 전체 글자는 `판정: 심각 N건, 주의 N건, 낮음 N건, 정보 N건` 그대로 |
| 구획 제목 | 심각도별 보기는 그 심각도의 fg 색, 도구별은 ink. 둘 다 `font-semibold` |
| 발견 | 왼쪽 4px 띠(심각도 fg). 첫 줄은 배지, 규칙 id(mono 굵게), 위치(muted). 둘째 줄 메시지는 ink `font-medium`. 셋째 줄은 `해결` 라벨만 done-fg 로 작게 굵게. 넷째 줄은 `근거` 라벨과 조각마다 `<code>` 칩 |
| 격리 상태 줄 | `ran` 은 done-bg 바탕과 done-fg 왼쪽 띠, `unavailable` 은 failed 톤 상자. role 과 글자는 그대로 |
| 권한 조합 경고 | 제목 waiting-fg, 항목마다 waiting-fg 왼쪽 띠 |
| 검사하지 않은 것 | family 는 mono 굵은 ink, reason 은 muted. 글자는 `family: reason` 그대로 |
| 요청 표 | `선언 없음` 은 failed-fg 굵게, `선언됨` 은 muted |
| 이 점검의 한계 | line-subtle 바탕 상자 안, 글은 muted |
| 간격 | 구획 사이 `space-y-6` |

## 검증 명령과 결과

| 명령 | 결과 |
|---|---|
| `pnpm vitest run --root . --project web` | `Test Files 54 passed (54)`, `Tests 665 passed (665)`. 기준선 659 에 6개가 늘었다 |
| `pnpm build --force` | `Tasks: 9 successful, 9 total`, `Cached: 0 cached, 9 total` |
| `pnpm typecheck --force` | `Tasks: 9 successful, 9 total`, `Cached: 0 cached, 9 total` |
| `pnpm lint` | `Checked 694 files. No fixes applied.` |
| 숨은 문자 perl 검사(고친 테스트 둘, 고친 소스 셋) | 출력 없음 |
| `web/src/analyze/Security*.tsx` 에서 `dangerouslySetInnerHTML`·`setTimeout`·`setInterval` 찾기 | 없음 |

실제 서버와 브라우저로는 보지 않았다. jsdom 과 fetch·EventSource 스텁뿐이다.

테스트를 먼저 쓰라는 지시는 절반만 지켰다. 테스트를 먼저 고쳐 쓰긴 했지만 빨강을 따로 돌려 확인하지 않고 구현을 이어 쓴 뒤 한 번에 돌렸다.

## 고친 기존 테스트

전부 `security-panel.test.tsx` 다. 단언을 지운 곳은 "점검 중…" 고정 둘뿐이고 나머지는 같은 것을 새 모양으로 본다.

| 테스트 | 바뀐 것 |
|---|---|
| `점검 시작이 올바른 본문을 POST 하고 이벤트 스트림을 연다` | 버튼이 `점검 중…` 으로 비활성이라는 단언 둘을 지웠다(그 버튼이 점검 단계에 없다) |
| `없는 run 이면 ...` | 이름을 `없는 run 이면 서버 선택 단계로 돌아가 다시 시작할 수 있다` 로. 단계 단언 추가 |
| `run 조회만 실패하면 문장을 보이고 진행을 유지한다` | 버튼 비활성 단언을 "단계가 점검" 으로 |
| `진행 문장을 로그 패널에 보인다` | 단계 기대값을 `서버 선택` 에서 `점검` 으로 |
| `done 이벤트 뒤 결과를 한 번 읽어 보인다` | 이름을 `done 뒤 결과를 읽으면 결과 단계다` 로. 판정 문장을 `getByText` 가 아니라 그 줄의 `textContent` 로 본다 |
| `발견은 위치·메시지·해결 세 줄로 보인다` | `발견은 심각도 배지·규칙·위치·메시지·해결을 보인다` 로 바꿨다. 근거 단언은 새 테스트로 옮겼다 |
| `도구별로 바꾸면 도구 제목 구획으로 묶인다` | 구획 안의 발견을 첫 줄 전체 글자가 아니라 규칙 id 로 찾는다 |
| `flow 발견은 ... 구획에만 있다` | 해결 줄을 줄 전체 글자로 찾는다. 규칙 id 가 화면에 없음을 `queryByText` 로 본다 |
| `격리가 돌았으면 ...` | 선언 칸의 색 단언 둘 추가 |
| `limits 와 CLI 리포트 원문을 보인다` | "검사하지 않은 것" 을 항목의 `textContent` 로 본다 |
| `결과 요청이 400 이면 ...` | 이름을 `... 서버 선택 단계로 돌아가 error 문장을 그대로 보인다` 로. 그 전에 점검 단계였다는 단언 추가 |
| `시작 요청이 400 이면 ...` | 이름을 `시작 요청이 400 이면 서버 선택 단계에 머문다` 로. 단계 단언 추가 |
| `다시 점검은 같은 요청을 다시 POST 한다` | 이름을 `다시 점검은 점검 단계로 간다` 로. 단계가 점검이고 앞 결과가 내려갔다는 단언 추가. 같은 본문 단언은 남겼다 |
| `서버가 보낸 글자를 HTML 로 해석하지 않는다` | 한 줄만 고쳤다. 해결 줄이 라벨과 문장 두 조각이 돼 `getByText("해결: <b>fix</b>")` 가 못 찾는다. 줄 전체 글자로 찾게 했다. 나머지 단언(img, b, script 요소 없음)은 그대로 녹색이다 |

새 테스트: `점검 시작을 누르면 점검 단계로 넘어가고 폼이 사라진다`, `점검 단계는 점검 중인 서버를 보인다`, `점검 단계에서 서버 다시 고르기를 누르면 서버 선택으로 돌아가고 고른 값이 남는다`, `판정 줄의 글자는 CLI 판정 줄과 같다`, `근거는 조각마다 따로 보인다`, 그리고 `security-view.test.ts` 의 `SEVERITY_TONE 은 네 심각도에 기존 토큰을 준다`.

## 임의로 판단한 부분

1. **점검 단계를 떠난 run 의 결과는 버린다.** 결과 GET 이 날아간 사이에 `← 서버 다시 고르기` 를 누르면, 늦게 온 응답이 화면을 결과 단계로 넘겨 버린다. ref 하나(`awaitedRun`)로 지금 기다리는 run 을 적어 두고 다르면 버린다. 렌더에서는 읽지 않는다. 테스트는 떠난 뒤 `done` 이 와도 결과를 읽지 않고 서버 선택에 머무는 것을 본다.
2. **`점검은 중단되지 않고 끝까지 돕니다.` 는 버튼 옆**(`text-xs text-ink-muted`)이고, **`점검 대상:` 줄은 그 아래** mono 작은 글씨(`break-all font-mono text-xs text-ink`)다. 명령이 길 수 있어 mono 와 줄바꿈을 줬다.
3. **칩과 배지의 클래스.** 심각도 배지는 `inline-block rounded-full px-2 py-0.5 text-xs font-semibold`, 판정 칩은 `px-2.5` 에 `font-medium` 이고 숫자만 `font-bold tabular-nums`. 판정 줄은 flex 가 아니라 `leading-8` 인 줄글이다. flex 로 짜면 쉼표 뒤 공백이 그려지지 않는다.
4. **굵은 글씨에 `<b>`·`<strong>` 을 쓰지 않았다.** 기존 테스트가 문서에 `<b>` 요소가 없음을 단언한다. 전부 `<span>` 과 클래스다.
5. **발견의 왼쪽 띠는 `border-l-4`,** 발견 목록의 `Card` 에 `overflow-hidden` 을 더해 띠가 둥근 모서리 밖으로 나가지 않게 했다.
6. **근거 조각 사이의 ` · ` 는 뺐다.** 칩 사이 간격(`gap-1.5`)이 대신한다. 그래서 그 줄의 글자는 이제 `근거` 와 조각들이고 `근거: a · b` 가 아니다. 지시가 허용한 쪽이다.
7. **`결함 발견이 없습니다.` 를 done-fg 색 `font-medium` 으로 했다.** 지시에 없는 자리다. 좋은 소식이 회색 한 줄로 묻히지 않게 했다. 글자는 그대로다.
8. **격리 `unavailable` 상자의 글자는 failed-fg 에 `font-medium`,** `ran` 상자의 글자는 ink 다.
9. **"검사하지 않은 것" 의 family 는 `font-mono text-xs font-semibold text-ink`.** 목록 글자(`text-sm`)보다 한 단계 작다. mono 가 같은 크기에서 더 커 보여서다.
10. **칩에 `data-severity` 속성을 달았다.** 테스트가 칩 넷을 집는 데 쓴다. 화면에는 영향이 없다.
11. **`SEVERITY_TONE` 의 타입은 `Readonly<Record<Severity, { fg, bg }>>` 다.** 심각도가 늘면 타입체크가 잡는다.

## 남은 위험

- **색 대비와 생김새를 눈으로 확인하지 않았다.** 토큰은 전부 기존 것이지만, 주의 톤(waiting-fg, 밝은 테마에서 호박색)의 작은 배지 글자와 구획 제목이 흰 바탕에서 충분히 읽히는지, 0건 칩이 지나치게 흐리지 않은지는 브라우저에서 봐야 안다. 어두운 테마도 같다.
- **점검 단계에서 `← 서버 다시 고르기` 로 떠난 run 의 결과는 화면에서 다시 볼 길이 없다.** 서버에는 남지만 Runs 목록에 싣지 않는 것이 기존 결정이다. 문장으로는 "끝까지 돕니다" 만 말한다.
- **탭을 옮기면 점검 단계의 상태가 사라진다.** 이전과 같다.
- **`describeRun` 이 대상을 못 읽으면 `점검 대상: ` 뒤가 빈다.** 화면이 보내는 argv 는 언제나 `--command` 나 `--url` 로 시작하므로 정상 경로에서는 일어나지 않는다.
