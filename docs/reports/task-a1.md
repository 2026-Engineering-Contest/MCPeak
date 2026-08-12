# Task A1 보고서 — packages/generate provider 호출 복구

## 작업 공간

- worktree: `<repo-root>/.claude/worktrees/ohmymcp-generate-provider`
- 브랜치: `fix/generate-provider-schema`
- `git rev-parse HEAD`: `ecede41ff0b8953b61fca26d565cfe866060a343`
- 기점 커밋: `ecede41 chore(cli): generate 출력 경로 gitignore 추가` (지시받은 기점과 일치)
- 커밋은 하지 않았다. 위 HEAD는 기점 그대로이고 변경은 작업 트리에만 있다.

## 변경 파일

수정:

- `packages/generate/src/authoring-schema.ts`
- `packages/generate/src/providers.ts`
- `packages/generate/src/authoring-request.ts`
- `packages/generate/src/index.ts`
- `packages/generate/tests/providers.test.ts`
- `packages/generate/tests/authoring-request.test.ts`

신규:

- `docs/adr/0007-provider-전송-스키마-분리.md`
- `.changeset/generate-provider-schema.md`
- `docs/reports/task-a1.md` (이 파일)

허용 Files 밖 변경은 없다. `git status --short` 출력이 위 목록과 정확히 일치한다.

## 구현 내용

1. `authoring-schema.ts`에 계획서 4-1의 `PROVIDER_OUTPUT_SCHEMA`를 코드 그대로 추가했다.
   `AUTHORING_OUTPUT_SCHEMA`는 그대로 뒀다.
2. `providers.ts`에서 `hasRequiredCapabilities`, `Options.capabilities`, `Options.runHelp`,
   `execFile`/`promisify` import를 제거하고 `author()` 진입부의 gate 호출을 지웠다.
3. Codex `--output-schema` 파일 내용과 Claude `--json-schema` 인자를 `PROVIDER_OUTPUT_SCHEMA`로
   바꿨다. CLI 인자 배열의 나머지는 그대로다.
4. `prompt()`가 계획서 5장에 적힌 템플릿 문자열 그대로 suite 스키마와 안내 문장을 붙인다.
   `MCP_SUITE_JSON_SCHEMA`는 `@ohmymcp/runner`에서 import한다.
5. `unwrap`을 계획서 4-2의 판정 순서(1~6) 그대로 다시 썼다.
6. `authoring-request.ts`의 `questions` 분기 맨 앞에 4-3의 suite/summary/warnings 동반 거절을
   넣었다.
7. ADR을 배경/선택지/결정/이유/결과 다섯 항목으로 작성했다.

## 테스트

계획서 순서대로 테스트를 먼저 쓰고 실패를 확인한 뒤 구현했다.

구현 전 `pnpm vitest run packages/generate`:

```
 Test Files  2 failed | 4 passed (6)
      Tests  19 failed | 54 passed (73)
```

삭제한 기존 테스트(계획서 지시):

- `"필수 flag capability가 없으면 격리를 낮추지 않는다"`
- `"기본 capability 검사는 실제 help 출력의 필수 flag를 모두 요구한다"`

추가한 테스트는 계획서 5장 Task A1의 목록 전부다(providers 10개, authoring-request 4개).

## 검증 명령과 결과

표적 검증:

```
$ pnpm vitest run packages/generate
 Test Files  6 passed (6)
      Tests  73 passed (73)
   Duration  176ms
```

전체 회귀:

```
$ pnpm build
 Tasks:    6 successful, 6 total
Cached:    4 cached, 6 total
  Time:    2.537s

$ pnpm typecheck
 Tasks:    6 successful, 6 total
Cached:    5 cached, 6 total
  Time:    1.167s

$ pnpm lint
> biome check .
Checked 97 files in 16ms. No fixes applied.

$ pnpm test
 Test Files  27 passed (27)
      Tests  239 passed (239)
   Duration  1.11s
```

거짓 신호 점검(`CLAUDE.local.md` 표):

- **타입체크 녹색인데 검사 대상 0개**: `tsc --noEmit`은 성공 시 아무것도 찍지 않아 파일 수를
  확인할 수 없다. `packages/generate`에서 `npx tsc --noEmit --listFiles`를 돌려 이 worktree의
  `packages/generate/src` 파일이 **10개** 실제로 검사됐음을 확인했다.
