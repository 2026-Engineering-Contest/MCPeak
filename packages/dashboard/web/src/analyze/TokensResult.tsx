import type { JSX } from "react";
import { useState } from "react";
import type { AnalyzeTokensResponse, PutFileResponse } from "../../../src/api-types.js";
import { apiSend } from "../api.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { Field, INPUT_CLASS } from "../components/Field.js";
import { percent, tokens } from "./format.js";

type OptimizedTool = AnalyzeTokensResponse["overlay"]["tools"][number];

/** 저장 결과 문장. 성공·충돌은 안내라 status, 요청 실패는 alert 다. */
type SaveMessage = { readonly kind: "status" | "alert"; readonly text: string };

const DEFAULT_OVERLAY_PATH = "server.optimize.json";

/**
 * 도구별 표의 행 순서. 감소 바이트 내림차순이고 같으면 원본 순서다(`report.ts` 의 `shrunk` 와 같은
 * 비교 함수). 리포트와 달리 줄지 않은 도구도 거르지 않는다. 비교 함수가 같으므로 그 도구들은 감소가
 * 0 이하라 저절로 뒤에 붙는다.
 */
function sortedTools(tools: readonly OptimizedTool[]): readonly OptimizedTool[] {
  return tools
    .map((tool, index) => ({ tool, index, reduced: tool.bytes.before - tool.bytes.after }))
    .sort((x, y) => y.reduced - x.reduced || x.index - y.index)
    .map((entry) => entry.tool);
}

/**
 * 토큰 분석 결과. 숫자는 `overlay` 에서 `format.ts` 의 식으로만 만든다(CLI 리포트와 같은 식).
 * 변환별 기여는 화면이 다시 계산하지 않고 CLI 리포트 원문 구획에만 있다(계획서 §3).
 */
export function TokensResult({ result }: { readonly result: AnalyzeTokensResponse }): JSX.Element {
  const { source, totals, tools } = result.overlay;
  const reduced = totals.bytesBefore - totals.bytesAfterWithInstructions;
  const [path, setPath] = useState(DEFAULT_OVERLAY_PATH);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<SaveMessage | null>(null);

  const summary: readonly (readonly [string, string])[] = [
    ["원본", `${totals.bytesBefore} 바이트 (~${tokens(totals.bytesBefore)} 토큰)`],
    [
      "압축",
      `${totals.bytesAfterWithInstructions} 바이트 (~${tokens(totals.bytesAfterWithInstructions)} 토큰, ${percent(reduced, totals.bytesBefore)}% 감소)`,
    ],
    ["도구", `${source.toolCount}개 (공통 파라미터 ${totals.promotedParameters}개 승격)`],
  ];

  async function save(): Promise<void> {
    setSaving(true);
    setMessage(null);
    try {
      // 있는 파일은 덮지 않는다(baseMtimeMs 0). 분석은 다시 돌리면 그만이라, 지우는 판단은
      // 사용자에게 남긴다(계획서 §3).
      const response = await apiSend<PutFileResponse>(
        "PUT",
        `/api/overlays/${encodeURIComponent(path)}`,
        { content: result.overlayText, baseMtimeMs: 0 },
      );
      setMessage({
        kind: "status",
        text: response.saved
          ? `저장했습니다: ${path}. 프록시로 띄우려면: mcpeak-optimize-proxy ${path} -- <서버 명령>`
          : `이미 있는 파일입니다: ${path}. 다른 경로를 쓰거나 파일을 지운 뒤 다시 저장하세요.`,
      });
    } catch (err) {
      setMessage({ kind: "alert", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <dl className="grid grid-cols-3 gap-4">
          {summary.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-caption font-medium text-ink-muted">{label}</dt>
              <dd className="mt-0.5 text-sm tabular-nums text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {source.otherCapabilities.length > 0 && (
        <p className="whitespace-pre-line text-sm" style={{ color: "var(--status-waiting-fg)" }}>
          {`주의: 서버가 ${source.otherCapabilities.join(", ")} 능력도 광고합니다. 프록시는 tools 만 중계하므로 그 능력은\n클라이언트에 보이지 않습니다.`}
        </p>
      )}

      <Card className="overflow-hidden">
        {/* 도구 이름이 길어도 숫자 열이 카드 밖으로 밀리지 않게 폭을 묶는다(RunView 표와 같은 이유). */}
        <table aria-label="도구별 감소" className="w-full table-fixed text-left text-sm">
          <thead className="border-b border-line text-caption font-medium text-ink-muted">
            <tr>
              <th className="px-4 py-2 font-medium">도구</th>
              <th className="w-24 px-4 py-2 text-right font-medium">원본</th>
              <th className="w-24 px-4 py-2 text-right font-medium">압축</th>
              <th className="w-24 px-4 py-2 text-right font-medium">감소</th>
              <th className="w-20 px-4 py-2 text-right font-medium">변경</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {sortedTools(tools).map((tool) => (
              <tr key={tool.name}>
                <td className="truncate px-4 py-2 font-mono text-xs text-ink">{tool.name}</td>
                <td className="px-4 py-2 text-right tabular-nums text-ink">{tool.bytes.before}</td>
                <td className="px-4 py-2 text-right tabular-nums text-ink">{tool.bytes.after}</td>
                <td className="px-4 py-2 text-right tabular-nums text-ink">
                  {`${percent(tool.bytes.before - tool.bytes.after, tool.bytes.before)}%`}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-ink">
                  {tool.changes.length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <details className="rounded-lg border border-line bg-surface">
        <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-ink">
          CLI 리포트 원문
        </summary>
        <pre className="overflow-x-auto whitespace-pre border-t border-line px-4 py-3 font-mono text-xs text-ink">
          {result.report}
        </pre>
      </details>

      <Card className="space-y-3 p-4">
        <Field label="저장 경로 (프로젝트 루트 기준)" htmlFor="analyze-overlay-path">
          <input
            id="analyze-overlay-path"
            className={INPUT_CLASS}
            value={path}
            onChange={(event) => setPath(event.target.value)}
          />
        </Field>
        <Button
          variant="primary"
          disabled={saving || path.trim() === ""}
          onClick={() => void save()}
        >
          오버레이 저장
        </Button>
        {message !== null &&
          (message.kind === "status" ? (
            <p role="status" className="text-sm text-ink">
              {message.text}
            </p>
          ) : (
            <p role="alert" className="whitespace-pre-line text-sm text-ink">
              {message.text}
            </p>
          ))}
      </Card>
    </div>
  );
}
