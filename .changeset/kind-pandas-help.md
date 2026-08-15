---
"ohmymcp": minor
---

CLI에 전체·서브커맨드 도움말과 버전 출력을 추가합니다. 인자 없음, `--help`, `-h`, `help`는
사용 가능한 `test`·`generate` 명령을 stdout에 안내하고, `help <command>`와
`<command> --help`는 해당 명령의 사용법을 표시합니다. 사용법 오류에서도 두 명령과 전체 도움말을
발견할 수 있습니다.
