/**
 * repair 번들의 관리 경로(설계 `2026-08-25-대시보드-repair-번들-자동-관리` §6-1, ADR-0080).
 *
 * 번들은 사용자의 산출물이 아니라 대시보드가 repair 에 넘기려고 만드는 내부 입력이다. 그래서
 * 경로를 사용자에게 묻지 않고 여기서 정한다. 서버는 argv 를 손대지 않으므로(`wiring.ts`)
 * 프론트가 폼 값으로 넣고, 미리보기에 그대로 보인다.
 */

/** 대시보드가 번들을 두는 디렉터리. 루트 기준 상대경로. 서버의 REPAIR_BUNDLE_DIR 와 같다. */
export const REPAIR_BUNDLE_DIR = ".mcpeak/repair";

/**
 * 스위트 경로 → 관리 번들 경로. 같은 스위트면 같은 값이다(결정론).
 * `/` 를 `__` 로 바꾸고 끝의 `.json` 을 떼어 `.repair-bundle.json` 을 붙인다.
 *   "generated/weather.baseline.json" → ".mcpeak/repair/generated__weather.baseline.repair-bundle.json"
 *   "suite.json"                       → ".mcpeak/repair/suite.repair-bundle.json"
 *   "a/b.suite"                        → ".mcpeak/repair/a__b.suite.repair-bundle.json"
 *
 * `runId` 를 안 쓰는 이유는 그것이 POST 응답에서야 오기 때문이다. 미리보기를 그리는 시점에
 * 알 수 있는 값이어야 한다. 같은 스위트의 다음 실행이 덮어쓴다. repair 는 마지막 실패를 고친다.
 */
export function managedRepairBundlePath(suitePath: string): string {
  const flattened = suitePath.replace(/\//g, "__").replace(/\.json$/, "");
  return `${REPAIR_BUNDLE_DIR}/${flattened}.repair-bundle.json`;
}

/** 사용자가 적었으면(trim 후 비어 있지 않으면) 그것, 아니면 관리 경로. */
export function effectiveRepairBundlePath(suitePath: string, userPath: string): string {
  const trimmed = userPath.trim();
  return trimmed === "" ? managedRepairBundlePath(suitePath) : trimmed;
}

/**
 * argv 의 `--repair-bundle <p>` 또는 `--repair-bundle=<p>` 에서 p. 없으면 null.
 * 둘 다 있으면 CLI 가 거절했을 것이므로 첫 것만 본다.
 */
export function repairBundlePathOf(argv: readonly string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--repair-bundle") {
      return argv[index + 1] ?? null;
    }
    if (token?.startsWith("--repair-bundle=")) {
      return token.slice("--repair-bundle=".length);
    }
  }
  return null;
}
