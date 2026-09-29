#!/usr/bin/env bash
# 여러 회차를 한 번에 돌린다: ./run-batch.sh "s1:6,7,8" "s2:3,4,5,6" [모델]
# 인자가 없으면 위 기본값을 쓴다. 끝나면 aggregate.mjs 로 집계표를 찍는다.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
model="sonnet"; specs=()
for a in "$@"; do case "$a" in *:*) specs+=("$a");; *) model="$a";; esac; done
[ ${#specs[@]} -eq 0 ] && specs=("s3:1,2,3,4,5")
start=$(date +%s)
for spec in "${specs[@]}"; do
  s="${spec%%:*}"; IFS=, read -ra trials <<< "${spec#*:}"
  for n in "${trials[@]}"; do
    for c in ${CONDS:-manual mcpeak}; do
      echo "▶ $s $c 회차 $n  ($(date +%H:%M:%S))"
      "$here/run.sh" "$s" "$c" "$n" "$model" 2>&1 | grep -v '^환경' || echo "✗ $s $c 회차 $n 실패"
    done
  done
done
echo; echo "총 소요 $(( $(date +%s) - start ))초"; echo
node "$here/aggregate.mjs"
