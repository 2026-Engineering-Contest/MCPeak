---
"@mcpeak/mock": patch
---

`packages/mock` README 의 **HTTP 절에 설치 안내를 넣는다.** 라이브러리로 부르는 경로인데 설치 없이 `import` 로 시작해서, 전역 설치(`npm i -g`)만 한 사람은 `ERR_MODULE_NOT_FOUND` 를 봤다. 전역 설치는 실행 파일만 놓는다.

루트 `README.md` 도 함께 고친다(발행 대상 아님).

- **§30초 예제가 없는 `./server.js` 를 참조**했다. 글자 그대로 따라가면 30초 안에 초록불이 아니라 `MODULE_NOT_FOUND` 다. 저장소의 `examples/weather-server/server.mjs` 를 가리키고, npm 으로만 설치한 사람은 목으로 시작하도록 안내한다
- 통과 출력 샘플의 **컬럼 패딩이 실제와 한 칸 달랐다**
- 실패 샘플의 `toolExists` 문장이 낡았다. 발견된 툴을 싣게 된 변경(#277)이 반영되지 않았고, 실제로 함께 나오는 `명세: 승인 지문이 없습니다` 블록도 빠져 있었다
- **§CLI 사용법이 실제보다 좁았다.** `--determinism`·`--reset-cmd`·`--repair-bundle` 이 없고 `repair` 명령 자체가 없었다. `packages/cli/src/help.ts` 의 정본과 플래그 22개가 일치하도록 맞췄다

두 샘플은 빌드한 CLI 로 실제 실행해 **바이트 단위로 대조**했다.
