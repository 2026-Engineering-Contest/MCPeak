import type { ReplayMissDetail, SessionSummary } from "@mcpeak/record/external";
import { describe, expect, it } from "vitest";
import { SessionFileMissingError } from "../src/external-wiring.js";
import {
  bodyUrlNotice,
  externalCloseFailure,
  externalOpenFailure,
  externalSessionNotice,
  externalSessionOutcome,
  outOfScopeNotice,
  parseTestCommand,
  renderReplayMissDiagnostics,
} from "../src/test-command.js";

/**
 * `--session` · `--record-session` 의 파싱과 상호 배타를 본다.
 *
 * 실제 녹화·재생은 `external-record-replay-e2e.test.ts` 가 dist CLI 로 확인한다. 여기서
 * 보는 것은 **잘못 쓴 조합을 서버를 띄우기 전에 막는가** 다. 실행한 뒤에 거절하면 사용자는
 * 이미 서버가 뜬 뒤 실패를 보고, 부작용이 있는 서버라면 그 부작용도 이미 일어난 뒤다.
 */

const base = ["suite.json", "--command", "node"];

const parse = (extra: readonly string[]) => parseTestCommand([...base, ...extra]);

const failureOf = (extra: readonly string[]): string => {
  try {
    parse(extra);
  } catch (error) {
    return (error as { failure?: { message?: string } }).failure?.message ?? String(error);
  }
  throw new Error("사용 오류가 발생하지 않았습니다.");
};

describe("External 세션 옵션 파싱", () => {
  it("--session 과 --record-session 을 각각 읽는다", () => {
    expect(parse(["--session", "a.db"]).sessionPath).toBe("a.db");
    expect(parse(["--record-session", "b.db"]).recordSessionPath).toBe("b.db");
  });

  it("--name=value 형태도 받는다", () => {
    expect(parse(["--session=a.db"]).sessionPath).toBe("a.db");
    expect(parse(["--record-session=b.db"]).recordSessionPath).toBe("b.db");
  });

  it("세션 옵션이 없으면 undefined 다 — 기존 실행에 영향이 없다", () => {
    const input = parse([]);
    expect(input.sessionPath).toBeUndefined();
    expect(input.recordSessionPath).toBeUndefined();
  });

  it("값을 빠뜨리면 다음 옵션을 경로로 먹지 않는다", () => {
    // `--session --json` 을 그냥 받으면 "--json" 이라는 파일을 열려다 엉뚱한 곳에서 실패한다.
    expect(failureOf(["--session", "--json"])).toContain("`--session` 옵션 값이 필요합니다");
    expect(failureOf(["--record-session"])).toContain("`--record-session` 옵션 값이 필요합니다");
  });

  it("같은 옵션을 두 번 쓰면 거절한다 — 어느 쪽을 쓸지 우리가 고르지 않는다", () => {
    expect(failureOf(["--session", "a.db", "--session", "b.db"])).toContain(
      "한 번만 사용할 수 있습니다",
    );
  });
});

describe("External 세션 상호 배타", () => {
  it("--session 과 --record-session 을 함께 쓰지 못한다", () => {
    const message = failureOf(["--session", "a.db", "--record-session", "b.db"]);

    expect(message).toContain("함께 쓸 수 없습니다");
    expect(message).toContain("재생과 녹화 중 하나만");
  });

  it("--determinism 과 함께 쓰지 못하고, 이유를 말한다", () => {
    // 막는 것으로 끝내면 사용자는 왜 안 되는지 모른 채 옵션을 지운다. 근거까지 말한다.
    for (const option of ["--session", "--record-session"]) {
      const message = failureOf(["--determinism", option, "a.db"]);

      expect(message).toContain("함께 쓸 수 없습니다");
      expect(message).toContain("2회 연결");
      expect(message).toContain("반복 호출 순번");
    }
  });

  it("--determinism 단독은 여전히 된다", () => {
    expect(parse(["--determinism"]).determinism).toBe(true);
  });
});

describe("배선 판정이 파서와 같은 규칙을 쓴다", () => {
  it("--arg 가 소비한 토큰을 세션 옵션으로 오인하지 않는다", () => {
    // `--arg` 는 하이픈으로 시작하는 값을 의도적으로 받는다. 배선이 argv 를 따로 훑으면
    // 이 토큰을 replay 지시로 읽어, 사용자가 요청한 적 없는 세션 파일을 열고 Bootstrap 을
    // 주입한다. Replay 라 서버의 외부 호출이 전부 실패하고 원인은 드러나지 않는다.
    const input = parseTestCommand([
      "suite.json",
      "--command",
      "node",
      "--arg",
      "--session=/tmp/x",
    ]);

    expect(input.args).toEqual(["--session=/tmp/x"]);
    expect(input.sessionPath).toBeUndefined();
    expect(input.recordSessionPath).toBeUndefined();
  });

  it("--arg 뒤에 온 --record-session 도 서버 인자로 남는다", () => {
    const input = parseTestCommand([
      "suite.json",
      "--command",
      "node",
      "--arg",
      "--record-session",
      "--session",
      "real.db",
    ]);

    expect(input.args).toEqual(["--record-session"]);
    expect(input.sessionPath).toBe("real.db");
    expect(input.recordSessionPath).toBeUndefined();
  });
});

