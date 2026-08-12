# Task R7 보고서 — hard link 불가(EPERM·ENOTSUP) 전용 안내

## 작업 공간

- worktree: `<repo-root>/.claude/worktrees/ohmymcp-review4-cli`
- 브랜치: `fix/review4-cli`
- 기점 커밋: `2344ce1 docs(cli): R5 통합 대장 기록`
- 진입 시 `git status --short` 비어 있음. `pnpm install` 후 `pnpm vitest run packages/cli`
  (99 passed) 실행 확인

## 변경 파일

| 파일 | 내용 |
|---|---|
| `packages/cli/src/generate-command.ts` | `LinkUnsupportedError`·`linkUnsupportedFailure` 추가, link 실패 코드별 분기, rename fallback 금지 주석 |
| `packages/cli/tests/generate-command.test.ts` | 테스트 6개 추가 |
| `.changeset/cli-link-unsupported.md` | 신규 (patch, `ohmymcp`) |
| `docs/reports/task-r7.md` | 이 보고서 |

## 1. 분기

`saveSuite`의 커밋 단계에서 `link` 실패를 셋으로 가른다.

| errno | 결과 |
|---|---|
| `EEXIST` | `OutputExistsError` → `GENERATE_OUTPUT_EXISTS` (기존 그대로) |
| `EPERM`, `ENOTSUP` | `LinkUnsupportedError` → `GENERATE_LINK_UNSUPPORTED` (신규) |
| 그 외 | 그대로 재던짐 → `GENERATE_FAILED` (기존 그대로) |

```ts
const code = (error as { code?: unknown } | null)?.code;
if (code === "EEXIST") throw new OutputExistsError(input.outPath);
if (code === "EPERM" || code === "ENOTSUP") throw new LinkUnsupportedError(input.outPath, code);
throw error;
```

대화형·비대화형 두 catch 모두에 `LinkUnsupportedError` 분기를 넣었다. 두 경로가 같은
`saveSuite`를 지나므로 어느 쪽에서 저장하든 같은 안내를 받는다.

## 2. rename fallback을 넣지 않았다

지시대로 넣지 않았고, 왜 안 되는지 코드 주석으로 남겼다. 나중에 "EPERM이면 rename으로
떨어뜨리자"고 생각할 자리이기 때문이다.

```ts
// hard link를 못 쓰는 파일시스템(EPERM/ENOTSUP)에서 rename으로 떨어뜨리고 싶어지는
// 자리다. 하지 마라. rename은 대상이 있으면 **말없이 덮어쓴다.** 실측으로 확인했다
// (docs/reports/task-r4.md: link는 EEXIST로 실패하며 기존 내용 PRECIOUS를 보존했고,
// rename은 같은 상황에서 NEW로 덮어썼다). fallback을 넣는 순간 R4에서 없앤 데이터 손실
// 결함이 그대로 돌아온다. 저장하지 못하는 편이 남의 파일을 날리는 것보다 낫다.
```

R4에서 실제 파일시스템으로 측정한 결과를 근거로 인용했다. 추측이 아니라 실측 기록을 가리킨다.

## 3. 문구와 실제 출력

```
<<<EPERM>>>
오류 [GENERATE_LINK_UNSUPPORTED]: 출력 디렉터리가 hard link를 지원하지 않거나 권한이 없어 저장하지 못했습니다. 경로: /tmp/out.json (원인: EPERM)
해결: 로컬 디스크의 다른 디렉터리를 `--out`으로 지정한 뒤 다시 저장하세요. 네트워크 마운트(NFS·SMB 일부), FAT/exFAT USB, 컨테이너 바인드 마운트에서 주로 납니다.
<<<ENOTSUP>>>
오류 [GENERATE_LINK_UNSUPPORTED]: 출력 디렉터리가 hard link를 지원하지 않거나 권한이 없어 저장하지 못했습니다. 경로: /tmp/out.json (원인: ENOTSUP)
해결: 로컬 디스크의 다른 디렉터리를 `--out`으로 지정한 뒤 다시 저장하세요. 네트워크 마운트(NFS·SMB 일부), FAT/exFAT USB, 컨테이너 바인드 마운트에서 주로 납니다.
<<<EEXIST>>>
오류 [GENERATE_OUTPUT_EXISTS]: 출력 파일이 이미 있어 저장하지 않았습니다. 경로: /tmp/out.json
해결: 다른 `--out` 경로를 지정하거나 기존 파일을 옮긴 뒤 다시 저장하세요.
<<<EXDEV>>>
오류 [GENERATE_FAILED]: baseline suite를 생성하거나 저장하지 못했습니다.
해결: MCP 서버와 출력 경로를 확인한 뒤 다시 실행하세요.
```

임시 덤프 테스트로 뽑았고 확인 후 제거했다(잔여 `DUMP` 0건 확인).

문구가 만족하는 조건:

- **무엇이 왜 안 됐는지**: 출력 디렉터리의 파일시스템이 hard link를 지원하지 않거나 권한이
  없다는 사실을 첫 문장에 적었다
- **취할 조치**: "로컬 디스크의 다른 디렉터리를 `--out`으로 지정"이 조치이고, 어떤 위치에서
  주로 나는지(네트워크 마운트, FAT/exFAT USB, 컨테이너 바인드 마운트)를 힌트로 붙였다.
  사용자가 지금 쓰는 경로가 그중 하나인지 바로 짚을 수 있다
- **조사 규칙**: 경로는 `경로: {path}` 라벨 뒤에 두었다. 그 뒤는 `(원인: …)`으로 이어져
  변수 바로 뒤에 조사가 붙지 않는다 (B6 규칙)

### errno 원문을 노출하기로 한 판단

