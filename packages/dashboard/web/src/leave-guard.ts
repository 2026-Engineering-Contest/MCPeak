import { useEffect } from "react";

/**
 * 화면 하나가 "지금 떠나면 잃는 것이 있다" 고 App 에 알리는 자리(설계 §사용 훑기 반영 U7).
 *
 * 해시 변경은 취소할 수 없다. 그래서 App 이 `hashchange` 를 받으면 이 자리를 보고, 막혀 있으면
 * 해시를 되돌린 뒤 가려던 해시를 `onBlocked` 로 넘긴다. 화면은 확인을 받고 `leaveAnyway` 로
 * 보낸다. 한 번에 한 화면만 떠 있으므로 자리는 하나다.
 */
type OnBlocked = (targetHash: string) => void;

let blocker: OnBlocked | null = null;

export function leaveBlocker(): OnBlocked | null {
  return blocker;
}

/** 자리를 비우고 가려던 곳으로 보낸다. 화면의 "버리고 이동" 이 부른다. */
export function leaveAnyway(targetHash: string): void {
  blocker = null;
  window.location.hash = targetHash;
}

function preventUnload(event: BeforeUnloadEvent): void {
  event.preventDefault();
}

/** `active` 인 동안 해시 이동을 막고 새로고침 · 탭 닫기에 브라우저 기본 경고를 건다. */
export function useLeaveGuard(active: boolean, onBlocked: OnBlocked): void {
  useEffect(() => {
    if (!active) return;
    blocker = onBlocked;
    window.addEventListener("beforeunload", preventUnload);
    return () => {
      if (blocker === onBlocked) blocker = null;
      window.removeEventListener("beforeunload", preventUnload);
    };
  }, [active, onBlocked]);
}
