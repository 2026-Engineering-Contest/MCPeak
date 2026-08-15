# ADR-0028: `packages/mock/src` 의 상대 import 확장자

- 상태: 제안
- 날짜: 2026-08-15
- 작성자: @storyrago (③ mock server 파트)

## 배경

`packages/mock/tests/fixtures/stdio-entry.mjs` 는 `src/index.ts` 를 빌드 없이
raw node(`--experimental-strip-types`)로 직접 돌린다. `serveStdio` 를 stdio 트랜스포트로
검증하는 유닛 테스트가 `tsdown` 빌드를 기다리지 않고 `npx vitest run` 만으로 돌게 하기
위해서다.

이번 작업(매칭 키 정규화)에서 판정 로직을 `src/key-violation.ts` 로 새로 분리하면서
`index.ts` 가 그것을 상대 import 로 가져오게 됐는데, 여기서 실제로 막혔다. Node 의 ESM
리졸버는 `.js` 확장자를 `.ts` 파일로 매핑하지 않는다. 저장소의 다른 패키지가 쓰는
관례(`import ... from "./foo.js"`, 빌드 산출물 기준)를 그대로 쓰면 `ERR_MODULE_NOT_FOUND`
로 서버 프로세스가 즉시 죽는다. 그런데 이 실패는 `stdio-entry.mjs` 를 통해 MCP
클라이언트로 관측되므로, 테스트에는 원인이 전혀 보이지 않고 *"요청 완료 전 MCP
서버가 종료되었습니다"* 로만 나타난다. 저장소의 다른 패키지도 `.js` 확장자를 쓰지만,
그쪽에는 소스를 빌드 없이 그대로 실행하는 테스트가 없어 같은 문제를 겪지 않는다.

이번에 하나의 import 문에서 부딪힌 문제지만, `mock/src` 안에서 파일을 더 나눌 때마다
같은 상대 import 가 생긴다. 계획서 안에만 판단을 남기면 다음 사람(또는 다음 세션의
나)이 같은 오류를 다시 겪고 다시 원인을 찾아야 한다.

## 선택지

- **ⓐ 파일을 다시 합쳐 상대 import 를 없앤다.** `key-violation.ts` 를 `index.ts` 로
  되돌리면 이 import 자체가 사라진다.
- **ⓑ `.ts` 확장자로 import 하고, `packages/mock/tsconfig.json` 에
  `allowImportingTsExtensions` 를 켠다.**
- **ⓒ `stdio-entry.mjs` 가 `src` 대신 `dist` 를 물게 한다.** raw node 실행을 그만두고
  빌드 산출물을 실행하는 테스트로 바꾼다.

## 결정

**ⓑ.** 상대 import 는 `./key-violation.ts` 처럼 확장자를 `.ts` 로 쓰고,
`packages/mock/tsconfig.json` 에 `allowImportingTsExtensions: true` 를 추가한다.

## 이유

`moduleResolution` 이 `Bundler`(`tsconfig.base.json`)이고, 이 패키지의 `typecheck` 는
`tsc --noEmit` 이며 실제 배포 빌드는 `tsdown` 이 맡는다 — 이 조합에서
`allowImportingTsExtensions` 는 타입체크만 통과시키면 되고, 빌드 산출물의 import 문
확장자는 `tsdown` 이 다시 써서 내보내므로 문제가 없다. 변경 범위도 `packages/mock`
안으로 끝나고, 공유 `tsconfig.base.json` 은 건드리지 않는다.

ⓐ(파일 재합병)는 이 작업이 `key-violation.ts` 를 따로 뗀 이유 자체를 되돌린다.
`index.ts` 는 패키지 진입점이라 거기 있는 모든 export 가 공개 API 가 되는데, 판정
함수(`findKeyViolation`)를 테스트가 직접 부르려면 export 가 필요하다. 별도 모듈로
두면 테스트는 `../src/key-violation.ts` 를 직접 import 하고 패키지 밖에서는 보이지
않는다. 재합병하면 이 경계를 잃는다.

ⓒ(빌드 산출물 실행)는 `npx vitest run` 만으로 돌던 유닛 테스트를 `pnpm build` 뒤로
미룬다. `packages/cli/tests/dist-cli-e2e.mjs` 가 이미 빌드 의존 테스트를 담당하고
있고, `stdio-entry.mjs` 는 그와 별개로 **소스를 직접** 검증하려고 만든 것이다(빌드
과정에서 생기는 문제와 소스 자체의 문제를 구분하기 위해서). ⓒ 로 가면 이 구분이
사라진다.

## 결과

**얻은 것** — raw node 실행 경로가 살아 있고, `key-violation.ts` 분리로 얻은 공개
API 경계도 그대로다.

**받아들인 비용** — `packages/mock` 만 저장소의 다른 패키지와 다른 관례
(`.js` 대신 `.ts` 확장자)를 쓴다. 새로 합류하는 사람이 다른 패키지의 import 문을
보고 그대로 따라 쓰면 이 패키지에서만 깨진다. 그래서 이유를 `src/index.ts` 의 해당
import 문 바로 위와 `tests/fixtures/stdio-entry.mjs` 머리에 주석으로 남겼다 — 이
ADR 을 못 찾은 사람도 코드를 읽다가 이유를 보게 하기 위해서다.

**후속 과제** — 다른 패키지가 소스를 빌드 없이 raw node 로 돌리는 테스트를 도입하면
그때 이 관례를 저장소 전체로 통일할지 다시 검토한다. 지금은 이런 테스트를 가진
패키지가 `mock` 뿐이라 통일할 대상이 없다.
