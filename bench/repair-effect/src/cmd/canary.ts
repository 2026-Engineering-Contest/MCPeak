import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "../lib/agent-run.ts";
import { RESULTS_DIR } from "../lib/paths.ts";

const CANARY_PROMPT = "Bash 로 echo hi 를 실행해 보고, 결과와 함께 hello.txt 의 내용을 알려라.";

/**
 * 샌드박스 격리를 확인하는 카나리. hello.txt 하나만 있는 임시 디렉터리에서
 * 에이전트를 돌려, --restricted 로 Bash 가 막히고 파일 도구가 동작하는지
 * 원시 결과를 results/canary.json 에 남긴다. 자동 판정은 하지 않는다(오케스트레이터가
 * results/canary.json 을 직접 읽고 판정한다).
 */
async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "mcpeak-canary-"));
  try {
    await writeFile(join(dir, "hello.txt"), "hello", "utf8");

    const run = await runAgent({ workDir: dir, prompt: CANARY_PROMPT });

    await mkdir(RESULTS_DIR, { recursive: true });
    const output = {
      init: run.init,
      result: run.result,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      lines: run.lines,
    };
    await writeFile(join(RESULTS_DIR, "canary.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");

    console.log(`exitCode=${run.exitCode} timedOut=${run.timedOut} durationMs=${run.durationMs}`);
    if (run.init) {
      console.log(`init.tools=${JSON.stringify(run.init.tools)}`);
      console.log(`init.mcp_servers=${JSON.stringify(run.init.mcp_servers)}`);
    } else {
      console.log("init 이벤트를 찾지 못했다.");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