/**
 * 종료 경고 네 갈래(ADR-0057)가 **배타적인지** 본다.
 *
 * 실제 녹화·재생은 `external-session-e2e.test.ts` 가 자식 프로세스로 확인한다. 여기서 보는 것은
 * 판정 그 자체다 — `consumedCount === 0` 과 `unusedCount > 0` 은 동시에 참일 수 있어서, 조건을
 * 독립적으로 세우면 한 실행에 경고가 두 번 찍힌다. 프로세스를 띄우면 그 조합을 만들기 어렵고
 * 느린데, 순수 함수라 여기서 한 줄로 고정된다.
 */

const record = (interactionCount: number): SessionSummary => ({
  mode: "record",
  sessionId: "default",
  status: "completed",
  interactionCount,
  consumedCount: 0,
  unusedCount: 0,
});

const replay = (
  interactionCount: number,
  consumedCount: number,
  unusedCount: number,
): SessionSummary => ({
  mode: "replay",
  sourceSessionId: "default",
  status: "completed",
  interactionCount,
  consumedCount,
  unusedCount,
  misses: [],
});

const SCOPE_NOTE = "globalThis.fetch";

describe("External 세션 종료 경고", () => {
  it("녹화가 0건이면 지원 범위를 확인하라고 말한다", () => {
    const notice = externalSessionNotice(record(0));

    expect(notice).toContain("외부 호출이 하나도 녹화되지 않았습니다");
    expect(notice).toContain(SCOPE_NOTE);
  });

  it("녹화가 1건이라도 있으면 아무 말도 하지 않는다", () => {
    expect(externalSessionNotice(record(1))).toBeUndefined();
  });

  it("재생 원본이 비었으면 녹화 쪽을 보라고 말한다", () => {
    const notice = externalSessionNotice(replay(0, 0, 0));

    // 원본이 빈 것은 재생의 문제가 아니라 그 앞 단계의 문제다. 문구가 그쪽을 가리켜야 한다.
    expect(notice).toContain("녹화된 외부 호출이 0건입니다");
    expect(notice).not.toContain("하나도 재생되지 않았습니다");
  });

  it("원본은 찼는데 하나도 못 썼으면 재생이 안 됐다고 말한다 — 미사용 경고는 겹치지 않는다", () => {
    // `unusedCount` 도 3 이라 두 조건이 동시에 참이다. 여기서 갈래가 갈리면 경고가 두 번 나온다.
    const notice = externalSessionNotice(replay(3, 0, 3));

    expect(notice).toContain("하나도 재생되지 않았습니다");
    expect(notice).not.toContain("3건 중");
  });

  it("일부만 재생되면 전체와 미재생 개수를 함께 말한다", () => {
    const notice = externalSessionNotice(replay(3, 2, 1));

    expect(notice).toContain("녹화된 외부 호출 3건 중 1건이 이번 실행에서 재생되지 않았습니다");
    expect(notice).not.toContain("하나도");
  });

  it("전부 재생됐으면 아무 말도 하지 않는다", () => {
    expect(externalSessionNotice(replay(3, 3, 0))).toBeUndefined();
  });

  it("말을 하는 모든 갈래가 같은 범위 안내로 끝난다", () => {
    // 갈래마다 다른 문구로 갈라지면 사용자는 같은 한계를 갈래마다 다시 배운다.
    for (const summary of [record(0), replay(0, 0, 0), replay(3, 0, 3), replay(3, 2, 1)]) {
      const notice = externalSessionNotice(summary);

      expect(notice).toContain(SCOPE_NOTE);
      expect(notice?.endsWith("로 부른 것만 잡습니다.\n")).toBe(true);
    }
  });
});

/**
 * ADR-0066. 성공한 실행도 무엇을 했는지 말한다. 녹화와 재생은 리포트가 같은 모양으로 나오므로,
 * 이 한 줄이 없으면 사용자는 방금 본 결과가 실제 호출인지 재생인지 구분할 수 없다.
 */
