import type { JSX } from "react";
import { useEffect, useState } from "react";
import type { SessionEntry, StartRunRequest, StartRunResponse } from "../../../src/api-types.js";
import { apiGet, apiSend } from "../api.js";
import { buildTestArgv, DEFAULT_TEST_OPTIONS } from "../build-test-argv.js";
import { ArgChips } from "../components/ArgChips.js";
import { Field, INPUT_CLASS } from "../generate/steps/fields.js";
import { effectiveRepairBundlePath } from "../repair-bundle-path.js";
import type { SessionOrigin } from "../session-origin.js";
import { readSessionOrigin } from "../session-origin.js";

/**
 * Replay — 녹화해 둔 외부 응답으로 테스트를 다시 실행한다.
 *
 * **Test 와 다른 것은 상호작용 모델이다.** Test 는 실행을 처음부터 조립하므로 3단계 마법사가
 * 맞지만, 여기서 사용자가 내리는 결정은 "어느 녹화본인가" 하나뿐이다. 결정이 하나인 흐름에
 * 마법사를 씌우면 Test 와 껍데기만 같은 화면이 된다 — 그래서 목록 + 버튼 하나다.
 *
 * 재생에 필요한 재료는 셋이다: 스위트·서버 명령·세션 경로. 앞의 둘은 **세션 파일에 저장된
 * 출처(`origin`, ADR-0085)가 정본**이고, 그것이 없는 세션(v2 이전 녹화)만 녹화 당시
 * 브라우저가 적어 둔 `session-origin`(localStorage) 폴백을 본다. 둘 다 없으면 행을 펼쳐
 * 입력을 받는다 — 원클릭이 안 되는 것이지 재생을 못 하는 것이 아니다.
 */

/** 펼침 패널에서 고치는 값. 처음에는 녹화 당시 출처로 채운다. */
interface Draft {
  readonly command: string;
  readonly args: readonly string[];
  readonly suitePath: string;
}

const EMPTY_DRAFT: Draft = { command: "", args: [], suitePath: "" };

const STATUS_LABEL: Record<SessionEntry["status"], string> = {
  completed: "녹화 완료",
  running: "녹화 중단됨",
  failed: "녹화 실패",
};

/** 세션 상태 → `--status-*` 토큰 키. `StatusBadge` 가 RunStatus 로 하는 것과 같은 표다. */
const STATUS_TOKEN: Record<SessionEntry["status"], string> = {
  completed: "done",
  running: "waiting",
  failed: "failed",
};

/**
 * 녹화 상태 뱃지. **모양은 `StatusBadge` 와 같고 어휘만 다르다** — 점 + 라벨 필, 색은
 * Tailwind 유틸리티가 아니라 `--status-*` 토큰을 style 로 직접 쓴다(UI 설계 §4).
 *
 * `StatusBadge` 를 재사용하지 않는 것은 그쪽이 `RunStatus`(실행의 상태)를 말하는 컴포넌트라서다.
 * 세션 상태는 값도 문구도 다른 축이고, 한 컴포넌트에 두 어휘를 섞으면 라벨 표가 갈린다.
 */
function SessionStatusBadge(props: { status: SessionEntry["status"] }): JSX.Element {
  const key = STATUS_TOKEN[props.status];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ color: `var(--status-${key}-fg)`, background: `var(--status-${key}-bg)` }}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: `var(--status-${key}-fg)` }}
      />
      {STATUS_LABEL[props.status]}
    </span>
  );
}

/**
 * 재생할 수 없는 녹화본의 사유. record 가 거절할 때의 문장과 같은 뜻이어야 한다
 * (`REPLAY_SOURCE_INVALID`) — 화면과 터미널이 다른 말을 하면 사용자가 둘을 잇지 못한다.
 */
const STATUS_REASON: Record<SessionEntry["status"], string | null> = {
  completed: null,
  running: "녹화가 끝나지 않은 세션입니다. 다시 녹화하세요.",
  failed: "녹화 실행이 실패한 세션입니다. 다시 녹화하세요.",
};

/**
 * ISO 8601 을 `2026-08-25 14:32 UTC` 로 자른다.
 *
 * **`toLocale*` 를 쓰지 않는다**(ADR-0069). 로캘·타임존은 기계의 성질이라 같은 세션이 CI 와
 * 개발자 기계에서 다른 문자열이 된다. `UTC` 를 붙이는 것은 그 대가다 — 안 붙이면 KST 사용자가
 * 자기 시간으로 읽어 9시간을 착각한다. 밀리초는 낡음 판단에 쓸모가 없어 뺀다.
 *
 * **나이("12일 전")나 임계값 경고를 계산하지 않는다.** 그러려면 지금 시각을 읽어야 하고,
 * 그러면 같은 목록이 날마다 달라진다. 낡았는지는 사람이 판정한다.
 */
