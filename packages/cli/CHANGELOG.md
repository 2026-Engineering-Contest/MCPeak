# ohmymcp

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
