import type { AuditReport, RuleInfo } from "@mcpeak/audit";
import type { PassedRule } from "../api-types.js";

/** 격리 안의 관측(시스템 콜 기록·게이트웨이)으로만 판정하는 family. */
const SANDBOX_ONLY_FAMILIES: ReadonlySet<RuleInfo["family"]> = new Set(["behavior", "network"]);

/**
 * "안전" 구획의 재료(ADR-0117). 발견 없이 통과한 규칙을 서버가 센다. 브라우저는 `@mcpeak/audit` 를 값으로
 * import 하지 않으므로(security-view.ts) 규칙 목록은 여기서만 읽는다.
 *
 * 통과의 정의: 카탈로그의 규칙 중 (1) 그 family 가 `report.skipped` 에 없고 (2) `report.findings` 에 그
 * ruleId 가 없으며 (3) behavior·network family 면 격리가 실제로 돈 것(`report.sandbox.status === "ran"`).
 * 건너뛴 family 를 통과로 세지 않는다. 돌지 않은 검사는 "발견 없음" 이 아니라 "모름" 이기 때문이다.
 * 순서는 카탈로그 순서 그대로다(같은 입력이면 같은 출력).
 *
 * (3) 이 따로 있는 이유: skipped 에 없다고 돈 것이 아니다. audit 는 격리를 요청했는데 켜지지 않은 실행
 * (`sandbox.status === "unavailable"`)에만 behavior·network 를 skipped 에 넣고, 격리를 요청하지 않은
 * 실행(`report.sandbox` 없음)에는 넣지 않는다. 두 family 는 격리 안의 관측으로만 판정하므로, 격리가
 * 돌지 않았으면 skipped 와 상관없이 통과 후보에서 뺀다.
 */
export function passedRules(report: AuditReport, catalog: readonly RuleInfo[]): PassedRule[] {
  const skipped = new Set(report.skipped.map((entry) => entry.family));
  const found = new Set(report.findings.map((finding) => finding.ruleId));
  const observed = report.sandbox?.status === "ran";
  return catalog
    .filter(
      (rule) =>
        !skipped.has(rule.family) &&
        !found.has(rule.id) &&
        (observed || !SANDBOX_ONLY_FAMILIES.has(rule.family)),
    )
    .map((rule) => ({ id: rule.id, family: rule.family, summary: rule.summary }));
}

/** `@mcpeak/audit` 가 공개하는 규칙 목록 상수 이름. 이 순서가 곧 화면 순서다. */
export const RULE_CATALOG_KEYS = [
  "DESC_RULES",
  "SCHEMA_RULES",
  "LAUNCH_RULES",
  "PROTOCOL_RULES",
  "SURFACE_RULES",
  "SECRET_RULES",
  "RESULT_RULES",
  "FLOW_RULES",
  "BEHAVIOR_RULES",
  "NETWORK_RULES",
] as const;

export type RuleCatalogSource = Readonly<
  Record<(typeof RULE_CATALOG_KEYS)[number], readonly RuleInfo[]>
>;

/**
 * 카탈로그. `@mcpeak/audit` 는 `analyze-security.ts` 가 동적 import 로 읽으므로(CLI 와 같은 이유로 값으로
 * 정적 import 하지 않는다) 읽어 둔 모듈을 받아 그 상수들을 잇는다.
 */
export function ruleCatalog(audit: RuleCatalogSource): readonly RuleInfo[] {
  return RULE_CATALOG_KEYS.flatMap((key) => audit[key]);
}
