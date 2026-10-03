export type ScenarioOutcome = "pass" | "fail";
export type ScenarioTable = Readonly<Record<string, ScenarioOutcome>>;
export interface Check {
  readonly id: string;
  readonly status: string;
}

/**
 * conformance 0.1.16 번들에서 관찰된 상태값은 SUCCESS, FAILURE, WARNING, INFO 넷이다.
 * WARNING 은 SHOULD 위반이고 INFO 는 참고 기록이라 통과로 친다. 그 밖의 값은 모르는 값이므로
 * 통과로 세지 않는다. 모르는 값을 통과로 두면 채점기 버전이 바뀌었을 때 조용히 점수가 오른다.
 */
const PASSING_STATUSES = new Set(["SUCCESS", "WARNING", "INFO"]);

export function scoreChecks(checks: readonly Check[]): ScenarioOutcome {
  if (checks.length === 0) return "fail";
  return checks.every((check) => PASSING_STATUSES.has(check.status)) ? "pass" : "fail";
}

/** `conformance list` 출력에서 "Server scenarios" 절의 이름만 사전순으로 돌려준다. */
export function parseServerScenarios(listOutput: string): string[] {
  const names: string[] = [];
  let inServer = false;
  for (const line of listOutput.split("\n")) {
    if (line.startsWith("Server scenarios")) {
      inServer = true;
      continue;
    }
    if (line.startsWith("Client scenarios")) {
      inServer = false;
      continue;
    }
    const match = /^\s+-\s+(\S+)/.exec(line);
    if (inServer && match) names.push(match[1] as string);
  }
  return names.sort();
}

export function sortTable(table: Record<string, ScenarioOutcome>): ScenarioTable {
  return Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b)));
}
