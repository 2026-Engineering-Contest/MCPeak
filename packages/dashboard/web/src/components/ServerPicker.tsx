import type { JSX } from "react";
import type { ServerCandidate } from "../../../src/api-types.js";
import type { LastRun } from "../last-run.js";

/**
 * 어느 갈래의 서버를 쓸지(설계 §6-6). `candidate` 는 스캔 후보, `last-run` 은 이 브라우저에
 * 남은 지난 실행값, `manual` 은 직접 입력이다.
 */
export type ServerChoice =
  | { readonly kind: "candidate"; readonly id: string }
  | { readonly kind: "last-run" }
  | { readonly kind: "manual" };

/** 출처 배지 라벨. 사용자가 보는 것은 후보를 읽어 온 파일 이름이다. */
const SOURCE_LABELS: Record<ServerCandidate["source"], string> = {
  "mcp-config": ".mcp.json",
  "package-bin": "package.json",
};

/** 명령 전문. 부제로 그대로 보여 후보끼리 눈으로 비교할 수 있게 한다. */
export function commandLine(command: string, args: readonly string[]): string {
  return [command, ...args].join(" ");
}

/** 지난 실행이 스캔 후보와 완전히 같은지. 같으면 목록에 두 번 그리지 않는다(설계 §5-2). */
export function sameTarget(candidate: ServerCandidate, lastRun: LastRun): boolean {
  return (
    candidate.command === lastRun.command &&
    candidate.args.length === lastRun.args.length &&
    candidate.args.every((arg, index) => arg === lastRun.args[index])
  );
}

function Card(props: {
  checked: boolean;
  disabled: boolean;
  name: string;
  title: string;
  subtitle: string;
  badge: string;
  path?: string;
  note?: string;
  onChoose: () => void;
}): JSX.Element {
  return (
    <li>
      <label
        className={`flex cursor-pointer gap-3 rounded-md border px-3 py-2 ${
          props.checked ? "border-accent bg-accent-soft" : "border-line bg-surface"
        }`}
      >
        <input
          type="radio"
          className="mt-1"
          name={props.name}
          checked={props.checked}
          disabled={props.disabled}
          onChange={props.onChoose}
        />
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-ink">{props.title}</span>
            <span className="shrink-0 text-xs text-ink-muted">
              <span className="rounded bg-line-subtle px-1.5 py-0.5">{props.badge}</span>
              {props.path !== undefined && <span className="ml-1.5 font-mono">{props.path}</span>}
            </span>
          </span>
          <span className="block break-all font-mono text-xs text-ink-muted">{props.subtitle}</span>
          {props.note !== undefined && (
            <span className="block text-xs text-ink-muted">{props.note}</span>
          )}
        </span>
      </label>
    </li>
  );
}

/**
 * 서버 선택(설계 §5-2). 라디오 카드 목록이고 항목 순서는 고정이다: 지난 실행 → 스캔 후보 →
 * 직접 입력.
 *
 * **후보가 하나도 없을 때 무엇을 하면 되는지 말하는 것이 이 컴포넌트의 절반이다.** "없습니다"
 * 한 줄이면 사용자는 도구가 어디를 뒤졌는지도, 다음에 뜨게 하려면 무엇을 두어야 하는지도
 * 알 수 없다(#296 과 같은 이유).
 */
export function ServerPicker(props: {
  candidates: readonly ServerCandidate[];
  lastRun: LastRun | null;
  choice: ServerChoice;
  onChoose: (choice: ServerChoice) => void;
  disabled?: boolean;
  /** 비활성 사유. HTTP 대상을 고른 경우가 유일하다. */
  disabledHint?: string;
  /** 탐색 루트(`GET /api/meta`). 못 받았으면 null 이고 안내에서 경로만 빠진다. */
  root: string | null;
}): JSX.Element {
  const disabled = props.disabled ?? false;
  // 지난 실행이 스캔 후보와 같으면 항목을 만들지 않는다. 같은 명령이 두 줄로 보이면
  // 사용자는 무엇이 다른지 찾느라 시간을 쓴다.
  const showLastRun =
    props.lastRun !== null &&
    !props.candidates.some((candidate) => sameTarget(candidate, props.lastRun as LastRun));
  const empty = props.candidates.length === 0 && props.lastRun === null;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-ink">서버</p>
        <p className="text-xs text-ink-muted">프로젝트에서 {props.candidates.length}개 찾음</p>
      </div>

      {empty ? (
        <div className="space-y-1 rounded-md border border-line bg-line-subtle px-3 py-2 text-sm text-ink-muted">
          <p>
            {props.root !== null && (
              <>
                <span className="font-mono text-xs text-ink">{props.root}</span>
                {" 아래에서 "}
              </>
            )}
            .mcp.json 이나 package.json 의 bin 을 찾지 못했습니다.
          </p>
          <p>아래에 직접 적거나, 루트에 .mcp.json 을 두면 다음부터 목록에 나타납니다.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {showLastRun && props.lastRun !== null && (
            <Card
              checked={props.choice.kind === "last-run"}
              disabled={disabled}
              name="home-run-server"
              title="지난 실행"
              subtitle={commandLine(props.lastRun.command, props.lastRun.args)}
              badge="이 브라우저"
              onChoose={() => props.onChoose({ kind: "last-run" })}
            />
          )}
          {props.candidates.map((candidate) => (
            <Card
              key={candidate.id}
              checked={props.choice.kind === "candidate" && props.choice.id === candidate.id}
              disabled={disabled}
              name="home-run-server"
              title={candidate.name}
              subtitle={commandLine(candidate.command, candidate.args)}
              badge={SOURCE_LABELS[candidate.source]}
              path={candidate.path}
              note={
                candidate.hasEnv
                  ? "env 는 대시보드가 넘기지 못합니다. 셸에서 미리 내보내세요."
                  : undefined
              }
              onChoose={() => props.onChoose({ kind: "candidate", id: candidate.id })}
            />
          ))}
          <Card
            checked={props.choice.kind === "manual"}
            disabled={disabled}
            name="home-run-server"
            title="직접 입력"
            subtitle="목록에 없는 서버를 실행 방법·스크립트·인자로 적습니다."
            badge="수동"
            onChoose={() => props.onChoose({ kind: "manual" })}
          />
        </ul>
      )}

      {disabled && props.disabledHint !== undefined && (
        <p className="text-xs text-ink-muted">{props.disabledHint}</p>
      )}
    </div>
  );
}
