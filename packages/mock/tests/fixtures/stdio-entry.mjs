// 소스 기준으로 stdio 목을 띄우는 테스트용 진입점.
// 배포되는 진입점은 src/stdio.ts 이고, 이 파일은 빌드 없이 소스를 그대로 돌리기 위한 것이다.
//
// 빌드를 거치지 않으므로 여기서 시작하는 import 사슬은 **Node 의 ESM 리졸버**가 푼다.
// 그 리졸버는 ".js" 를 ".ts" 로 매핑하지 않으므로, 이 진입점은 반드시
// register-ts-resolve.mjs 를 `--import` 로 함께 실어서 띄운다. 빠뜨리면
// ERR_MODULE_NOT_FOUND 로 서버가 즉시 죽고, 테스트에는 "요청 완료 전 MCP 서버가
// 종료되었습니다" 로만 보인다. 배선은 tests/stdio.test.ts 의 connectMock 에 있다.
import { readFileSync } from "node:fs";
import { serveStdio } from "../../src/index.js";

await serveStdio(JSON.parse(readFileSync(process.argv[2], "utf8")));
