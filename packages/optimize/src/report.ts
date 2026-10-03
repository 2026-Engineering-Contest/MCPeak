import { measureContributions } from "./measure.js";
import type { OptimizeOverlay } from "./types.js";

/** 가장 많이 줄어든 도구 목록의 최대 줄 수(§7.2). */
const TOP_TOOLS = 5;

/** 소수 첫째 자리 퍼센트. 분모가 0 이면 0 이다. */
function percent(reduced: number, base: number): string {
  if (base === 0) return "0.0";
  return (Math.round((reduced / base) * 100 * 10) / 10).toFixed(1);
}

function tokens(bytes: number): number {
  return Math.round(bytes / 4);
}

/** 감소량을 부호와 함께 적는다. 줄었으면 `-n`, 오히려 늘었으면 `+n`. */
function signedReduction(reduced: number): string {
  return reduced >= 0 ? `-${reduced}` : `+${-reduced}`;
}

/** 사람용 리포트. 문안은 계획서 §7.2 와 글자 단위로 같다. 색 없음. */
export function renderReport(overlay: OptimizeOverlay): string {
  const { source, totals, tools } = overlay;
  const contributions = measureContributions(overlay);
  const reduced = totals.bytesBefore - totals.bytesAfterWithInstructions;

  // 감소 바이트 내림차순. 같으면 원본 순서를 지킨다(Array.prototype.sort 는 안정 정렬).
  const shrunk = tools
    .map((tool, index) => ({ tool, index, reduced: tool.bytes.before - tool.bytes.after }))
    .filter((entry) => entry.reduced > 0)
    .sort((x, y) => y.reduced - x.reduced || x.index - y.index);
  const unchanged = tools.length - shrunk.length;

  const lines = [
    "mcpeak optimize 결과",
    `서버 도구 ${source.toolCount}개, instructions ${source.instructions === "" ? "없음" : "있음"}`,
    "",
    "크기 (UTF-8 바이트, 토큰은 바이트÷4 근사)",
    `  원본            ${totals.bytesBefore}  (~${tokens(totals.bytesBefore)} 토큰)`,
    `  압축            ${totals.bytesAfterWithInstructions}  (~${tokens(totals.bytesAfterWithInstructions)} 토큰, ${percent(reduced, totals.bytesBefore)}% 감소)`,
    `  instructions 증가분 ${contributions.dictionary}  (공통 파라미터 ${totals.promotedParameters}개를 사전으로 옮김)`,
    "",
    "변환별 기여",
    `  무손실 정규화        ${signedReduction(contributions.lossless)} 바이트`,
    `  잡음 제거            ${signedReduction(contributions.noise)} 바이트`,
    `  공통 파라미터 승격   ${signedReduction(contributions.promotion)} 바이트 (사전 +${contributions.dictionary} 포함)`,
    "",
    "가장 많이 줄어든 도구",
    ...shrunk
      .slice(0, TOP_TOOLS)
      .map(
        ({ tool, reduced: toolReduced }) =>
          `  ${tool.name}  ${tool.bytes.before} → ${tool.bytes.after}  (${percent(toolReduced, tool.bytes.before)}%)`,
      ),
    "",
    `전혀 줄지 않은 도구 ${unchanged}개`,
    "",
  ];
  if (source.otherCapabilities.length > 0) {
    lines.push(
      `주의: 서버가 ${source.otherCapabilities.join(", ")} 능력도 광고합니다. 프록시는 tools 만 중계하므로 그 능력은`,
      "클라이언트에 보이지 않습니다.",
      "",
    );
  }
  lines.push(
    "이 오버레이는 tools/list 만 바꿉니다. tools/call 은 원본 이름과 인자로 서버에 전달됩니다.",
  );
  return `${lines.join("\n")}\n`;
}
