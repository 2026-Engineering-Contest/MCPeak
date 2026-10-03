#!/usr/bin/env bash
# 한 시나리오의 두 조건을 같은 회차로 이어서 돌린다: ./run-pair.sh <s1|s2> [회차번호] [모델]
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
s="$1"; n="${2:-1}"; model="${3:-sonnet}"
conds="${CONDS:-manual mcpeak}"
for c in $conds; do
  echo "▶ $s $c 회차 $n"
  "$here/run.sh" "$s" "$c" "$n" "$model" || echo "✗ $s $c 실패 (종료 코드 $?)"
done
echo "완료. 결과: runs/$s/{manual,mcpeak}/trial-$n/"
