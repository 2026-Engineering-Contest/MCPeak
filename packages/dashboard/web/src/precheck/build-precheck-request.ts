/**
 * 붙여 넣은 서버 → `POST /api/analyze/security` 의 본문(계획서 §5.3). 대상 옵션은 보안 탭·토큰 탭과 같은
 * `buildAnalyzeArgv` 가 만든다. env 이름과 헤더는 싣지 않는다. 대시보드 프로세스에 같은 이름의
 * 환경변수가 있으면 그 실제 값이 믿지 않는 서버에 가기 때문이다(ADR-0111).
 */

import type { AnalyzeSecurityRequest } from "../../../src/api-types.js";
import { buildAnalyzeArgv } from "../analyze/build-analyze-argv.js";
import type { PastedServer } from "./parse-server-input.js";

export function buildPrecheckRequest(
  server: PastedServer,
  sandbox: boolean,
): AnalyzeSecurityRequest {
  const argv = buildAnalyzeArgv({
    command: server.command,
    args: server.args,
    envNames: [],
    transport: server.transport,
    url: server.url,
    headerEnvs: [],
  });
  // 원격 대상은 격리할 수 없다. 토글이 켜져 있어도 싣지 않는다.
  return sandbox && server.transport === "stdio"
    ? { argv, sandbox: { compareHost: false, allowHosts: [] } }
    : { argv };
}
