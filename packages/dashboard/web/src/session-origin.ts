/**
 * 녹화본이 **어느 실행에서 나왔는지**. 세션 경로를 키로 서버 명령·인자·스위트 경로를 기억한다.
 *
 * 재생은 녹화된 응답으로 외부 호출만 대신할 뿐, 서버는 실제로 띄우고 스위트는 실제로 돈다.
 * 그래서 재생 명령을 만들려면 세 가지가 필요한데(스위트·서버 명령·세션 경로), 세션 파일이
 * 담고 있는 것은 마지막 하나뿐이다. 나머지 둘을 여기에 남겨 두면 Replay 가 한 번의 클릭으로
 * 실행을 시작할 수 있다.
 *
 * **이것은 편의 캐시이지 진실이 아니다.** 진짜 자리는 세션 파일 안이고, 그쪽이 생기면 세션의
 * 값이 우선하고 이 저장소는 폴백으로 밀린다. 그래서 **없는 것이 정상**이다 — CLI 로 녹화했거나,
 * 다른 브라우저·기계에서 보는 경우다. 없으면 Replay 는 원클릭 대신 입력 폼을 연다.
 *
 * `last-run.ts` 와 저장소를 나눠 두는 이유는 목적이 다르기 때문이다. 그쪽은 "이 스위트를 지난번에
 * 무엇으로 돌렸나" 라 스위트가 키이고, **세션 모드·경로를 일부러 담지 않는다**(담으면 다음 실행이
 * 조용히 세션에 묶인다). 이쪽은 "이 녹화본이 무엇에서 나왔나" 라 세션 파일이 키다.
 */

export interface SessionOrigin {
  /** 실행 파일 하나. `--command` 에 그대로 실린다. */
  readonly command: string;
  /** `--arg` 로 하나씩 실릴 값들. 순서가 의미를 가지므로 배열 그대로 담는다. */
  readonly args: readonly string[];
  /** 녹화를 시작한 실행이 돌린 스위트 경로. */
  readonly suitePath: string;
}

/** `Record<sessionPath, SessionOrigin>` 를 담는다. */
const KEY = "mcpeak-session-origin";

/**
 * 저장 키를 목록의 경로 표기와 맞춘다. 쓰는 쪽 키는 사용자가 폼에 적은 경로 그대로이고
 * (`tmp\weather.db`, `./tmp/weather.db`), 읽는 쪽 키는 `/api/sessions` 가 주는 루트 기준
 * `/` 구분 상대경로다. 이 정규화가 없으면 Windows 에서 역슬래시로 적어 녹화한 사용자는
 * **대시보드로 녹화했는데도** 원클릭이 조용히 안 된다 — 실패가 아니라 "출처를 몰라" 로
 * 보여서 원인을 짚을 수도 없다.
 *
 * 루트 밖 절대경로는 정규화로 못 잇지만, 그런 세션은 목록 스캔(루트 아래)에도 안 잡히므로
 * 여기서 다룰 일이 없다.
 */
function normalizeSessionPath(path: string): string {
  let normalized = path.trim().replace(/\\/g, "/");
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  return normalized;
}

/**
 * 저장·읽기의 예외는 삼킨다. `last-run.ts` 와 같은 이유다 — `localStorage` 가 없거나 막힌
 * 환경에서, 출처를 못 기억하는 것은 불편(폼이 열린다)이고 화면이 안 뜨는 것은 고장이다.
 */
function readAll(): Record<string, unknown> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * 형이 어긋나면 `null`. **빠진 값을 기본값으로 메우지 않는다** — `last-run.ts` 와 갈리는
 * 지점이다. 그쪽의 옵션은 빠져도 CLI 기본값이 있지만, 여기의 셋은 하나라도 없으면 실행할
 * 명령을 만들 수 없다. 빈 문자열로 메우면 실행이 시작된 뒤에야 CLI 가 거절한다.
 */
export function readSessionOrigin(sessionPath: string): SessionOrigin | null {
  const wanted = normalizeSessionPath(sessionPath);
  const all = readAll();
  // 저장 키도 정규화해 비교한다. 새 코드는 정규화해 저장하지만, 읽기가 그 사실에 기대면
  // 정규화를 안 거친 키가 하나라도 남는 순간(이전 버전이 남긴 값) 조용히 못 읽는다.
  // 정확히 일치하는 키가 우선이고, 없을 때만 훑는다.
  const entry =
    all[wanted] ?? Object.entries(all).find(([key]) => normalizeSessionPath(key) === wanted)?.[1];
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return null;
  }
  const { command, args, suitePath } = entry as Partial<Record<keyof SessionOrigin, unknown>>;
  if (typeof command !== "string" || command === "") {
    return null;
  }
  if (typeof suitePath !== "string" || suitePath === "") {
    return null;
  }
  if (!Array.isArray(args)) {
    return null;
  }
  return {
    command,
    args: args.filter((item): item is string => typeof item === "string"),
    suitePath,
  };
}

/** 녹화 실행을 시작한 직후에 부른다. 같은 세션 경로의 값은 덮어쓴다. */
export function saveSessionOrigin(sessionPath: string, origin: SessionOrigin): void {
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ ...readAll(), [normalizeSessionPath(sessionPath)]: origin }),
    );
  } catch {
    // 출처는 편의 기능이라 실패를 표시하지 않는다. 녹화 실행은 이미 시작됐다.
  }
}
