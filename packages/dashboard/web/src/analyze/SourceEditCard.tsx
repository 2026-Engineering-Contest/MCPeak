import type { JSX } from "react";
import { Fragment, useState } from "react";
import type {
  AnalyzeTokensResponse,
  SourceEdit,
  SourceEditRequest,
  SourceEditResponse,
} from "../../../src/api-types.js";
import { apiSend } from "../api.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import {
  DIFF_MARK,
  DIFF_PRE_CLASS,
  DIFF_STYLE,
  describeChangeParts,
  diffHunks,
  type HunkLine,
} from "./tool-diff.js";

/** `overlay.tools` 를 원본 순서로 돌며 변경을 도구 이름과 함께 편다. 서버가 같은 순서로 결과를 돌려준다. */
function collectEdits(result: AnalyzeTokensResponse): readonly SourceEdit[] {
  return result.overlay.tools.flatMap((tool) =>
    tool.changes.map((change) => ({ tool: tool.name, change })),
  );
}

/** 줄 번호. 지운 줄과 그대로인 줄은 원본 기준, 바뀐 줄은 고친 파일 기준이다. */
function lineNo(line: HunkLine): number | undefined {
  return line.kind === "added" ? line.afterNo : line.beforeNo;
}

/**
 * 파일 diff 의 묶음 하나. 줄은 도구 비교와 같은 `data-diff` 방식이고 앞에 줄 번호를 둔다. 번호와 표시
 * 글자를 뺀 `textContent` 가 원래 줄이다.
 */
function HunkPre({
  lines,
  width,
}: {
  readonly lines: readonly HunkLine[];
  readonly width: number;
}): JSX.Element {
  return (
    <pre className={DIFF_PRE_CLASS}>
      {/* 긴 줄 때문에 가로로 밀어도 배경색이 줄 끝까지 이어지게, 가장 긴 줄 폭에 맞춘다. */}
      <span className="block w-max min-w-full">
        {lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 줄 순서가 곧 정체다. 같은 줄이 여러 번 나온다.
          <span key={index} data-diff={line.kind} className="block" style={DIFF_STYLE[line.kind]}>
            <span data-line-no="" aria-hidden="true" className="select-none">
              {`${String(lineNo(line) ?? "").padStart(width)} `}
            </span>
            <span aria-hidden="true" className="select-none">
              {DIFF_MARK[line.kind]}
            </span>
            {line.text}
          </span>
        ))}
      </span>
    </pre>
  );
}

/** 받은 미리보기 하나. 변경별 상태와 파일 diff 를 보인다(적용·취소 버튼은 카드가 그린다). */
function Preview({ preview }: { readonly preview: SourceEditResponse }): JSX.Element {
  const hunks = preview.readyCount > 0 ? diffHunks(preview.before, preview.after) : [];
  // 번호 칸 폭은 가장 큰 줄 번호에 맞춘다. 묶음마다 폭이 달라지면 줄이 어긋나 보인다.
  const width = String(
    Math.max(1, ...hunks.flatMap((hunk) => hunk.map((line) => lineNo(line) ?? 0))),
  ).length;
  return (
    <>
      <p className="text-sm text-ink">
        파일: <code className="font-mono text-xs">{preview.file}</code>
      </p>
      <p className="text-sm text-ink">{`적용 가능 ${preview.readyCount}건 / 전체 ${preview.results.length}건`}</p>
      <ul aria-label="변경별 상태" className="list-disc space-y-2 pl-5 text-sm">
        {preview.results.map((item, index) => {
          const { path, text } = describeChangeParts(item.change);
          const ready = item.status === "ready";
          return (
            <li
              // 같은 변경이 여러 도구에 되풀이된다. 서버가 요청 순서를 지키므로 순서를 키로 쓴다.
              // biome-ignore lint/suspicious/noArrayIndexKey: 고정 순서 목록이다.
              key={index}
              data-status={item.status}
              className={ready ? "break-words" : "break-words text-ink-muted"}
              style={ready ? { color: "var(--status-done-fg)" } : undefined}
            >
              <span className="font-mono text-xs">{item.tool}</span>{" "}
              <code className="font-mono text-xs">{path}</code> {text}
              <span className="block">{item.detail}</span>
            </li>
          );
        })}
      </ul>
      {preview.readyCount > 0 ? (
        <section aria-label="파일 변경 미리보기" className="space-y-2">
          {hunks.map((hunk, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 묶음은 파일 순서 그대로이고 다시 정렬되지 않는다.
            <Fragment key={index}>
              {index > 0 && <hr className="border-line" />}
              <HunkPre lines={hunk} width={width} />
            </Fragment>
          ))}
        </section>
      ) : (
        <p className="text-sm text-ink-muted">
          소스에서 고칠 수 있는 변경이 없습니다. 위 목록의 사유를 확인하세요.
        </p>
      )}
    </>
  );
}