describe("External 세션 결과 보고 (ADR-0066)", () => {
  const PATH = "tmp/weather.db";

  it("녹화가 됐으면 건수와 세션 경로를 말한다", () => {
    const line = externalSessionOutcome(record(3), PATH);

    expect(line).toContain("외부 호출 3건을 녹화했습니다");
    expect(line).toContain(PATH);
  });

  it("전부 재생됐으면 재생이라고 말한다 — 녹화와 다른 문장이어야 구분된다", () => {
    const line = externalSessionOutcome(replay(3, 3, 0), PATH);

    expect(line).toContain("녹화된 외부 호출 3건을 재생했습니다");
    expect(line).toContain(PATH);
    // 두 갈래가 같은 동사로 끝나면 화면만 보고는 여전히 구분할 수 없다.
    expect(line).not.toContain("녹화했습니다");
  });

  it("범위 안내 전문을 반복하지 않는다 — 그 문장은 경고 갈래의 몫이다", () => {
    expect(externalSessionOutcome(record(3), PATH)).not.toContain(SCOPE_NOTE);
    expect(externalSessionOutcome(replay(3, 3, 0), PATH)).not.toContain(SCOPE_NOTE);
  });

  /**
   * **부분 커버리지가 이 단서의 존재 이유다.** 서버가 `fetch` 와 `node:http` 를 섞어 쓰면
   * 어댑터는 앞쪽만 본다 — 실측하면 2건 중 1건만 녹화되고, 재생에서 나머지 1건이 실제
   * 네트워크로 나간다. 그런데 경고 네 갈래가 전부 그 상황을 비켜가므로 화면에는 이 문장만
   * 남는다. 개수를 단정하면 "그게 전부" 로 읽힌다.
   */
  it("녹화 개수가 전부가 아닐 수 있다고 말한다", () => {
    const line = externalSessionOutcome(record(3), PATH);

    expect(line).toContain("어댑터가 잡은 호출만 셉니다");
    expect(line).toContain("세션에 남지 않습니다");
  });

  it("재생은 범위 밖 호출이 실제 네트워크로 나간다고 말한다", () => {
    const line = externalSessionOutcome(replay(3, 3, 0), PATH);

    expect(line).toContain("어댑터가 잡은 호출만 셉니다");
    // 녹화와 결과가 다르다. 녹화는 안 남는 것이고 재생은 나가는 것이다.
    expect(line).toContain("실제 네트워크로 나갑니다");
    expect(line).not.toContain("세션에 남지 않습니다");
  });

  it("경로는 다른 세션 문장과 같은 규칙으로 이스케이프한다", () => {
    // 경로는 사용자가 준 값이다. 그대로 실으면 우리 문장이 터미널 제어에 열린다.
    const line = externalSessionOutcome(record(1), "tmp/\u001b[31mred.db");

    expect(line).not.toContain("\u001b");
  });

  it("같은 요약이면 같은 문장이다", () => {
    expect(externalSessionOutcome(record(2), PATH)).toBe(externalSessionOutcome(record(2), PATH));
  });

  /**
   * **이 매트릭스가 계약이다.** 두 함수의 갈래는 서로를 보지 않고 각자 판정하므로, 한쪽 조건을
   * 고치면 겹치거나(같은 사실을 두 번) 비거나(아무 말도 없음) 한다. 주석으로는 못 막는다.
   */
  it("경고와 정확히 배타다 — 어느 갈래에서도 둘 중 하나만 나온다", () => {
    const every = [
      record(0),
      record(1),
      record(5),
      replay(0, 0, 0),
      replay(3, 0, 3),
      replay(3, 2, 1),
      replay(3, 3, 0),
      replay(1, 1, 0),
    ];

    for (const summary of every) {
      const spoke = [externalSessionOutcome(summary, PATH), externalSessionNotice(summary)].filter(
        (value) => value !== undefined,
      );

      expect(spoke).toHaveLength(1);
    }
  });
});

/**
 * #259 — 진단이 MCP 오류 채널을 안 타는지는 `record` 쪽에서 이미 본다
 * (`engine-memory.test.ts`). 여기서는 그 구조화된 값을 CLI 가 텍스트로 옮기는 배치만 본다.
 */
/**
 * ADR-0062. body 에 남은 URL 을 지우지 않고 세어 알리는 자리다. **개수만 말하고 값은 싣지
 * 않는다** — 알림이 새 유출 경로가 되면 고치려던 것을 그 자리에서 다시 만든다.
 */
