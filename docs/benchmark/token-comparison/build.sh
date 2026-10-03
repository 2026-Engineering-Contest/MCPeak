#!/usr/bin/env bash
# 조건별 실행 디렉터리를 만든다. runs/<시나리오>/<조건>/ 에 서버·지침만 복사한다.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
runs="${MCPEAK_BENCH_RUNS:-$HOME/.mcpeak-bench/runs}"  # 저장소 밖. 상위 CLAUDE.md 와 자동 메모리를 상속하지 않기 위해서다
# runs/ 를 지우지 않는다. trial-N/ 의 추적 기록은 보존하고 기본 파일만 덮어쓴다.

make_run() { # 시나리오 조건 서버경로 requirements여부 B안변형(suite|full)
  local s="$1" c="$2" server="$3" req="$4" variant="${5:-suite}"
  local dir="$runs/$s/$c"
  mkdir -p "$dir"
  # 서버 파일의 주석을 벗긴다. 예제 서버는 주석에 결함 위치를 적어 두므로 정답 힌트가 된다.
  node "$here/strip-comments.mjs" "$root/$server" | sed 's/example-weather-server-broken-demo/example-weather-server/; s/zod-notes-server-mutant/zod-notes-server/' > "$dir/server.mjs"
  # 주석 제거기는 정규식 리터럴 안의 /* 를 구분하지 못한다. 산출물의 구문을 확인해 손상을 막는다.
  node --check "$dir/server.mjs" || { echo "주석 제거 결과가 유효한 JS 가 아닙니다: $server"; exit 1; }
  local method="$here/method-$c.md"; [ "$c" = mcpeak ] && method="$here/method-mcpeak-$variant.md"
  # agent 조건: 실험용 파이프라인 파일을 함께 둔다
  [ "$c" = agent ] && cp "$here/agent-pipeline/mcpeak-agent.mjs" "$here/agent-pipeline/lib.mjs" "$here/agent-pipeline/empty-mcp.json" "$dir/"
  cat "$here/task.md" "$method" > "$dir/CLAUDE.md"
  [ "$req" = yes ] && cp "$here/requirements.md" "$dir/requirements.md"
  # B안은 사람이 승인해 둔 명세에서 시작한다. suites/ 는 build 전에 만들어 둔다(README 참고).
  [ "$c" = mcpeak ] && [ "$variant" = suite ] && cp "$here/suites/$s.suite.json" "$dir/server.suite.json"
  [ "$c" = mcpeak ] && [ "$variant" = full ] && rm -f "$dir/server.suite.json"
  cat > "$dir/package.json" <<JSON
{
  "name": "bench-$s-$c",
  "private": true,
  "type": "module",
  "dependencies": { "@modelcontextprotocol/sdk": "$(node -e 'console.log(require("'"$root"'/examples/zod-notes-server/node_modules/@modelcontextprotocol/sdk/package.json").version)')", "zod": "4.4.3" }
}
JSON
}

make_run s1 manual examples/weather-server/server.broken-demo.mjs no
make_run s1 mcpeak examples/weather-server/server.broken-demo.mjs no
make_run s2 manual examples/zod-notes-server/server.mutant.mjs yes
make_run s2 mcpeak examples/zod-notes-server/server.mutant.mjs yes
# S3: live-weather-server 의 로컬 툴 6개. 전 과정(generate 부터) 구도.
make_run s3 manual docs/benchmark/token-comparison/servers/s3.mjs no
make_run s3 mcpeak docs/benchmark/token-comparison/servers/s3.mjs no full
# agent 조건: 에이전트용 파이프라인(명령 하나). S1·S3 에서 A안과 비교한다
make_run s1 agent examples/weather-server/server.broken-demo.mjs no
make_run s3 agent docs/benchmark/token-comparison/servers/s3.mjs no

# 공통 본문이 두 조건에서 같은지 확인한다.
for s in s1 s2 s3; do
  n=$(wc -l < "$here/task.md")
  for c in mcpeak agent; do
    [ -f "$runs/$s/$c/CLAUDE.md" ] || continue
    diff <(head -n "$n" "$runs/$s/manual/CLAUDE.md") <(head -n "$n" "$runs/$s/$c/CLAUDE.md") >/dev/null \
      || { echo "공통 본문이 다릅니다: $s $c"; exit 1; }
  done
done
echo "$runs 생성 완료. 각 디렉터리에서 npm install 뒤 README 의 명령으로 실행한다."
