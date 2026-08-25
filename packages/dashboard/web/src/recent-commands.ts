/**
 * 최근에 고른 서버 실행 대상 목록. 홈과 Generate 마법사가 **같은 목록**을 읽고 쓴다.
 *
 * 저장 키가 `mcpeak-generate-recent-commands` 인 것은 이름과 실체가 어긋난 자리다.
 * Generate 마법사에만 있던 기능이라 그렇게 붙었고, 이미 저장된 값이 사라지지 않게
 * 그대로 둔다(설계 §6-4). 키를 이름에 맞추려면 이주 코드가 필요하다.
 */

const RECENT_KEY = "mcpeak-generate-recent-commands";

/** 목록 길이 상한. 넘치면 오래된 것부터 버린다. */
const LIMIT = 8;

export function readRecentCommands(): readonly string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function saveRecentCommand(target: string): void {
  // 저장 용량 초과·스토리지 차단으로 setItem이 throw해도 무시한다. 실행은 이미
  // 서버에서 시작됐으므로 여기서 던지면 #/runs/:id 전환만 막힌다(PR #199 리뷰 반영).
  try {
    const next = [target, ...readRecentCommands().filter((item) => item !== target)].slice(
      0,
      LIMIT,
    );
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // 최근 사용값은 편의 기능이라 실패를 표시하지 않는다.
  }
}