describe("세션 본문 URL 알림 (ADR-0062)", () => {
  const withUrls = (echoed: number, other: number, truncated = false): SessionSummary =>
    ({ ...record(1), bodyUrls: { echoed, other, truncated } }) as SessionSummary;

  it("남은 URL 이 없으면 아무 말도 하지 않는다", () => {
    expect(bodyUrlNotice(withUrls(0, 0))).toBeUndefined();
  });

  it("record 요약에 개수가 아예 없으면(구 버전 자식) 조용하다", () => {
    expect(bodyUrlNotice(record(1))).toBeUndefined();
  });

  it("재생에는 나오지 않는다 — 판정이 녹화 경로에서만 돈다", () => {
    expect(bodyUrlNotice(replay(2, 2, 0))).toBeUndefined();
  });

  it("되돌아온 경로를 먼저 말하고 무엇을 해야 하는지까지 말한다", () => {
    const notice = bodyUrlNotice(withUrls(1, 2));

    expect(notice).toContain("URL 이 3건 남아 있습니다");
    expect(notice).toContain("되돌아온 경로 1건");
    expect(notice).toContain("그 밖의 URL 2건");
    // 확신도 순서 — 되돌아온 경로가 그 밖보다 먼저다.
    expect(notice?.indexOf("되돌아온 경로")).toBeLessThan(notice?.indexOf("그 밖의 URL") ?? -1);
    // 알림으로 끝내지 않고 다음 행동을 준다.
    expect(notice).toContain("커밋하기 전에");
    expect(notice).toContain("폐기·재발급");
  });

  it("한 갈래만 있으면 그 줄만 낸다", () => {
    expect(bodyUrlNotice(withUrls(2, 0))).not.toContain("그 밖의 URL");
    expect(bodyUrlNotice(withUrls(0, 2))).not.toContain("되돌아온 경로");
  });

  /**
   * 지문 개수 상한에 걸렸으면 이 수는 **최소값**이다. "N건" 이라고 말하면 사용자는 그 수를
   * 다 확인하면 끝이라고 읽는다.
   */
  it("잘렸으면 '이상' 을 붙여 최소값임을 말한다", () => {
    const notice = bodyUrlNotice(withUrls(1, 2, true));

    expect(notice).toContain("3건 이상 남아 있습니다");
    expect(notice).toContain("되돌아온 경로 1건 이상");
    expect(notice).toContain("그 밖의 URL 2건 이상");
  });

  it("URL 도 그 일부도 싣지 않는다 — 개수와 고정 문구뿐이다", () => {
    const notice = bodyUrlNotice(withUrls(3, 4)) ?? "";

    expect(notice).not.toMatch(/https?:\/\//);
    // 지문(hex)도 나가지 않는다.
    expect(notice).not.toMatch(/[0-9a-f]{16}/);
  });
});

describe("재생 원본 miss 진단 렌더링", () => {
  const miss = (overrides: Partial<ReplayMissDetail> = {}): ReplayMissDetail => ({
    method: "GET",
    url: "http://127.0.0.1:1/weather?city=busan",
    occurrence: 0,
    matchKeyPrefix: "949ea7651109",
    ...overrides,
  });

  it("miss 가 없으면 빈 문자열이다", () => {
    expect(renderReplayMissDiagnostics([])).toBe("");
  });

  it("개행이 실제 줄바꿈으로 남는다 — MCP 오류 채널의 \\u000a 이스케이프를 겪지 않는다(#259)", () => {
    const block = renderReplayMissDiagnostics([miss()]);

    expect(block).not.toContain("\\u000a");
    expect(block.split("\n").length).toBeGreaterThan(1);
  });

  it("269자를 넘는 요청 URL 도 잘리지 않는다(#259) — 200자 상한은 runner 의 것이다", () => {
    const longUrl = `http://127.0.0.1:1/weather?city=${"a".repeat(260)}`;
    const block = renderReplayMissDiagnostics([miss({ url: longUrl })]);

    expect(block).toContain(longUrl);
    expect(block).not.toContain("자 생략");
  });

  it("건수와 각 호출의 method·url·occurrence·matchKey 를 보여준다", () => {
    const block = renderReplayMissDiagnostics([
      miss({ occurrence: 0 }),
      miss({ method: "POST", url: "http://127.0.0.1:1/pay", occurrence: 1 }),
    ]);

    expect(block).toContain("재생 원본에서 찾지 못한 호출 2건");
    expect(block).toContain("GET http://127.0.0.1:1/weather?city=busan");
    expect(block).toContain("occurrence 0 · matchKey 949ea7651109…");
    expect(block).toContain("POST http://127.0.0.1:1/pay");
    expect(block).toContain("occurrence 1 · matchKey 949ea7651109…");
  });

  it("고칠 방법을 말한다", () => {
    const block = renderReplayMissDiagnostics([miss()]);

    expect(block).toContain("녹화된 뒤에 추가되었거나");
    expect(block).toContain("녹화를 다시 하거나");
  });

  it("필드에 제어 문자가 섞이면 이스케이프하고, 정적 문구의 개행은 손대지 않는다", () => {
    const bell = String.fromCharCode(7);
    const block = renderReplayMissDiagnostics([miss({ method: `GET${bell}` })]);

    expect(block).toContain("GET\\u0007");
    expect(block).not.toContain("\\u000a");
  });
});

/**
 * #260 — 세션을 열지 못했을 때의 문장을 본다.
 *
 * 한때 이 자리가 문장 하나로 모든 실패를 덮어서, 경로를 잘못 친 사람에게 손상된 세션의
 * 문안과 녹화의 쓰기 권한 안내를 동시에 말했다. 갈래마다 다음에 할 일이 다르다는 것이
 * 이 테스트가 고정하는 것이다.
 */
describe("External 세션 열기 실패 문장", () => {
  const PATH = "/tmp/없는파일.db";
  const newline = String.fromCharCode(10);
  const coded = (code: string, message: string): Error =>
    Object.assign(new Error(message), { code });

  it("파일이 없으면 경로를 보여주고 녹화를 안내한다", () => {
    const failure = externalOpenFailure("replay", PATH, new SessionFileMissingError(PATH));

    expect(failure.message).toContain("세션 파일을 찾을 수 없습니다");
    expect(failure.message).toContain(PATH);
    expect(failure.hint).toContain("--record-session");
    // 재생은 읽기다. 쓰기 권한 안내가 붙으면 사용자를 엉뚱한 곳으로 보낸다.
    expect(failure.hint).not.toContain("쓰기 권한");
    // 손상된 세션의 문안과 겹치지 않는다.
    expect(failure.message).not.toContain("완료");
  });

  it("빈 세션과 미완료 세션을 다른 문장으로 가른다", () => {
    const empty = externalOpenFailure("replay", PATH, coded("SESSION_NOT_FOUND", "x"));
    const broken = externalOpenFailure("replay", PATH, coded("REPLAY_SOURCE_INVALID", "x"));

    expect(empty.message).toContain("녹화된 외부 호출이 없습니다");
    expect(broken.message).toContain("녹화가 완료되지 않은");
    expect(empty.message).not.toBe(broken.message);
    for (const failure of [empty, broken]) expect(failure.message).toContain(PATH);
  });

  it("분류하지 못한 실패는 원인을 버리지 않고 모드에 맞는 안내를 준다", () => {
    const replay = externalOpenFailure("replay", PATH, new Error("file is not a database"));
    const record = externalOpenFailure("record", PATH, new Error("unable to open database file"));

    expect(replay.message).toContain("file is not a database");
    expect(replay.hint).toContain("읽을 수 있는지");
    expect(replay.hint).not.toContain("쓰기 권한");
    // 녹화는 실제로 쓰므로 그 안내가 맞다. 이 대칭이 깨지면 안 된다.
    expect(record.hint).toContain("쓰기 권한");
  });

  it("어느 갈래도 내부 세션 id 를 노출하지 않고, 이 갈래들은 한 줄이다", () => {
    const failures = [
      externalOpenFailure("replay", PATH, new SessionFileMissingError(PATH)),
      externalOpenFailure("replay", PATH, coded("SESSION_NOT_FOUND", "x")),
      externalOpenFailure("replay", PATH, coded("REPLAY_SOURCE_INVALID", "x")),
      externalOpenFailure("replay", PATH, new Error("boom")),
      externalOpenFailure("record", PATH, new Error("boom")),
    ];

    for (const failure of failures) {
      // 사용자가 준 적 없는 이름이라 화면에서 무엇을 가리키는지 알 수 없다.
      expect(failure.message).not.toContain("default");
      // 이 갈래들은 할 말이 원래 한 줄이다 — resetFailure 처럼 진단을 나눠 담을 이유가
      // 없다. format() 은 이제 message·hint 를 다시 이스케이프하지 않으므로(#289), 여기서
      // 개행이 없다는 것은 format() 이 지켜서가 아니라 우리가 애초에 한 줄로 썼기 때문이다.
      expect(failure.hint).not.toContain(newline);
      expect(failure.message).not.toContain(newline);
    }
  });

  /**
   * #290 이 지목한 잔여 갈래 1 — `SESSION_ALREADY_EXISTS` 가 갈래 없이 fallback 으로 떨어져
   * "쓰기 권한을 확인하세요" 를 듣던 자리. 권한은 멀쩡하고, 오히려 있는 파일을 지키려고
   * 막은 것이라 원인과 반대 방향이었다.
   */
  it("이미 존재하는 세션에 다시 녹화하면 원인에 맞는 안내를 준다", () => {
    const failure = externalOpenFailure("record", PATH, coded("SESSION_ALREADY_EXISTS", "x"));

    expect(failure.message).toContain("이미 녹화가 있습니다");
    expect(failure.message).toContain(PATH);
    expect(failure.hint).not.toContain("쓰기 권한");
    expect(failure.hint).toContain("--record-session");
  });

  /**
   * ADR-0061 로 재생이 읽기 전용이 되면서 새로 닿을 수 있게 된 코드다. record 가 이 코드에
   * 붙이는 원문은 두 줄인데(`SCHEMA_VERSION_UNSUPPORTED` 문구), fallback 으로 떨어져 그
   * 원문을 그대로 이스케이프하면 안의 개행이 escape sequence 로 찍혀 #289 가 고친 문제가
   * 재발한다 — 그래서 우리 문장으로 가는 별도 갈래가 필요하다.
   */
  it("store version 이 다른 세션은 다시 녹화하라고 말하고 record 의 원문을 새지 않는다", () => {
    const failure = externalOpenFailure(
      "replay",
      PATH,
      coded(
        "SCHEMA_VERSION_UNSUPPORTED",
        "이 세션 파일은 지원하지 않는 store version 입니다(현재 1).\n→ 이 버전의 mcpeak 으로 다시 녹화하세요.",
      ),
    );

    expect(failure.message).not.toContain(newline);
    expect(failure.hint).not.toContain(newline);
    expect(failure.hint).toContain("다시 녹화");
  });

  /**
   * `path`·record 원문은 사용자가 타이핑한 값·record 가 던진 오류 원문이라 우리 글이 아니다
   * (#289). 화면을 깨뜨릴 제어 문자가 실려도 이스케이프되어 나가는지 본다.
   */
  it("경로와 원인 문장에 실린 제어 문자를 이스케이프한다", () => {
    const dirtyPath = "bad\npath";
    const missing = externalOpenFailure(
      "replay",
      dirtyPath,
      new SessionFileMissingError(dirtyPath),
    );
    expect(missing.message).toContain("\\u000a");
    expect(missing.message).not.toContain(newline);

    const fallback = externalOpenFailure(
      "record",
      PATH,
      new Error(`boom${String.fromCharCode(27)}[31m`),
    );
    expect(fallback.message).toContain("\\u001b");
    expect(fallback.message).not.toContain(String.fromCharCode(27));
  });
});

/**
 * `wiring.finish()` 실패를 사용자 문장으로 옮긴다(#289). record 의 store `finish()` 가
 * 던질 수 있는 코드는 둘뿐이다 — `SESSION_NOT_RUNNING`(한 줄) 과 `INCOMPLETE_SESSION`
 * (record 가 여러 줄로 쓴, 이미 마스킹된 진단). 이 갈래를 놓치면 CodeRabbit 이 지적한 대로
 * `error.message` 를 이스케이프 없이 그대로 hint 에 실어 화면을 깨뜨릴 수 있었다.
 */
describe("External 세션 닫기 실패 문장", () => {
  const coded = (code: string, message: string): Error =>
    Object.assign(new Error(message), { code });

  it("INCOMPLETE_SESSION 은 record 의 여러 줄 진단을 그대로 보여준다", () => {
    const detail =
      "External session 'default'에 완료되지 않은 외부 호출이 1건 있습니다.\n" +
      "  - GET https://example.com/<redacted>\n" +
      "→ 지원하지 않는 응답을 받으면 그 호출은 저장하지 않고 세션을 실패로 둡니다.";
    const failure = externalCloseFailure(coded("INCOMPLETE_SESSION", detail));

    expect(failure.hint).toBe(detail);
  });

  it("그 밖의 원인은 이스케이프해서 화면을 깨뜨릴 값을 막는다", () => {
    const failure = externalCloseFailure(
      coded("SESSION_NOT_RUNNING", `boom${String.fromCharCode(27)}[31m`),
    );

    expect(failure.hint).toContain("\\u001b");
    expect(failure.hint).not.toContain(String.fromCharCode(27));
  });

  it("Error 가 아닌 값도 문자열로 다뤄 죽지 않는다", () => {
    const failure = externalCloseFailure("문자열 원인");

    expect(failure.hint).toBe("문자열 원인");
    expect(failure.message).toContain("닫지 못했습니다");
  });
});

/**
 * ADR-0068. 재생 중 범위 밖으로 나간 호출을 **사실로** 알린다.
 *
 * 이 알림의 존재 이유는 부분 커버리지다 — 어댑터가 잡은 호출이 하나라도 있으면 기존 경고 네
 * 갈래가 전부 침묵하는데, 그 사이로 나머지가 실제 네트워크로 샌다.
 */
describe("범위 밖 호출 알림 (ADR-0068)", () => {
  const leaked = (outOfScope: number | undefined): SessionSummary =>
    ({ ...replay(3, 3, 0), ...(outOfScope === undefined ? {} : { outOfScope }) }) as SessionSummary;

  it("나간 호출이 있으면 개수와 재현 불가를 말한다", () => {
    const notice = outOfScopeNotice(leaked(2));

    expect(notice).toContain("범위 밖 호출 2건이 실제 네트워크로 나갔습니다");
    expect(notice).toContain("재현 가능하지 않습니다");
    // 알림으로 끝내지 않고 다음 행동을 준다.
    expect(notice).toContain("mcpeak mock");
  });

  it("0 이면 아무 말도 하지 않는다", () => {
    expect(outOfScopeNotice(leaked(0))).toBeUndefined();
  });

  /**
   * **부재는 0 이 아니다.** 자식이 강제 종료돼 보고 훅이 못 뛴 경우다. 여기서 "0건" 이라고
   * 말하면 이 기능이 없애려던 거짓 안심을 그대로 되살린다 — 그 갈래의 방어는 결과 문장에
   * 남는 조건절이 맡는다.
   */
  it("못 셌으면 침묵한다 — 0건이라고 말하지 않는다", () => {
    const notice = outOfScopeNotice(leaked(undefined));

    expect(notice).toBeUndefined();
  });

  it("녹화에는 나오지 않는다 — 녹화는 실제로 나가는 것이 정상이다", () => {
    expect(outOfScopeNotice(record(3))).toBeUndefined();
  });

  it("경고 갈래와 함께 나갈 수 있다 — 축이 다르다", () => {
    // 일부 미재생(원인: 원본과 실행 경로 차이)과 범위 밖 유출(원인: 어댑터 범위)은 동시에
    // 참일 수 있고 원인이 다르다. 배타로 묶으면 하나가 다른 하나를 가린다.
    const summary = { ...replay(3, 2, 1), outOfScope: 1 } as SessionSummary;

    expect(externalSessionNotice(summary)).toBeDefined();
    expect(outOfScopeNotice(summary)).toBeDefined();
  });
});

/**
 * ADR-0068 이 결과 문장에 준 변화. 0 을 **확인했으면** 조건절을 뗀다 — 안 떼면 관측을 붙인
 * 의미가 화면에 안 나타난다.
 */
describe("결과 문장의 조건절 (ADR-0068)", () => {
  const PATH2 = "tmp/weather.db";

  it("범위 밖 0건을 확인하면 단서를 붙이지 않는다", () => {
    const line = externalSessionOutcome(
      { ...replay(3, 3, 0), outOfScope: 0 } as SessionSummary,
      PATH2,
    );

    expect(line).toContain("재생했습니다");
    expect(line).not.toContain("어댑터가 잡은 호출만 셉니다");
  });

  it("못 셌으면 단서가 남는다", () => {
    const line = externalSessionOutcome(replay(3, 3, 0), PATH2);

    expect(line).toContain("어댑터가 잡은 호출만 셉니다");
  });

  it("녹화는 셀 수단이 없어 항상 단서가 붙는다", () => {
    expect(externalSessionOutcome(record(3), PATH2)).toContain("어댑터가 잡은 호출만 셉니다");
  });
});

/**
 * 실패한 실행의 녹화는 재생 원본으로 **거부된다**(`EXTERNAL_SESSION_FAILED` —
 * "녹화가 완료되지 않은 세션입니다"). 그런데도 "녹화했습니다" 라고 하면 사용자는 못 쓰는
 * 파일을 가진 채 가졌다고 믿는다. ADR-0066 이 없애려던 종류의 거짓말이 이 함수 안에서 다시
 * 생기는 자리라, 상태를 갈라 고정한다.
 */
describe("실패한 실행의 결과 문장 (ADR-0066)", () => {
  const PATH3 = "tmp/weather.db";
  const failedRecord = (interactionCount: number): SessionSummary =>
    ({ ...record(interactionCount), status: "failed" }) as SessionSummary;

  it("실패한 녹화는 완료했다고 말하지 않는다", () => {
    const line = externalSessionOutcome(failedRecord(3), PATH3);

    expect(line).toContain("녹화를 완료하지 않았습니다");
    expect(line).toContain("재생 원본으로 쓸 수 없습니다");
    expect(line).toContain("다시 녹화하세요");
    // 이 문장이 남아 있으면 고친 의미가 없다.
    expect(line).not.toContain("3건을 녹화했습니다");
  });

  it("잡은 개수는 그대로 말한다 — 0건과 3건은 다른 상황이다", () => {
    expect(externalSessionOutcome(failedRecord(3), PATH3)).toContain("3건을 잡았지만");
  });

  /**
   * **재생은 상태로 가르지 않는다.** 실패한 재생은 재생이 실패한 것이 아니라 판정이 실패한
   * 것이고, N건은 실제로 재생됐다. 여기서 침묵하면 실패한 실행에서 녹화·재생을 구분할 수
   * 없어지는데, 원인을 찾을 때 그 구분이 가장 필요하다.
   */
  it("실패한 재생은 여전히 재생이라고 말한다", () => {
    const line = externalSessionOutcome(
      { ...replay(3, 3, 0), status: "failed" } as SessionSummary,
      PATH3,
    );

    expect(line).toContain("3건을 재생했습니다");
  });

  it("실패해도 경고와의 배타성은 유지된다", () => {
    for (const summary of [failedRecord(0), failedRecord(3)]) {
      const spoke = [externalSessionOutcome(summary, PATH3), externalSessionNotice(summary)].filter(
        (value) => value !== undefined,
      );

      expect(spoke).toHaveLength(1);
    }
  });
});

/**
 * 세었으면 조건절을 떼는 갈래를 전부 본다(ADR-0068). 화면에서 경고와 조건절이 같은 말을 두 번
 * 하는 것을 보고 고친 자리라, 세 갈래를 다 고정한다.
 */
describe("조건절과 사실이 겹치지 않는다 (ADR-0068)", () => {
  const PATH4 = "tmp/weather.db";
  const CAVEAT = "어댑터가 잡은 호출만 셉니다";
  const counted = (outOfScope: number): SessionSummary =>
    ({ ...replay(3, 3, 0), outOfScope }) as SessionSummary;

  it("0 건을 확인하면 조건절이 없다", () => {
    expect(externalSessionOutcome(counted(0), PATH4)).not.toContain(CAVEAT);
  });

  /**
   * **이것이 이 수선의 요점이다.** `outOfScopeNotice` 가 "N건이 나갔습니다" 를 사실로 말하는데
   * 그 위에 "나갈 수 있습니다" 를 얹으면 같은 말이 두 번 나가고, 조건절이 먼저 읽혀 경고를
   * 흐린다.
   */
  it("N 건을 확인해도 조건절이 없다 — 사실이 그 자리를 대신한다", () => {
    const line = externalSessionOutcome(counted(2), PATH4);

    expect(line).not.toContain(CAVEAT);
    // 사실 쪽은 그대로 나온다.
    expect(outOfScopeNotice(counted(2))).toContain("2건이 실제 네트워크로 나갔습니다");
  });

  it("못 셌을 때만 조건절이 남는다", () => {
    expect(externalSessionOutcome(replay(3, 3, 0), PATH4)).toContain(CAVEAT);
  });
});

/**
 * ADR-0069. 원본을 **언제** 녹화했는지 보인다. 낡았는지 판정하지는 않는다.
 *
 * 여기서 지키는 것은 두 가지다 — 시각을 보여주는가, 그리고 **나이를 계산하지 않는가.**
 * 뒤쪽이 더 중요하다. 나이나 임계값 경고는 지금 시각을 읽어야 하고, 그러면 같은 세션의 같은
 * 재생이 날마다 다른 바이트를 낸다.
 */
describe("녹화 시각 표시 (ADR-0069)", () => {
  const PATH5 = "tmp/weather.db";
  const at = (recordedAt: string): SessionSummary =>
    ({ ...replay(3, 3, 0), recordedAt }) as SessionSummary;

  it("재생 문장에 녹화 시각을 UTC 로 덧붙인다", () => {
    const line = externalSessionOutcome(at("2026-05-01T09:12:33.123Z"), PATH5);

    expect(line).toContain("(2026-05-01 09:12:33 UTC 녹화)");
    // 밀리초는 낡음 판단에 쓸모가 없다.
    expect(line).not.toContain(".123");
  });

  /**
   * **이 테스트가 이 기능의 핵심 제약이다.** 나이를 계산하는 순간 출력이 시계에 묶이고,
   * 대시보드 e2e 의 "같은 실행은 바이트까지 같다" 단언이 깨진다.
   */
  it("나이를 계산하지 않는다 — 같은 요약이면 언제 불러도 같은 문자열", () => {
    const summary = at("2020-01-02T03:04:05.000Z");
    const first = externalSessionOutcome(summary, PATH5);

    expect(externalSessionOutcome(summary, PATH5)).toBe(first);
    // 아주 오래된 녹화여도 판정 문구가 붙지 않는다.
    expect(first).not.toContain("전");
    expect(first).not.toContain("오래");
    expect(first).not.toContain("낡");
  });

  /**
   * `toLocale*` 를 쓰면 기계의 로캘·타임존에 따라 같은 세션이 CI 와 로컬에서 다른 문자열을
   * 낸다. 타임존을 바꿔도 출력이 그대로여야 한다.
   */
  it("타임존을 바꿔도 같은 문자열이다", () => {
    const summary = at("2026-05-01T23:30:00.000Z");
    const saved = process.env.TZ;
    try {
      process.env.TZ = "UTC";
      const utc = externalSessionOutcome(summary, PATH5);
      process.env.TZ = "Asia/Seoul";
      const seoul = externalSessionOutcome(summary, PATH5);

      expect(seoul).toBe(utc);
      // 날짜가 KST 로 넘어가 5월 2일이 되면 안 된다.
      expect(seoul).toContain("2026-05-01 23:30:00 UTC");
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });

  it("시각이 없으면 아무것도 붙이지 않는다", () => {
    expect(externalSessionOutcome(replay(3, 3, 0), PATH5)).not.toContain("녹화)");
  });

  it("모양이 다른 값은 손대지 않고 그대로 보여준다", () => {
    // 구 버전 파일 등. 파싱에 실패했다고 정보를 버리지 않는다.
    expect(externalSessionOutcome(at("2026/05/01"), PATH5)).toContain("(2026/05/01 녹화)");
  });

  it("녹화 실행에는 붙지 않는다 — 지금 시각이라 쓸모없고 비결정적이다", () => {
    expect(externalSessionOutcome(record(3), PATH5)).not.toContain("녹화)");
  });
});
