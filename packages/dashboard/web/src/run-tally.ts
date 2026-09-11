/**
 * 테스트 실행의 케이스 집계. runner 요약 줄(`2 passed, 1 failed  (3 total)`)을 옮긴 것이다.
 *
 * **실행 중에는 없다.** `mcpeak test` 는 출력을 모았다가 끝에 한 번 쓰므로(`output-lines.ts`
 * 참조) 케이스별 진행을 화면이 알 길이 없다. 요약 줄이 오기 전에 숫자를 그리면 지어낸 숫자다.
 * 왜 구조화된 진행 이벤트가 아니라 이 한 줄인지는 ADR-0096.
 */
export interface RunTally {
  readonly passed: number;
  readonly failed: number;
  readonly timedOut: number;
  readonly cancelled: number;
  readonly notRun: number;
  readonly total: number;
}

/**
 * 요약 줄의 낱말과 필드. runner `reporter.ts` 의 `SUMMARY_LABELS` 와 같은 값이다 — web 은 runner
 * 를 import 하지 않으므로(의존 방향) 여기 다시 적는다. 낱말이 바뀌면 이 표가 조용히 못 읽게
 * 되고, 그때 화면은 숫자 대신 "요약 없음" 을 그린다. 틀린 숫자를 그리지는 않는다.
 */
const LABELS: ReadonlyArray<readonly [string, Exclude<keyof RunTally, "total">]> = [
  ["passed", "passed"],
  ["failed", "failed"],
  ["timed out", "timedOut"],
  ["cancelled", "cancelled"],
  ["not run", "notRun"],
];

const ITEM = `\\d+ (?:${LABELS.map(([label]) => label).join("|")})`;
/** 항목은 0건이면 빠진다. 전부 0 이면 `(0 total)` 만 남는다. */
const SUMMARY_LINE = new RegExp(`^(?:${ITEM}(?:, ${ITEM})*)?\\s*\\((\\d+) total\\)$`);

/**
 * 출력 평문에서 **마지막** 요약 줄을 읽는다. 없으면 null 이다.
 *
 * 마지막인 이유는 한 run 이 보고서를 여러 번 낼 수 있어서다 — 화면이 보여 줄 것은 가장 나중
 * 판정이다. 항목의 합이 total 과 다르면 요약 줄이 아닌 것으로 본다. 우연히 모양이 같은 줄을
 * 집계로 믿으면 화면이 거짓말을 한다.
 */
export function parseRunTally(text: string): RunTally | null {
  const lines = text.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const tally = tallyOf((lines[index] ?? "").trim());
    if (tally !== null) return tally;
  }
  return null;
}

function tallyOf(line: string): RunTally | null {
  const match = SUMMARY_LINE.exec(line);
  if (match === null) return null;

  const counts = { passed: 0, failed: 0, timedOut: 0, cancelled: 0, notRun: 0 };
  const items = line.slice(0, line.lastIndexOf("(")).trim();
  if (items !== "") {
    for (const item of items.split(", ")) {
      const space = item.indexOf(" ");
      const label = item.slice(space + 1);
      const field = LABELS.find(([candidate]) => candidate === label)?.[1];
      if (field === undefined) return null;
      counts[field] = Number(item.slice(0, space));
    }
  }

  const total = Number(match[1]);
  const sum = counts.passed + counts.failed + counts.timedOut + counts.cancelled + counts.notRun;
  return sum === total ? { ...counts, total } : null;
}
