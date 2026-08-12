// 소스 기준으로 stdio 목을 띄우는 테스트용 진입점.
// 배포되는 진입점은 src/stdio.ts 이고, 이 파일은 빌드 없이 소스를 그대로 돌리기 위한 것이다.
import { readFileSync } from "node:fs";
import { serveStdio } from "../../src/index.ts";

await serveStdio(JSON.parse(readFileSync(process.argv[2], "utf8")));