export function formatRecordedAt(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  // 모양이 다르면 자르지 않고 원문을 준다. 정보를 버리지 않는다.
  return match === null ? iso : `${match[1]} ${match[2]} UTC`;
}

export function ReplayView(): JSX.Element {
  const [sessions, setSessions] = useState<readonly SessionEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 펼친 행의 세션 경로. 한 번에 하나만 연다(Home 의 `promptFor` 와 같은 모양). */
  const [expanded, setExpanded] = useState<string | null>(null);
  /** 세션 경로별 편집값. 손대지 않은 행은 여기에 없고, 그때는 출처를 그대로 쓴다. */
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<SessionEntry[]>("/api/sessions")
      .then(setSessions)
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, []);

  /**
   * 세션의 출처. **세션 파일에 저장된 값이 정본**이고(ADR-0085), 없을 때만 녹화 당시
   * 브라우저가 남긴 localStorage 폴백을 본다. 폴백이 정본을 이기면, 파일을 다른 스위트로
   * 재녹화한 뒤에도 이 브라우저는 옛 값을 보여준다.
   */
  function originOf(session: SessionEntry): SessionOrigin | null {
    return session.origin ?? readSessionOrigin(session.path);
  }

  /** 출처 → 편집값. 편집한 적이 있으면 그것이 이긴다. */
  function draftOf(session: SessionEntry): Draft {
    const edited = drafts[session.path];
    if (edited !== undefined) {
      return edited;
    }
    const origin = originOf(session);
    return origin === null ? EMPTY_DRAFT : origin;
  }

  function patchDraft(session: SessionEntry, partial: Partial<Draft>): void {
    setDrafts((previous) => ({
      ...previous,
      [session.path]: { ...draftOf(session), ...partial },
    }));
  }

  /**
   * 재생 버튼 비활성 판정·미리보기·제출이 **같은 함수**를 쓴다. Test 와 같은 규칙이다 —
   * 두 벌이면 버튼은 눌리는데 제출은 실패하는 상태가 생긴다.
   */
  function replayResult(
    session: SessionEntry,
  ): { readonly argv: readonly string[] } | { readonly error: string } {
    const draft = draftOf(session);
    if (draft.suitePath.trim() === "") {
      return { error: "스위트 경로를 입력하세요." };
    }
    try {
      return {
        argv: buildTestArgv({
          suitePath: draft.suitePath.trim(),
          command: draft.command.trim(),
          args: draft.args,
          sessionMode: "replay",
          sessionPath: session.path,
          options: {
            // 접속은 stdio, 결정론은 꺼짐이 기본값이라 그대로 쓴다. External 세션은 우리가
            // 띄운 프로세스에만 붙고, 결정론 검사와는 함께 쓸 수 없다 — 이 화면에서는 둘 다
            // 고를 수 없게 두어 `buildTestArgv` 가 거절할 조합을 만들 수 없게 한다.
            ...DEFAULT_TEST_OPTIONS,
            repairBundlePath: effectiveRepairBundlePath(draft.suitePath.trim(), ""),
          },
        }),
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async function startReplay(session: SessionEntry): Promise<void> {
    const result = replayResult(session);
    if (!("argv" in result)) {
      return;
    }
    setStarting(true);
    setStartError(null);
    try {
      const response = await apiSend<StartRunResponse>("POST", "/api/runs", {
        flow: "test",
        argv: result.argv,
      } satisfies StartRunRequest);
      window.location.hash = `#/runs/${encodeURIComponent(response.runId)}`;
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className="mx-auto max-w-[800px] space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">녹화본 재생</h1>
        <p className="mt-1 text-sm text-ink-muted">
          녹화해 둔 외부 응답으로, 실제 호출 없이 같은 테스트를 다시 실행합니다.
        </p>
      </div>

      {loadError !== null && (
        <p className="text-sm" style={{ color: "var(--status-failed-fg)" }}>
          {loadError}
        </p>
      )}
      {startError !== null && (
        <p className="text-sm" style={{ color: "var(--status-failed-fg)" }}>
          {startError}
        </p>
      )}

      {/* Runs 목록과 같은 모양이다 — 둘 다 "고르면 실행으로 가는 목록" 이라 다르게 생길 이유가 없다. */}
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <ul className="divide-y divide-line-subtle text-sm">
          {sessions === null && <li className="px-4 py-3 text-ink-muted">불러오는 중...</li>}
          {sessions !== null && sessions.length === 0 && (
            <li className="px-4 py-3 text-ink-muted">
              → Test 에서 External 세션을 &quot;외부 호출 녹화&quot;로 실행하면 녹화본이 여기에
              나타납니다.
            </li>
          )}
          {sessions?.map((session) => (
            <SessionRow
              key={session.path}
              session={session}
              draft={draftOf(session)}
              hasOrigin={originOf(session) !== null}
              expanded={expanded === session.path}
              starting={starting}
              result={replayResult(session)}
              onToggle={() => setExpanded(expanded === session.path ? null : session.path)}
              onOpen={() => setExpanded(session.path)}
              onPatch={(partial) => patchDraft(session, partial)}
              onReplay={() => void startReplay(session)}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function SessionRow(props: {
  readonly session: SessionEntry;
  readonly draft: Draft;
  readonly hasOrigin: boolean;
  readonly expanded: boolean;
  readonly starting: boolean;
  readonly result: { readonly argv: readonly string[] } | { readonly error: string };
  readonly onToggle: () => void;
  /** 패널을 **열기만** 한다. 실행할 수 없는 재생 클릭이 이미 열린 패널을 닫으면 안 된다. */
  readonly onOpen: () => void;
  readonly onPatch: (partial: Partial<Draft>) => void;
  readonly onReplay: () => void;
}): JSX.Element {
  const { session, draft, result } = props;
  const reason = STATUS_REASON[session.status];
  const runnable = reason === null && "argv" in result;
  const idPrefix = `replay-${session.path.replace(/[^a-zA-Z0-9]/g, "-")}`;

  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="break-all font-mono text-xs text-ink">{session.path}</p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
            {session.recordedAt !== undefined && (
              <span>{formatRecordedAt(session.recordedAt)} 녹화</span>
            )}
            <span>외부 호출 {session.interactionCount}건</span>
            {props.hasOrigin ? (
              <span className="break-all font-mono">
                {[draft.command, ...draft.args].join(" ")}
              </span>
            ) : (
              <span>출처를 몰라 서버·스위트가 필요합니다</span>
            )}
          </p>
        </div>

        <SessionStatusBadge status={session.status} />

        {/* 「명세 확인」(2단계 스위트 목록)과 같은 자리·같은 모양의 보조 버튼이다. */}
        <button
          type="button"
          aria-expanded={props.expanded}
          className="shrink-0 rounded border border-line px-3 py-1 text-xs text-ink-muted"
          onClick={props.onToggle}
        >
          {props.expanded ? "닫기" : "경로 고치기"}
        </button>

        <button
          type="button"
          className="shrink-0 rounded bg-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          disabled={reason !== null || props.starting}
          // 출처를 모르면 실행할 수 없다. 그때 버튼은 실패하는 대신 입력을 연다.
          onClick={() => (runnable ? props.onReplay() : props.onOpen())}
        >
          재생
        </button>
      </div>

      {reason !== null && (
        <p className="mt-2 text-xs" style={{ color: "var(--status-failed-fg)" }}>
          → {reason}
        </p>
      )}

      {props.expanded && (
        <div className="mt-2 space-y-4 rounded border border-line bg-canvas px-3 py-3">
          <p className="text-xs text-ink-muted">
            파일을 옮겼거나 수정한 스위트로 확인할 때만 고치세요. 다른 서버·스위트로는 재생되지
            않습니다.
          </p>

          <Field
            label="서버 명령"
            htmlFor={`${idPrefix}-command`}
            hint="실행 파일 하나만 적습니다. 스크립트 경로는 아래 인자로 넣으세요."
          >
            <input
              id={`${idPrefix}-command`}
              className={INPUT_CLASS}
              value={draft.command}
              onChange={(event) => props.onPatch({ command: event.target.value })}
            />
          </Field>

          <ArgChips
            idPrefix={idPrefix}
            args={draft.args}
            hint="녹화할 때 쓴 인자입니다."
            onChange={(args) => props.onPatch({ args })}
          />

          <Field
            label="스위트 경로"
            htmlFor={`${idPrefix}-suite`}
            hint="녹화할 때 돌린 스위트입니다."
          >
            <input
              id={`${idPrefix}-suite`}
              className={INPUT_CLASS}
              value={draft.suitePath}
              onChange={(event) => props.onPatch({ suitePath: event.target.value })}
            />
          </Field>

          <div className="rounded-md border border-line bg-line-subtle px-3 py-2">
            <p className="text-xs text-ink-muted">실행될 명령</p>
            {"argv" in result ? (
              <p className="break-all font-mono text-sm text-ink">
                {["mcpeak", "test", ...result.argv.map(quote)].join(" ")}
              </p>
            ) : (
              <p className="text-sm" style={{ color: "var(--status-failed-fg)" }}>
                {result.error}
              </p>
            )}
          </div>

          <p className="text-xs text-ink-muted">
            녹화에 없는 외부 호출은 실패합니다. 실제 네트워크는 호출하지 않습니다.
          </p>

          <button
            type="button"
            className="rounded bg-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
            disabled={!runnable || props.starting}
            onClick={props.onReplay}
          >
            이 값으로 재생
          </button>
        </div>
      )}
    </li>
  );
}

/** 표시 전용. 서버에는 배열로 가므로 여기서 감싼 따옴표가 argv 에 들어가지는 않는다. */
function quote(token: string): string {
  return token.includes(" ") ? `"${token}"` : token;
}
