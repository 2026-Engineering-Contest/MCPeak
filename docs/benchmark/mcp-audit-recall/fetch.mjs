#!/usr/bin/env node
/**
 * MCPTox 벤치마크를 임시 디렉터리에 받는다. 저장소에는 사례 데이터를 넣지 않는다(라이선스가 없다).
 *
 *   node docs/benchmark/mcp-audit-recall/fetch.mjs [대상 디렉터리]
 *
 * 대상 디렉터리를 주지 않으면 OS 임시 디렉터리 아래에 새로 만든다. 마지막 줄에 받은 경로를,
 * 그 앞 줄에 커밋 SHA 를 찍는다. measure.mjs 가 그 경로를 받는다.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPOSITORY = "https://github.com/zhiqiangwang4/MCPTox-Benchmark";

const dest = process.argv[2] ?? join(mkdtempSync(join(tmpdir(), "mcptox-")), "MCPTox-Benchmark");
try {
  execFileSync("git", ["clone", "--depth", "1", "--quiet", REPOSITORY, dest], { stdio: "inherit" });
} catch {
  console.error(`→ ${REPOSITORY} 를 받지 못했습니다.`);
  console.error("→ 네트워크와 git 설치를 확인하세요. 받지 못하면 RESULTS.md 는 '미측정' 으로 둡니다.");
  process.exit(1);
}
const sha = execFileSync("git", ["-C", dest, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
console.log(`commit ${sha}`);
console.log(dest);
