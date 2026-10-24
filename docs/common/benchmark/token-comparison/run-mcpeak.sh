#!/usr/bin/env bash
# 새 구도의 B안만 두 시나리오 이어서 돌린다: ./run-mcpeak.sh <s1회차> <s2회차> [모델]
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
"$here/run.sh" s1 mcpeak "${1:-4}" "${3:-sonnet}"
"$here/run.sh" s2 mcpeak "${2:-2}" "${3:-sonnet}"
