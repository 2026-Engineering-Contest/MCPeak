# ohmymcp

## 0.7.0

### Minor Changes

- b6658b9: CLI에 전체·서브커맨드 도움말과 버전 출력을 추가합니다. 인자 없음, `--help`, `-h`, `help`는
  사용 가능한 `test`·`generate` 명령을 stdout에 안내하고, `help <command>`와
  `<command> --help`는 해당 명령의 사용법을 표시합니다. 사용법 오류에서도 두 명령과 전체 도움말을
  발견할 수 있습니다.
- 0dd2a02: cli: `generate` 의 시험 실행이 실패한 케이스의 입력값을 고쳐 다시 호출합니다. 스키마에 힌트가
  없어 합성된 값(`"example"` 같은 것)이 서버에 거절당한 실패는 이제 분류 화면에 도달하지 않고
  교정 단계에서 닫힙니다. 케이스 하나당 최대 2회 고치고, 통과한 값은 기존 3단 경로를 거쳐 저장될
  명세에 반영됩니다. `--provider` 가 있으면 서버의 오류 응답을 근거로 값 후보를 받고, AI 가 값
  말고 다른 것을 건드린 응답은 통째로 폐기합니다. 두 번 고쳐도 실패하면 분류 화면으로 가고 시도
  이력이 함께 나옵니다. `--no-repair` 로 이 단계를 끌 수 있습니다.

  `Final fingerprint:` 표시가 시험 실행과 분류 뒤로 옮겨집니다. 교정이 명세를 바꾸므로 앞에서
  찍으면 사용자가 승인한 지문과 저장되는 `approval.fingerprint` 가 갈립니다. 교정이 없으면 찍히는
  값은 이전과 같고 화면 순서만 바뀝니다.

### Patch Changes

- Updated dependencies [81579f1]
- Updated dependencies [81579f1]
- Updated dependencies [ec99eab]
- Updated dependencies [0f4e5fd]
  - @ohmymcp/record@0.1.1
  - @ohmymcp/runner@0.7.0
  - @ohmymcp/generate@0.4.2

## 0.6.1

### Patch Changes

- Updated dependencies [0d92470]
- Updated dependencies [38ec704]
  - @ohmymcp/core@0.2.0
  - @ohmymcp/record@0.1.0
  - @ohmymcp/generate@0.4.1
  - @ohmymcp/mock@0.1.2
  - @ohmymcp/runner@0.6.1

## 0.6.0

### Minor Changes

- fb40da5: `ohmymcp test` 에 `--junit <path>` 를 추가합니다. runner 가 만든 JUnit XML 을 그 경로에 파일로
  써서, CI 도구가 테스트 결과를 화면에 렌더할 수 있게 합니다. `renderJUnit` 은 공개 API 였지만
  CLI 에 리포터를 고르는 수단이 없어 사용자가 쓸 방법이 없었습니다. 이 플래그가 그 연결입니다.

  `--junit=<path>` 형태도 받습니다. 중복 지정, 값 없음, 빈 값, `--` 로 시작하는 값은 거절합니다.
  경로 자리의 플래그는 값을 빠뜨린 오타이지 그 이름의 파일을 만들라는 뜻이 아니기 때문입니다.

  **`--json` 과 함께 쓸 수 있습니다.** 둘은 경쟁하지 않습니다 — `--json` 은 stdout 형식을,
  `--junit` 은 별도 산출물을 정합니다. `--junit` 은 stdout 을 바꾸지 않으므로 사람이 읽는 보고서를
  보면서 CI 용 XML 을 함께 만들 수 있습니다. 플래그 형태와 출력 대상을 고른 근거는 ADR-0019 에
  있습니다.

  XML 은 stdout 보다 먼저 씁니다. `| head` 같은 파이프에서 stdout 이 EPIPE 로 끊겨도 요청한
  산출물은 디스크에 남습니다. 파일을 쓰지 못하면 모든 테스트가 통과했더라도 `JUNIT_WRITE_FAILED`
  와 함께 종료 코드 1 을 냅니다. 조용히 0 을 내면 CI 는 리포트 없이 초록이 되고, 사용자는 리포트가
  필요한 순간에야 없다는 것을 알게 되기 때문입니다.

  `--junit` 을 주지 않으면 출력 바이트와 종료 코드가 이전과 동일합니다.

