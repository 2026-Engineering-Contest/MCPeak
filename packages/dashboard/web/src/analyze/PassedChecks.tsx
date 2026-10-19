import type { JSX } from "react";
import type { PassedRule } from "../../../src/api-types.js";
import { Card } from "../components/Card.js";
import { PillarBadge } from "./PillarBadge.js";

/** 통과 구획의 톤. 심각도 톤과 같은 토큰 쌍이다(`SecurityResult` 의 DONE_TONE 과 같다). */
const DONE_TONE = { fg: "var(--status-done-fg)" };

export const NO_PASSED_CHECKS = "발견 없이 통과한 검사가 없습니다.";
/** 규칙 summary 는 "탐지 대상" 서술이라, 이 줄이 없으면 목록이 발견 목록처럼 읽힌다. */
export const PASSED_CHECKS_LEAD = "아래 항목을 검사했고 해당하는 것이 없었습니다.";
/** 줄마다 붙는 배지. summary 가 탐지 대상을 말하므로 "해당 없음" 이 그 뜻을 뒤집어 준다. */
export const PASSED_BADGE = "해당 없음";

/** family 별 묶음. 순서는 처음 나온 순서, 묶음 안은 받은 순서 그대로다. 다시 정렬하지 않는다. */
export function groupByFamily(
  rules: readonly PassedRule[],
): readonly { readonly family: string; readonly rules: readonly PassedRule[] }[] {
  const groups: { family: string; rules: PassedRule[] }[] = [];
  for (const rule of rules) {
    const group = groups.find((entry) => entry.family === rule.family);
    if (group === undefined) groups.push({ family: rule.family, rules: [rule] });
    else group.rules.push(rule);
  }
  return groups;
}

/**
 * "안전" 구획(ADR-0117). 발견 없이 통과한 규칙을 family 별로 보인다. 목록은 서버가 센 것이고(`passedRules`)
 * 여기서는 묶어 그리기만 한다. 서버가 보낸 글자는 전부 텍스트 노드다. family 의 표시 이름은 따로 없어
 * 규칙 id 의 family 문자열 그대로다. 규칙 summary 는 탐지 대상 서술("…이 있는지 본다")이라 줄마다
 * "해당 없음" 배지를 앞세우고, 목록은 길어서(규칙 30여 건) 기본 접힘이다. 제목과 안내 줄은 늘 보인다.
 */
export function PassedChecks({ rules }: { readonly rules: readonly PassedRule[] }): JSX.Element {
  if (rules.length === 0) {
    return <p className="text-sm text-ink-muted">{NO_PASSED_CHECKS}</p>;
  }
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold" style={{ color: DONE_TONE.fg }}>
        {`안전 (발견 없이 통과한 검사) ${rules.length}건`}
      </h3>
      <p className="text-sm text-ink-muted">{PASSED_CHECKS_LEAD}</p>
      <details className="rounded-lg border border-line bg-surface">
        <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-ink">
          {`검사 항목 ${rules.length}건 보기`}
        </summary>
        <Card className="divide-y divide-line-subtle overflow-hidden border-0 border-t rounded-t-none shadow-none">
          {groupByFamily(rules).map((group) => (
            <div key={group.family} data-family={group.family} className="space-y-1.5 px-4 py-3">
              <p className="font-mono text-xs font-semibold text-ink">{group.family}</p>
              <ul className="space-y-1">
                {group.rules.map((rule) => (
                  <li
                    key={rule.id}
                    className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink"
                  >
                    <PillarBadge label={PASSED_BADGE} tone="done" />
                    <span className="break-words">{rule.summary}</span>
                    <code className="break-all font-mono text-xs text-ink-muted">{rule.id}</code>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Card>
      </details>
    </section>
  );
}
