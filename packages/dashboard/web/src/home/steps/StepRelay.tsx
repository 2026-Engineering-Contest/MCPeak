import type { JSX } from "react";
import { useState } from "react";
import type { RelayCase, RelayEvent } from "../../../../src/api-types.js";
import { Card } from "../../components/Card.js";
import type { CaseCard, CaseCardStatus } from "../../relay/case-cards.js";
import { toCaseCards } from "../../relay/case-cards.js";

/** 본문을 접어 두는 기준. 중계기는 자르지 않는다 — **접는 것은 화면이 한다**(설계 §2-6). */
const FOLD_CHARS = 200;

const STATUS_LABEL: Record<CaseCardStatus, string> = {
  waiting: "기다리는 중",
  ok: "성공",
  toolError: "툴 오류",
  protocolError: "프로토콜 오류",
  noCall: "호출 없음",
};

/** 중계기의 사람 줄과 같은 규칙이다(`relay-log.ts`). 두 자리가 다르면 같은 값을 두 번 배운다. */
function groupDigits(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}초`;
}

/** `content` 의 텍스트만 모은 것. 없으면 null — 지어내지 않는다. */
function humanText(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const content = (body as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const texts = content.flatMap((block) =>
    typeof block === "object" &&
    block !== null &&
    typeof (block as { text?: unknown }).text === "string"
      ? [(block as { text: string }).text]
      : [],
  );
  return texts.length === 0 ? null : texts.join("\n");
}

function Foldable(props: { label: string; text: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const long = props.text.length > FOLD_CHARS;
  return (
    <div className="mt-1">
      <span className="text-xs text-ink-muted">{props.label}</span>{" "}
      <span className="break-all font-mono text-xs text-ink">
        {open || !long ? props.text : `${props.text.slice(0, FOLD_CHARS)}…`}
      </span>
      {long && (
        <button
          type="button"
          className="ml-2 text-xs text-accent underline"
          onClick={() => setOpen((previous) => !previous)}
        >
          {open ? "접기" : "더 보기"}
        </button>
      )}
    </div>
  );
}

function CaseBox(props: { card: CaseCard }): JSX.Element {
  const card = props.card;
  const last = card.results.at(-1);
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="break-all font-mono text-sm font-semibold text-ink">{card.id}</span>
        <span className="shrink-0 text-xs text-ink-muted">{STATUS_LABEL[card.status]}</span>
      </div>

      {card.status === "noCall" && (
        <p className="mt-2 text-sm text-ink-muted">AI 가 이 케이스에서 툴을 부르지 않았습니다.</p>
      )}
      {card.status === "waiting" && (
        <p className="mt-2 text-sm text-ink-muted">아직 이 케이스의 호출이 오지 않았습니다.</p>
      )}

      {card.calls.map((call, index) => (
        <p key={`call-${String(index)}`} className="mt-2 break-all font-mono text-xs text-ink">
          → {call.tool ?? card.tool} {call.args === undefined ? "" : JSON.stringify(call.args)}
        </p>
      ))}

      {last !== undefined && last.code !== undefined && (
        // 서버가 준 코드·문장을 그대로 쓴다. 고쳐 쓰지 않는다(`relay-log.ts` 의 문안 규칙 2).
        <p className="mt-1 font-mono text-xs" style={{ color: "var(--status-failed-fg)" }}>
          ← 오류 {last.code} {last.message ?? ""}
        </p>
      )}
      {last !== undefined && last.code === undefined && (
        <>
          <p className="mt-1 font-mono text-xs text-ink">
            ← {last.ok ? "성공" : "툴 오류"} · {groupDigits(last.bytes ?? 0)}바이트 ·{" "}
            {seconds(last.ms ?? 0)}
          </p>
          <Foldable label="사람이 읽는 칸" text={humanText(last.body) ?? "없음"} />
          <Foldable
            label="기계가 읽는 칸"
            text={
              typeof last.body === "object" &&
              last.body !== null &&
              "structuredContent" in last.body
                ? JSON.stringify((last.body as { structuredContent: unknown }).structuredContent)
                : "없음"
            }
          />
        </>
      )}
    </Card>
  );
}

/**
 * 4 단계 「실제 응답」. **화면은 케이스마다 칸 하나다**(설계 §1).
 *
 * 이 컴포넌트는 판정을 하지 않는다 — 전부 `toCaseCards` 가 한다. 그래야 테스트가 jsdom 없이
 * 돌고, 「호출 없음」처럼 틀리기 쉬운 판정에 되돌려-실패-확인을 걸 수 있다.
 */
export function StepRelay(props: {
  cases: readonly RelayCase[];
  events: readonly RelayEvent[];
  /** 중계기를 못 띄운 사유 전문. 서버가 준 문장을 그대로 쓴다. */
  error: string | null;
  /** 건너뛴 케이스 안내. 없으면 null. */
  skipped: string | null;
}): JSX.Element {
  const cards = toCaseCards(props.cases, props.events);
  return (
    <div className="space-y-3">
      {props.error !== null && (
        <p className="whitespace-pre-wrap text-sm" style={{ color: "var(--status-failed-fg)" }}>
          {props.error}
        </p>
      )}
      {props.skipped !== null && (
        <p className="whitespace-pre-wrap text-xs text-ink-muted">{props.skipped}</p>
      )}
      {cards.map((card) => (
        <CaseBox key={card.id} card={card} />
      ))}
    </div>
  );
}
