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
      # 환경 줄은 격리 진단이다. 숨기지 않고, mcp 나 slash 가 0 이 아니면 그 회차를 실패로 친다.
      out=$("$here/run.sh" "$s" "$c" "$n" "$model" 2>&1); code=$?
      printf '%s\n' "$out"
      if [ $code -ne 0 ]; then echo "✗ $s $c 회차 $n 실패 (종료 코드 $code)"
      elif printf '%s\n' "$out" | grep -q '^환경: .*\(mcp=[1-9]\|slash=[1-9]\)'; then echo "✗ $s $c 회차 $n 격리 실패 (환경 줄 확인)"
      fi
    done
  done
done
echo; echo "총 소요 $(( $(date +%s) - start ))초"; echo
node "$here/aggregate.mjs"