`(원인: EPERM)`처럼 errno 이름을 보여준다. 근거는 셋이다.

1. 검색에 쓰인다. `EPERM link`는 사용자가 자기 환경(도커 바인드 마운트, NFS 옵션)을 찾아보는
   가장 빠른 단서다. 우리가 원인을 다 알려줄 수 없는 환경 문제라 더 그렇다.
2. 내부 정보가 아니다. POSIX 표준 errno 이름이고 프롬프트·stdout·stderr·스택·인증정보 어디에도
   해당하지 않는다. 지금까지 지켜 온 노출 금지 대상과 성격이 다르다.
3. **임의 문자열이 아니다.** 타입을 `"EPERM" | "ENOTSUP"` 닫힌 집합으로 좁혀 두 값만 이 경로에
   들어온다. `error.code`를 그대로 흘려보내지 않는다. 다른 errno는 `GENERATE_FAILED`로 가고
   원문이 노출되지 않는다. 테스트로 고정했다.

## 4. 테스트

- `hard link를 지원하지 않으면 다른 디렉터리를 쓰도록 안내한다` — `EPERM`. 종료 코드 1,
  `GENERATE_LINK_UNSUPPORTED`, 경로, `--out`, `(원인: EPERM)`. 임시 파일은 `unlink`로 정리됨
- `ENOTSUP도 같은 안내 경로를 탄다`
- `EEXIST는 여전히 출력 충돌 안내다` (회귀 방지)
- `커밋 실패가 EEXIST가 아니면 출력 충돌로 오인하지 않는다` (기존) — `GENERATE_LINK_UNSUPPORTED`가
  나오지 않는다는 단언을 보강했다
- `link 실패 안내에 원본 오류 문자열과 스택이 노출되지 않는다` — 다섯 코드(`EPERM`, `ENOTSUP`,
  `EEXIST`, `EXDEV`, `EIO`)를 순회한다. stub이 던지는 오류 메시지에 `RAW_LINK_ERROR_TEXT`와
  경로를 넣어 두고, 출력 어디에도 그것과 `EXDEV`·`EIO`가 없으며 `at `로 시작하는 줄이 없음을 본다
- `대화형 저장에서도 hard link 불가를 전용 문구로 안내한다` — 지시 목록에는 없었지만 대화형
  catch도 내가 고친 자리라 덮었다

대화형 테스트를 쓰다 한 번 실패했다. `reviewDeps`의 `readFile`/`validateSuite` stub이 세션의
실제 suite와 다른 값을 돌려줘서 fingerprint 재검증에서 먼저 걸리고 `link`까지 가지 못했다.
임시 파일을 실제로 왕복(`writeFile`이 담은 문자열을 `readFile`이 그대로 반환)시키도록 stub을
고쳐 해결했다. 실제 흐름에 더 가까운 stub이다.

## 검증

```
pnpm vitest run packages/cli → Test Files 5 passed (5) / Tests 104 passed (104)
pnpm build     → Tasks: 6 successful, 6 total
pnpm typecheck → Tasks: 6 successful, 6 total
pnpm lint      → Checked 102 files in 40ms. No fixes applied.
pnpm test      → Test Files 28 passed (28) / Tests 335 passed (335)
pnpm --filter ohmymcp test:e2e → exit 0
```

CI 조건(build 없이):

```
rm -rf packages/*/dist && pnpm test → Test Files 28 passed (28) / Tests 335 passed (335)
```

검사 대상 0개 거짓 신호 점검:

- 린트 `Checked 102 files` (0 아님)
- 타입체크는 성공 시 무출력이라 별도로
  `cd packages/cli && npx tsc --noEmit --listFiles | grep -c "worktrees/ohmymcp-review4-cli/packages/cli/"`
  → **9**

`packages/core`의 stdio-integration 간헐 실패는 이번 실행들에서 나오지 않았다. 다른 실패도 없었다.

## 임의로 판단한 부분

1. **errno 원문을 노출했다.** 근거는 3절. 닫힌 두 값만 들어오도록 타입으로 좁혔다.
2. **`EPERM`과 `ENOTSUP`을 같은 코드·같은 문구로 묶었다.** 사용자가 취할 조치가 같기 때문이다.
   원인만 괄호로 구분해 보여 준다. 조치가 같은데 코드를 나누면 안내만 늘고 판단은 안 준다.
3. **대화형 경로 테스트를 추가했다.** 지시 목록에 없었으나 내가 고친 분기라 덮었다.
4. **`EXDEV`는 전용 안내를 만들지 않았다.** 임시 파일을 출력과 같은 디렉터리에 만들므로 정상
   경로에서는 날 수 없고, 그 성질은 R4에서 이미 테스트로 고정했다. 실제로 겪는 사례가 나오면
   그때 문구를 만드는 편이 낫다고 봤다.
5. **changeset을 만들었다.** 사용자에게 보이는 새 오류 코드와 안내다.

## 남은 위험

- 실제로 hard link를 지원하지 않는 파일시스템에서 돌려 본 확인은 하지 않았다. 그런 마운트를
  만들려면 권한이 필요하고 이 태스크 범위 밖이다. 테스트는 `link` stub이 해당 errno를 던지는
  방식으로 분기만 고정한다. Node가 그 환경에서 정확히 `EPERM`을 주는지 `ENOTSUP`을 주는지는
  플랫폼과 파일시스템에 따라 다를 수 있고, 다른 코드가 오면 `GENERATE_FAILED`로 떨어진다.
  그 경우 사용자 보고를 받아 코드를 목록에 추가하면 된다.
- macOS에서 확인한 범위다. Linux·Windows에서 같은 상황이 어떤 errno로 오는지는 확인하지 않았다.