- d31c26e: 입력 계약 대조 결과를 승인 화면과 `test` 출력에 배선한다.

  `runner` 가 이미 갖고 있던 `checkInputContract` · `checkAssertionSubstance` 를 두 소비자에 연결해,
  오타·타입 불일치·항상 참인 단언이 승인 전과 실패 직후에 문장으로 보인다.

  - `ohmymcp generate` 승인 화면은 선택한 변경에 걸린 위반을 세어 보여 주고, 위반이 있으면 확인을
    한 번 더 받는다. 거부하지는 않는다.
  - `ohmymcp test` 는 실패한 케이스에만 참고 문장을 붙인다. 판정과 exit code 는 바뀌지 않는다.
    `--json` 은 `spec.findings` 에 구조로 담는다.

  공개 타입 변경 둘이 있다.

  - `@ohmymcp/runner` 의 `SpecFindingCode` 에서 `UNCONSTRAINED_SCHEMA` 가 사라진다. 소비자 경로에서
    `validateMcpSuite` 가 먼저 거부해 도달할 수 없는 코드였다.
  - `@ohmymcp/generate` 의 `SanitizedAuthoringCandidate` 에 `specFindings` 필드가 생긴다. 승인
    지문 계산 대상 밖이라 이미 승인된 지문은 그대로다.

### Patch Changes

- Updated dependencies [d31c26e]
  - @ohmymcp/generate@0.4.0
  - @ohmymcp/runner@0.6.0

## 0.5.0

### Minor Changes

- 3430f8f: generate 가 저장하는 명세에 `approval.fingerprint` 를 기록하고, test 가 실행 시점에 계산한
  지문과 대조해 결과를 보고서에 적습니다. 지문은 `approval` 블록을 제외한 명세 전체의 sha256
  이므로 들여쓰기나 키 순서 같은 표기 변경으로는 달라지지 않습니다.

  **판정은 바뀌지 않습니다.** 종료 코드는 케이스 결과로만 정해집니다. 명세를 고치는 것은 정상
  작업이고, 그때마다 테스트가 막히면 사용자는 확인 절차를 우회하는 방법부터 찾게 됩니다.

  표시는 전부 통과일 때 불일치만 알리고, 실패가 있으면 세 상태를 모두 알립니다. 매 실행 한 줄은
  손으로 명세를 쓰는 사용자에게 영구 소음이기 때문입니다. `--json` 에는 억제 규칙을 적용하지
  않고 `spec` 키를 항상 넣습니다. 기존 보고서 키는 그대로입니다.

  지문이 없는 명세도 그대로 실행됩니다. 손으로 쓴 명세와 이 기능 이전에 만든 명세가 여기에
  해당합니다.

### Patch Changes

- Updated dependencies [c0d17d6]
- Updated dependencies [c728f02]
- Updated dependencies [9803c19]
- Updated dependencies [cfa921d]
  - @ohmymcp/mock@0.1.1
  - @ohmymcp/runner@0.5.0
  - @ohmymcp/generate@0.3.5

## 0.4.1

### Patch Changes

- Updated dependencies [d8227e2]
  - @ohmymcp/runner@0.4.0
  - @ohmymcp/generate@0.3.4

## 0.4.0

### Minor Changes

- f4a78b0: `ohmymcp test` 가 실패했거나 서버가 비정상 종료·중단했을 때, 보여줄 진단 정보가 있으면 서버
  프로세스 진단을 stderr 에 출력합니다. 종료 코드, 시그널, 서버가 남긴 stderr 의 마지막 줄들을
  보여줍니다. 기동 즉시 죽는 서버처럼 지금까지 단서가 전혀 없던 경로에서도 원인을 볼 수 있습니다.

  서버 프로세스와 무관한 실패에는 붙지 않습니다. 명세 검증 실패처럼 연결 이전에 끝나는 경로와
  보고서 렌더링 중의 내부 오류가 그렇습니다.

  `--stderr-lines <N>` 으로 표시할 줄 수를 조절합니다. 기본값은 20 이고 `0` 을 주면 진단을 끕니다.

  진단은 stdout 이 아니라 stderr 로 나가므로 `--json` 출력의 바이트는 이전과 같습니다. 판정과
  종료 코드도 바뀌지 않았습니다. 서버가 정상 종료하고 stderr 도 비어 있으면 보여줄 근거가 없으므로
  블록을 출력하지 않습니다.

## 0.3.1

### Patch Changes

- Updated dependencies [4da5f7c]
  - @ohmymcp/runner@0.3.1
  - @ohmymcp/generate@0.3.3

## 0.3.0

### Minor Changes

- 74c96da: `ohmymcp test` 의 기본 출력을 사람이 읽는 보고서로 바꿉니다. 실패한 케이스의 진단 문장과
  해결 힌트를 터미널에 직접 표시합니다.

  **파괴적 변경**: 기존의 JSON 출력은 `--json` 플래그로 옮겼습니다. stdout을 기계로 파싱하던
  스크립트는 `ohmymcp test ... --json` 으로 바꿔야 합니다. `--json` 출력의 바이트는 이전과
  동일합니다. 종료 코드는 바뀌지 않았습니다.

### Patch Changes

- Updated dependencies [74c96da]
  - @ohmymcp/runner@0.3.0
  - @ohmymcp/generate@0.3.2

## 0.2.2

### Patch Changes

- Updated dependencies [a1f9bb4]
  - @ohmymcp/runner@0.2.0
  - @ohmymcp/generate@0.3.1

## 0.2.1

### Patch Changes

- Updated dependencies [ed2a3b8]
  - @ohmymcp/generate@0.3.0

