# ADR-0055: `packages/mock/src` 가 저장소 공통 import 관례로 돌아온다

- 상태: 제안
- 날짜: 2026-08-21
- 담당: mock
- 작성자: @storyrago (③ mock server 파트)
- 승인: 미승인
- 대체 예정: [ADR-0030](./0030-mock-src-상대-import-확장자.md) — 이 문서가 승인되면 ADR-0030 의 상태를 `대체됨` 으로 바꾸고 색인도 같은 변경에서 갱신한다. 그전까지 ADR-0030 은 `채택` 이다.
- 참조: [ADR-0005](./0005-mock-data-strategy.md), #110, #109

## 배경

ADR-0030 은 `packages/mock/src` 가 형제 모듈을 `.ts` 확장자로 import 하도록 정했다.
`tests/fixtures/stdio-entry.mjs` 가 `src/` 를 빌드 없이 raw node
(`--experimental-strip-types`)로 돌리는데, Node 의 ESM 리졸버가 `.js` 를 `.ts` 로
매핑하지 않기 때문이다.

그 ADR 은 비용도 함께 기록했다. `tsconfig.base.json` 의 `paths` 가 `@mcpeak/mock` 을
**소스**로 매핑하므로, mock 을 TS 로 import 하는 소비자는 자기 `tsc --noEmit` 프로그램에
mock 소스를 딸려 들이고 `allowImportingTsExtensions` 가 없으면 깨진다.

```
packages/mock/src/index.ts(12,8): error TS5097: An import path can only end with a '.ts'
  extension when 'allowImportingTsExtensions' is enabled.
```

**오류가 소비자 본인이 고칠 수 없는 남의 패키지 파일에서 난다** — `CLAUDE.md` 의
"다른 오너의 패키지를 수정하지 마라" 와 정면으로 부딪힌다. #110 이 이것을 다루면서
선택지 넷을 제시했고, 그중 둘(`tsconfig.base.json` 으로 플래그를 올린다 · `paths` 가
`dist` 를 가리키게 한다)은 공유 설정이라 mock 오너 혼자 정할 수 없다고 적었다.

## 선택지

ADR-0030 이 검토한 것에 하나를 더한다.

**ⓐ 파일 재합병** — `key-violation.ts` 를 `index.ts` 로 되돌린다. 그 파일을 뗀 이유
(패키지 진입점에 판정 함수를 export 하지 않으면서 테스트가 직접 부르게 하는 경계)를
잃는다.

**ⓑ 소비자가 각자 플래그를 켠다** — 가장 싸지만 소비자가 늘 때마다 반복되고, 매번
"왜 이 플래그가 필요한가" 를 설명해야 한다. 비용을 남에게 미룬다.

**ⓒ 픽스처가 `dist` 를 물게 한다** — 유닛 테스트가 `pnpm build` 뒤로 밀린다.
`packages/cli/tests/dist-cli-e2e.mjs` 가 이미 빌드 의존 테스트를 담당하고,
`stdio-entry.mjs` 는 그와 별개로 **소스 자체**를 검증하려고 만든 것이다. ⓒ 로 가면
빌드에서 생긴 문제와 소스에서 생긴 문제의 구분이 사라진다.

**ⓓ 테스트 하네스가 리졸버 훅을 진다** — `src/` 는 저장소 공통 관례대로 `.js` 를
쓰고, 픽스처가 `module.register()` 로 상대 `.js` → `.ts` 매핑 훅을 등록한다.

## 결정

**ⓓ 를 택한다.**

- `packages/mock/src` 의 형제 import 를 `.js` 로 되돌린다 — 나머지 다섯 패키지와 같다.
- `packages/mock/tsconfig.json` 의 `allowImportingTsExtensions` 를 제거한다.
- `tests/fixtures/ts-resolve.mjs` 가 훅 본체를, `register-ts-resolve.mjs` 가 등록을
  맡고, `tests/stdio.test.ts` 가 자식을 띄울 때 `--import` 로 함께 싣는다.
- 훅은 **상대 명세자이면서 같은 자리에 `.ts` 가 실재할 때만** 돌린다. 베어 명세자
  (`@mcpeak/core` 등)와 실재하지 않는 경로는 건드리지 않아 Node 가 평소의 오류를 낸다.

## 이유

ⓓ 는 ⓐ·ⓑ·ⓒ 가 각각 내던 비용을 내지 않는다. 모듈 경계도, 소비자의 타입체크도,
빌드 없는 소스 검증도 그대로 남는다.

**비용을 옳은 자리에 둔다.** 이 제약을 만든 것은 테스트 하네스이지 배포되는 코드가
아니다. ADR-0030 은 하네스의 제약을 `src/` 의 관례로 갚았고, 그 청구서가 소비자에게
갔다. ⓓ 는 하네스가 자기 비용을 진다.

**공유 설정을 건드리지 않는다.** #110 의 선택지 2·4 는 `tsconfig.base.json` 을 바꿔야
해서 오너 전원의 합의가 필요했다. ⓓ 는 변경이 전부 `packages/mock` 안에서 끝난다.

`--experimental-strip-types` 가 Node 22.6+ 라 이 묶음은 이미 `canStripTypes` 로
게이트돼 있다. `module.register()` 는 Node 20.6+ 이므로 이 훅이 지원 범위를 더 좁히지
않는다.

## 결과

**얻은 것** — mock 이 저장소의 다른 패키지와 같은 import 관례를 쓴다. 다른 패키지를
보고 따라 쓴 사람이 여기서만 깨지는 일이 없어졌다. mock 을 TS 로 import 하는 첫
소비자가 아무 준비 없이 그냥 쓸 수 있다. #110 이 기다리던 결정이 mock 소유권 안에서
끝났다.

**받아들인 비용** — 픽스처를 직접 `node` 로 돌릴 때 `--import` 를 빠뜨리면
`ERR_MODULE_NOT_FOUND` 가 난다. 그래서 이유를 `stdio-entry.mjs` 머리와
`stdio.test.ts` 의 `tsResolve` 위에 주석으로 남겼다. 파일이 둘 늘었다.

**확인한 것** — 훅을 빼고 픽스처를 직접 돌려 `ERR_MODULE_NOT_FOUND` 로 죽는 것을
보고, 붙이면 서버가 뜨는 것을 봤다. 훅이 실제로 무게를 지고 있다는 뜻이다.
소비자 재현(`tsconfig.base.json` 을 extends 하는 스크래치 프로젝트)에서 TS5097 이
0건이 됐다. mock 유닛 테스트 107건이 통과하고, 그중 자식 프로세스를 띄우는 7건이
건너뛰지 않고 실제로 돌았다.

**후속 과제** — ADR-0030 의 "다른 패키지가 소스를 빌드 없이 raw node 로 돌리는
테스트를 도입하면 관례를 저장소 전체로 통일할지 재검토한다" 는 그대로 남는다. 그때
통일할 대상은 `.ts` 확장자가 아니라 이 리졸버 훅이다.

**남는 것** — `tsconfig.base.json` 의 `paths` 가 소스를 가리키는 구조 자체는 그대로다.
이 ADR 은 그 구조에서 mock 이 만들던 문제를 없앨 뿐, 구조를 바꾸지 않는다. `paths` 를
`dist` 로 옮길지는 여전히 오너 전원의 판단이고 이 ADR 의 범위 밖이다.