- **린트 녹색인데 검사 대상 0개**: biome이 `Checked 97 files`를 출력한다.
- **새 worktree 의존성 미설치**: 진입 직후 `pnpm install`을 돌렸다(`Done in 787ms`).
- **빌드 산출물이 낡음**: 전체 회귀에서 `pnpm build`를 먼저 돌렸다.

## 내가 임의로 판단한 부분

1. **기존 Claude 테스트의 envelope를 갱신했다.** 계획서는 "CLI 인자 배열 단언은 그대로 유지"라고만
   적었는데, 기존 두 테스트가 `{ structured_output: ... }`만 담은 envelope를 쓰고 있었다. 새
   판정은 `type`/`subtype`을 요구하므로 이 값들을 `{type:"result", subtype:"success",
   structured_output: ...}`로 바꿨다. 인자 배열 단언은 손대지 않았다.
2. **`providers.ts`에 지역 `plain` 헬퍼를 새로 뒀다.** `authoring-request.ts`에도 같은 이름의
   함수가 있지만 export되지 않았고, export를 추가하면 계약 파일의 공개 표면이 바뀐다. 대신
   `providers.ts` 안에 최소 판정(객체이고 null이 아니고 배열이 아님)만 두었다. 프로토타입까지
   보는 `authoring-request.ts` 쪽 판정보다 느슨하지만, provider 결과는 `JSON.parse`나 CLI JSON
   출력에서 오므로 실질 차이가 없고, 이어지는 `validateAuthoringProviderResult`가 엄격한 판정을
   다시 한다.
3. **changeset의 bump 종류를 `patch`로 잡았다.** 동작 복구이고 공개 API에서 늘어난 것은
   `PROVIDER_OUTPUT_SCHEMA` export 하나뿐이다. `minor`가 맞다고 보면 파일 한 줄만 고치면 된다.
4. **ADR 파일명을 지시받은 그대로 한글로 만들었다.** 기존 ADR은 전부 영문 슬러그(`0006-ai-assisted-test-authoring.md`)를
   쓴다. 계획서와 실행 프롬프트가 `0007-provider-전송-스키마-분리.md`를 명시해서 그대로 따랐다.
   레포 관례에 맞추려면 이름만 바꾸면 된다.
5. **포매팅은 biome에 맡겼다.** `npx biome format --write`를 변경 파일에만 돌렸다.

## 확인했지만 문제 없던 것

- **`MAX_REQUEST_BYTES` 검사**: 프롬프트가 커지지만 이 검사(`authoring-request.ts:259`)의 대상은
  request 본문이지 프롬프트가 아니다. 프롬프트 증가분은 한도 판정에 들어가지 않는다.
  `pnpm test` 전량 통과가 이를 확인한다.
- **의존 방향**: `generate`가 `@ohmymcp/runner`를 import한다. 기존에도 있던 방향이고 역참조가
  아니다. `packages/cli` 참조는 만들지 않았다.
- **의존성**: 추가하지 않았다. `@modelcontextprotocol/sdk` 버전은 건드리지 않았다.
- **유닛테스트 격리**: 실제 codex/claude 프로세스를 띄우는 코드는 없다. 오히려 help 검사 제거로
  테스트 경로에서 `execFile`이 사라졌다.

## 남은 위험

1. **유닛테스트로는 이 결함을 판정할 수 없다.** 이 결함 자체가 "유닛테스트 녹색, 실행 시 실패"의
   사례다. 두 CLI가 `PROVIDER_OUTPUT_SCHEMA`를 실제로 받아들이는지는 Task C1의 실제 호출로만
   확인된다. C1 전에 완료로 판정하면 안 된다.
2. **프롬프트에 suite 스키마 직렬화가 통째로 들어간다.** 토큰 비용이 늘고, 모델이 스키마를 무시하고
   엉뚱한 suite를 만들 여지는 프롬프트 준수도에 달린다. 로컬 validator가 막지만 사용자에게는
   `invalid`로 보인다. 실사용 실패율은 C1에서 관찰해야 한다.
3. **`api_error_status` 키 존재만으로 거절한다.** 계획서 계약 그대로다. Claude가 성공 응답에도 이
   키를 `null` 등으로 항상 담는 버전이 있다면 전부 `schemaMismatch`가 된다. C1 프리플라이트에서
   실제 성공 응답의 키 구성을 한 번 확인하는 것이 안전하다.
4. **`packages/cli`는 동시 작업 중이다.** 이 worktree는 cli를 건드리지 않았지만, 통합 시
   `pnpm build`를 반드시 다시 돌려야 한다. cli가 generate 산출물을 본다.
