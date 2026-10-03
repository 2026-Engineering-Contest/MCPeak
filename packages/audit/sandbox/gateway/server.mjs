// @ts-check
import { networkInterfaces } from "node:os";
import { addressInSubnet } from "./address.mjs";
import { startGateway } from "./gateway.mjs";

/**
 * 격리 게이트웨이의 컨테이너 진입점. `node /opt/mcpeak/gateway/server.mjs` 로 인자 없이 뜬다.
 *
 * env:
 * - MCPEAK_GATEWAY_TOKEN            제어 포트의 베어러 토큰. 필수.
 * - MCPEAK_GATEWAY_INTERNAL_SUBNET  internal 네트워크의 IPv4 CIDR(예: 172.24.0.0/16). 필수.
 *                                   이 서브넷에 든 자기 주소가 `A` 질의의 답이다.
 * - MCPEAK_GATEWAY_MODE             live | record | replay. 없으면 live.
 *
 * 듣는 곳은 0.0.0.0 의 UDP 53, TCP 80, TCP 443, TCP 7000(제어)이다.
 */

/**
 * @param {string} reason
 * @returns {never}
 */
function refuse(reason) {
  console.error(`→ 게이트웨이를 시작할 수 없습니다: ${reason}`);
  process.exit(1);
}

const token = process.env.MCPEAK_GATEWAY_TOKEN ?? "";
const subnet = process.env.MCPEAK_GATEWAY_INTERNAL_SUBNET ?? "";
const mode = process.env.MCPEAK_GATEWAY_MODE ?? "live";
// 읽은 뒤 지운다. 이 프로세스가 띄우는 자식(openssl)과 /proc/self/environ 을 읽는 코드에 남기지 않는다.
delete process.env.MCPEAK_GATEWAY_TOKEN;

if (token === "") refuse("MCPEAK_GATEWAY_TOKEN 이 비어 있습니다.");
if (mode !== "live" && mode !== "record" && mode !== "replay") {
  refuse(`MCPEAK_GATEWAY_MODE 는 live, record, replay 중 하나여야 합니다. 받은 값: '${mode}'`);
}
if (subnet === "") refuse("MCPEAK_GATEWAY_INTERNAL_SUBNET 이 비어 있습니다.");
const address = addressInSubnet(networkInterfaces(), subnet);
if (address === null) {
  refuse(`MCPEAK_GATEWAY_INTERNAL_SUBNET(${subnet}) 에 든 IPv4 주소를 가진 인터페이스가 없습니다.`);
}

try {
  const gateway = await startGateway({ token, mode, address });
  // PID 1 은 기본 신호 처리가 없다. 직접 받아 닫는다.
  for (const signal of /** @type {const} */ (["SIGTERM", "SIGINT"])) {
    process.on(signal, () => {
      void gateway.close().finally(() => process.exit(0));
    });
  }
} catch (error) {
  refuse(error instanceof Error ? error.message : String(error));
}
