#!/usr/bin/env bash
# 한 조건을 한 번 돌린다: ./run.sh <s1|s2> <manual|mcpeak> [회차번호] [모델]
# 결과는 runs/<s>/<c>/trial-<n>/ 에 result.json(usage 포함), report.md, 남긴 파일이 들어간다.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
s="$1"; c="$2"; n="${3:-1}"; model="${4:-sonnet}"
runs="${MCPEAK_BENCH_RUNS:-$HOME/.mcpeak-bench/runs}"
src="$runs/$s/$c"
dir="$src/trial-$n"
log="$src/logs/trial-$n"  # 에이전트가 자기 실행 기록을 읽지 못하게 trial 폴더 밖에 둔다
rm -rf "$dir" "$log"; mkdir -p "$dir" "$log"
cp "$src/CLAUDE.md" "$src/package.json" "$src/server.mjs" "$dir/"
[ -f "$src/requirements.md" ] && cp "$src/requirements.md" "$dir/"
[ -f "$src/server.suite.json" ] && cp "$src/server.suite.json" "$dir/"
for f in mcpeak-agent.mjs lib.mjs empty-mcp.json; do [ -f "$src/$f" ] && cp "$src/$f" "$dir/"; done
ln -s "$src/node_modules" "$dir/node_modules"
cd "$dir"
env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT claude -p "$(cat "$here/prompt.txt")" \
  --model "$model" --output-format stream-json --verbose --max-turns 60 --dangerously-skip-permissions \
  --setting-sources project --strict-mcp-config --mcp-config "$here/empty-mcp.json" --disable-slash-commands \
  > "$log/trace.jsonl" 2> "$log/stderr.log" || echo "claude 종료 코드 $?" >&2
# 마지막 줄(type: result)이 usage 요약이다. 앞줄들은 턴별 메시지·도구 호출이다.
grep '"type":"result"' "$log/trace.jsonl" | tail -1 > "$log/result.json"
cd "$log"
node -e '
const fs = require("fs");
const r = JSON.parse(fs.readFileSync("result.json","utf8"));
// agent 조건: 파이프라인 내부의 좁은 LLM 호출을 B 총합에 더한다
const dir = process.argv[5]; let llm = null;
try { llm = JSON.parse(fs.readFileSync(dir + "/agent-usage.json", "utf8")); } catch {}
if (llm) { r.total_cost_usd += llm.cost; r.llm_inner = llm; }
const tools = fs.readFileSync("trace.jsonl","utf8").split("\n").filter(Boolean).map(l=>JSON.parse(l))
  .filter(m=>m.type==="assistant").flatMap(m=>(m.message?.content??[]).filter(c=>c.type==="tool_use"))
  .map(c=>c.name+"("+(c.input?.command??c.input?.file_path??"").toString().slice(0,80)+")");
fs.writeFileSync("tools.txt", tools.join("\n")+"\n");
const init = fs.readFileSync("trace.jsonl","utf8").split("\n").filter(Boolean).map(l=>JSON.parse(l)).find(m=>m.type==="system"&&m.subtype==="init");
console.error("환경: tools="+(init?.tools?.length)+" mcp="+(init?.mcp_servers?.length)+" slash="+(init?.slash_commands?.length));
const u = r.usage ?? {};
console.log(JSON.stringify({ scenario: process.argv[1], condition: process.argv[2], trial: process.argv[3], model: process.argv[4],
  num_turns: r.num_turns, duration_ms: r.duration_ms, total_cost_usd: r.total_cost_usd,
  input_tokens: u.input_tokens, output_tokens: u.output_tokens,
  cache_creation_input_tokens: u.cache_creation_input_tokens, cache_read_input_tokens: u.cache_read_input_tokens,
  report_exists: fs.existsSync(dir+"/report.md"), llm_inner: r.llm_inner ?? null }));
' "$s" "$c" "$n" "$model" "$dir" | tee "$log/summary.json"