## 0.2.0

### Minor Changes

- 0bf2549: 결정론적 baseline과 사용자 Codex·Claude를 이용한 반복 검토를 지원하는 generate 명령을 추가합니다.

### Patch Changes

- 0b89688: suite 저장을 원자적 no-clobber로 바꾼다. 지금까지는 저장 전에 출력 경로를 검사한 뒤 `rename`으로
  커밋했는데, `rename`은 대상이 있으면 말없이 덮어쓴다. 검사와 커밋 사이에 다른 프로세스가 같은
  경로를 만들면 그 파일이 조용히 사라졌다. 이제 `link`로 커밋해 대상이 있으면 `EEXIST`로 실패하고
  `GENERATE_OUTPUT_EXISTS`로 안내한다. 임시 파일 이름도 실행마다 고유해진다.
- 5899f3d: generate의 provider 실패 안내를 원인별로 다시 쓴다. `nonZeroExit`의 `reason`에 따라
  `GENERATE_PROVIDER_MODEL`, `GENERATE_PROVIDER_AUTH`, `GENERATE_PROVIDER_RATE_LIMIT`,
  `GENERATE_PROVIDER_REQUEST`, `GENERATE_PROVIDER_SERVER`로 나눠 안내하고, 실패한 모델 이름과
  provider 기본 모델을 함께 보여준다. 로그인 확인 명령도 해당 provider의 것만 찍는다.
  지금까지는 codex로 실패해도 `claude /status`가 같이 나왔다.
- c77f668: 출력 디렉터리가 hard link를 지원하지 않거나 권한이 없어 저장이 막힌 경우를
  `GENERATE_LINK_UNSUPPORTED`로 따로 안내한다. 지금까지는 일반 실패로만 끝나 사용자가 무엇을
  바꿔야 다시 시도할 수 있는지 알 수 없었다. 이제 경로와 원인 코드, 그리고 다른 디렉터리를
  `--out`으로 지정하라는 조치를 함께 보여준다.
- 8f495c4: generate의 AI provider 실패를 원인별로 분기해 안내한다. `providerUnavailable`, `nonZeroExit`,
  `timedOut`, `schemaMismatch`, `cancelled`는 각각 다른 오류 코드와 조치 문장을 출력하고, 나머지
  코드는 기존 `GENERATE_PROVIDER_FAILED` 문구를 유지한다.
- 3272114: `--baseline-only`가 실제 터미널에서 종료되지 않던 문제를 고친다. readline 인터페이스를 명령
  시작 시점이 아니라 첫 질문 시점에 만들도록 바꿔, 아무것도 묻지 않는 경로에서는 입력 스트림을
  잡지 않는다.

  출력 경로에 파일이 이미 있어 저장이 막힌 경우를 다른 I/O 실패와 분리해
  `GENERATE_OUTPUT_EXISTS`로 안내한다. 경로와 다음 조치를 함께 보여준다. 대화형·비대화형 두
  경로 모두에 적용된다.

- f393c48: generate AI 검토의 승인 화면이 무엇이 바뀌는지 보여준다. 지금까지 change ID와 종류만 찍어
  사용자가 내용을 모른 채 승인해야 했다. 이제 각 change 아래에 바뀐 leaf 경로를 `-`와 `+`로
  보여주고, 케이스 추가·삭제는 전체 경로를, 순서 변경은 before와 after 순서를 보여준다.
  본문이 40줄을 넘으면 잘라내고 남은 줄 수를 알린다.
- 930e6ba: 대화형 검토 중 stdin이 EOF로 닫히면 Node readline 스택을 노출하며 비정상 종료하던 문제를 고친다.
  이제 취소와 같은 경로로 종료 코드 0으로 끝나고 `입력이 종료되어 검토를 취소했습니다. 저장하지
않았습니다.`만 출력한다. 닫힘이 아닌 오류는 기존대로 전파한다.
- Updated dependencies [0694441]
- Updated dependencies [77d7623]
- Updated dependencies [ba4bc97]
- Updated dependencies [53d0440]
- Updated dependencies [7c1cf62]
- Updated dependencies [3760bac]
- Updated dependencies [623eea0]
  - @ohmymcp/generate@0.2.0
  - @ohmymcp/mock@0.1.0

## 0.1.0

### Minor Changes

- c42f6a8: JSON 테스트 명세와 stdio MCP 서버 실행 정보를 받아 실제 RunnerReport와 종료 코드를 만드는 test 명령을 추가한다.

### Patch Changes

- Updated dependencies [606600f]
- Updated dependencies [b80e0e5]
  - @ohmymcp/core@0.1.0
  - @ohmymcp/generate@0.1.0
  - @ohmymcp/mock@0.0.1
  - @ohmymcp/record@0.0.1
  - @ohmymcp/runner@0.1.1

## 0.0.1

### Patch Changes

- Updated dependencies [216184a]
  - @ohmymcp/runner@0.1.0
