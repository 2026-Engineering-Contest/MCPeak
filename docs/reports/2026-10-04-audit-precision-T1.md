# T1 보고: audit 정적 규칙 오탐 수정 (2026-10-04)

status: READY_FOR_REVIEW

작업 공간은 `.claude/worktrees/audit-precision`, 브랜치 `fix/audit-precision`, 기점 `52336ab` 이다.
커밋은 하지 않았다. 변경은 전부 작업 트리에 있다.

## 경과

처음에는 아래 "막혔던 지점" 때문에 BLOCKED 로 보고했다. 오케스트레이터가 가안(단언을 원형으로
바꿈)을 골랐고, 활용형을 잡지 않는다는 알려진 한계를 고정하는 단언을 하나 더했다. 규칙 코드는
그 뒤로 건드리지 않았다. 지금은 818개 전부 통과다.

## 막혔던 지점 (해소됨)

계획서 §3.2 의 마지막 단언(`do_thing` / "Deletes every record that matches the filter.")이
구현 뒤에도 빨강이었다. 기대값은 `[["delete"]]` 인데 실제값은 `[]` 였다. 지시대로 단언과 규칙을
고치지 않고 멈춰 보고했다.

원인은 계획서의 전제가 코드와 다르다는 것이다. 계획서는 `DESTRUCTIVE_VERB.exec` 가 `deletes`
안의 `delete` 를 부분 일치로 찾는다고 적었다. 그런데 정규식은 `\b(delete|…)\b` 로 양쪽에 단어
경계가 있다. `deletes` 는 `delete` 뒤에 `s` 가 붙어 뒤쪽 경계가 성립하지 않으므로 일치하지 않는다.
이 동작은 수정 전에도 같다. 수정 전 코드에서도 같은 단언이 `[]` 로 빨강이었다. 즉 이번 변경이
규칙 의미를 바꾼 것이 아니라, 규칙이 원래 원형 낱말만 잡는다.

확인한 값(같은 정규식과 `spaced` 로 직접 돌림):

| 설명 | 선두 동사 판정 |
|---|---|
| "Deletes every record that matches the filter." | 없음 |
| "Delete every record that matches the filter." | `delete` |
| "Creates a new project." | 없음 |
| "Sends a message." | 없음 |

제시한 선택지는 둘이었고 가안이 채택됐다.

- 가안(권장): 단언의 설명을 원형 "Delete every record that matches the filter." 로 바꾼다. 규칙
  의미는 그대로이고 기대값 `[["delete"]]` 이 성립한다. T1 범위 안에서 끝난다.
- 나안: 선두 동사에 한해 활용형(`deletes`·`creates`·`sends`)도 잡도록 규칙을 넓힌다. 3인칭
  현재형으로 시작하는 도구 설명은 흔하므로 실효 재현율에는 이쪽이 낫다. 다만 규칙 의미를 바꾸는
  일이라 이 태스크 범위 밖이고, 실서버 표본과 MCPTox 재측정이 따라야 한다.

## 바꾼 파일

| 파일 | 내용 |
|---|---|
| `packages/audit/src/rules/schema.ts` | `leadingDestructiveVerb` 추가. `annotation-mismatch` 의 이름에 읽기 동사가 없는 분기를 이름 첫 토큰, 설명·제목의 맨 앞 동사만 보도록 교체. id·심각도·메시지·fix 문안은 그대로 |
| `packages/audit/src/rules/description.ts` | `scanString` 에서 `inputSchema` 경로의 문자열에는 `implicit-trigger` 를 돌리지 않음. 다른 규칙은 그대로 |
| `packages/audit/tests/schema-flow-rules.test.ts` | §3.2 단언 2개 추가(둘째는 설명을 원형 "Delete every record …" 로 바꿈). 활용형 "Deletes …" 는 잡지 않는다는 한계 고정 단언 1개 추가 |
| `packages/audit/tests/desc-rules.test.ts` | §3.4 단언 2개 추가 |
| `.changeset/audit-annotation-trigger-precision.md` | 신규. `@mcpeak/audit: patch` |

허용 Files 밖은 건드리지 않았다. 계획서 사본도 수정·stage 하지 않았다.

## 수정 전후 테스트

수정 전(테스트만 넣은 상태, 두 파일만 실행): 111개 중 3개 빨강.

- §3.2 실서버 오탐 회귀: `git_log` 에서 evidence `["commit"]` 로 high 발견. 빨강.
- §3.4 파라미터 설명: 발견이 나와 빨강. `scan` 헬퍼가 `collectStrings` 로 파라미터 설명을 규칙에
  넣는다는 것이 이것으로 확인됐다. 케이스 구성을 바꿀 필요가 없었다.
- §3.2 "Deletes …": `[]` 로 빨강(위 막힌 지점).

§3.4 둘째 단언(도구 설명의 자동 트리거)은 수정 전에도 초록이다. 기존 동작을 지키는 단언이다.

수정 후(가안 반영 뒤 최종):

| 명령 | 결과 |
|---|---|
| `pnpm --filter @mcpeak/audit build` | Build complete |
| `pnpm --filter @mcpeak/audit test` | Test Files 22 passed (22), Tests 818 passed (818) |
| `pnpm --filter @mcpeak/audit typecheck` | `tsc --noEmit` 오류 없음 |
| `pnpm lint` | Checked 707 files, 고칠 것 없음 |

기준선 813 에서 5개 늘어 818 이다. 통과 기준(전부 녹색, 813 초과)을 충족한다. 가안 반영 전에는
817개 중 "Deletes …" 단언 1건이 빨강이었다.
기존 테스트와 픽스처 테스트(`schema-annotation-mismatch.json` 포함)는 전부 초록이다.

## 임의로 판단한 부분

- `leadingDestructiveVerb` 본문을 계획서 코드에서 조금 고쳤다. 계획서는 `match[1]` 을 바로 쓰는데
  이 패키지의 `noUncheckedIndexedAccess` 아래에서는 `string | undefined` 라 `startsWith` 인자로
  넘길 수 없다. `const verb = match?.[1]` 로 받아 `undefined` 를 거른다. 판정은 같다.
- 처음 보고 때는 마지막 단언을 빨강인 채 계획서 문안 그대로 남겼다. 원형으로 바꾼 것과 한계
  고정 단언을 더한 것은 오케스트레이터 결정이다. 한계 고정 단언의 이름 문안은 내가 정했다.
- 막힌 뒤에도 changeset 작성과 전체 검증은 끝까지 돌렸다. 막힌 단언과 무관한 부분이고 판단에
  필요한 수치이기 때문이다.
- 테스트 코드는 biome 포맷(줄 길이)에 맞춰 줄바꿈만 다듬었다. 문자열과 단언 내용은 계획서와 같다.

## 남은 위험

- 좁힌 뒤의 규칙은 설명이 원형 파괴 동사로 시작할 때만 설명에서 잡는다. "Deletes …"·"Creates …"
  로 시작하는 읽기 전용 표기 도구는 이름 첫 토큰이 파괴적이지 않으면 놓친다. 수정 전에도 활용형은
  못 잡았으므로 회귀는 아니지만, 설명 중간의 원형 낱말로 우연히 잡히던 경우는 이제 사라진다.
- `annotations.title`·`tool.title` 도 맨 앞 낱말만 본다. "Notion: Delete page" 꼴 제목은 놓친다.
- 실서버 34개 표본(C2)과 MCPTox 재현율(C3)은 이 태스크에서 재지 않았다. 통합 게이트 몫이다.