/**
 * 토큰 탭의 "MCP 수정하기"(ADR-0106). 압축 변경을 서버 소스에 반영하되, 바뀔 줄을 먼저 보이고 확인을
 * 받은 뒤에만 쓴다. 무엇을 고칠 수 있는지는 서버가 정하고 화면은 그 판정과 문장을 그대로 보인다.
 *
 * 요청은 전부 버튼이 시작하고 타이머가 없다. 결과가 바뀌면 부모가 다시 마운트해 상태를 비운다.
 */
export function SourceEditCard({
  result,
  argv,
  onReanalyze,
}: {
  readonly result: AnalyzeTokensResponse;
  readonly argv: readonly string[];
  readonly onReanalyze: () => void;
}): JSX.Element {
  const edits = collectEdits(result);
  const [preview, setPreview] = useState<SourceEditResponse | null>(null);
  const [applied, setApplied] = useState<SourceEditResponse | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [alert, setAlert] = useState<string | null>(null);

  async function send(apply?: SourceEditRequest["apply"]): Promise<void> {
    setBusy(apply === undefined ? "preview" : "apply");
    setAlert(null);
    try {
      const response = await apiSend<SourceEditResponse>("POST", "/api/analyze/source-edits", {
        argv,
        edits,
        ...(apply === undefined ? {} : { apply }),
      } satisfies SourceEditRequest);
      if (response.applied) {
        setPreview(null);
        setApplied(response);
        return;
      }
      setPreview(response);
      if (response.conflict) {
        setAlert(
          `미리보기 뒤에 ${response.file} 이 바뀌었습니다. 바뀐 내용으로 다시 계산했으니 확인하고 적용하세요.`,
        );
      }
    } catch (err) {
      // 서버가 정한 문장 그대로다. 새 문장을 만들지 않는다.
      setAlert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function cancel(): void {
    setPreview(null);
    setAlert(null);
  }

  return (
    <Card className="space-y-3 p-4">
      <h3 className="text-sm font-medium text-ink">MCP 수정하기</h3>
      <p className="text-sm text-ink-muted">
        압축 변경을 서버 소스 파일에 직접 반영합니다. 적용 전에 바뀔 줄을 먼저 보여 줍니다.
      </p>
      {edits.length === 0 ? (
        <p className="text-sm text-ink">반영할 변경이 없습니다.</p>
      ) : applied !== null ? (
        <>
          <p role="status" className="text-sm text-ink">
            {`${applied.file} 에 ${applied.readyCount}건을 적용했습니다. 다시 분석하면 줄어든 결과를 확인할 수 있습니다.`}
          </p>
          <Button variant="primary" onClick={onReanalyze}>
            다시 분석
          </Button>
        </>
      ) : preview === null ? (
        <Button variant="primary" disabled={busy !== null} onClick={() => void send()}>
          {busy === "preview" ? "확인 중…" : "MCP 수정하기"}
        </Button>
      ) : (
        <>
          <Preview preview={preview} />
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={busy !== null || preview.readyCount === 0}
              onClick={() => void send({ baseMtimeMs: preview.mtimeMs })}
            >
              {busy === "apply" ? "적용 중…" : "적용"}
            </Button>
            <Button disabled={busy !== null} onClick={cancel}>
              취소
            </Button>
          </div>
        </>
      )}
      {alert !== null && (
        <p role="alert" className="whitespace-pre-line text-sm text-ink">
          {alert}
        </p>
      )}
    </Card>
  );
}
