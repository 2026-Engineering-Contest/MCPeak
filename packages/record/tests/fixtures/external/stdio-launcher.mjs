/**
 * `npx` 와 같은 구조의 최소 런처. Node 프로세스 하나를 사이에 끼우고 stdio 를 그대로
 * 물려준다. `npx` 자체를 테스트에 쓰지 않는 이유는 네트워크와 레지스트리 캐시에 의존하게
 * 되기 때문이다. 여기서 재현하려는 것은 "중간에 Node 가 낀다" 하나뿐이다.
 */
import { spawn } from "node:child_process";
import { get } from "node:http";

// 설계 §7.2 케이스 3. 런처가 설정을 **보는지** 를 런처의 눈으로 찍는다. 보고도 삼키지 않는
// 것이 결정 1의 내용이라, 보지 못하면 그 케이스는 아무것도 증명하지 않는다.
if (process.env.MCPEAK_TEST_DUMP_ENV !== undefined)
  process.stderr.write(
    `LAUNCHER_SEES_MODE=${JSON.stringify(process.env.MCPEAK_EXTERNAL_MODE ?? null)}\n`,
  );

/**
 * ADR-0096. 런처 자신이 내는 범위 밖 호출을 흉내 낸다 — `npx` 의 레지스트리 트래픽이 이
 * 자리다.
 *
 * **`fetch` 를 쓰지 않는다.** 쓰면 런처가 어댑터에 잡혀 이 세션의 기록자가 되어 버리고,
 * 그러면 이 픽스처가 재려던 것(기록자가 아닌 프로세스의 호출이 섞이는가)이 사라진다.
 *
 * **자식을 띄우기 전에 끝낸다.** 두 프로세스의 종료 순서가 실행마다 흔들리면 이 파일을 쓰는
 * 테스트가 가끔 실패한다.
 */
if (process.env.MCPEAK_TEST_LAUNCHER_PING !== undefined)
  await new Promise((resolve) => {
    get(process.env.MCPEAK_TEST_LAUNCHER_PING, (response) => {
      response.resume();
      response.on("end", resolve);
    }).on("error", resolve);
  });

const child = spawn(process.execPath, process.argv.slice(2), { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
