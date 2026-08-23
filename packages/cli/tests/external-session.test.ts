import type { ReplayMissDetail, SessionSummary } from "@mcpeak/record/external";
import { describe, expect, it } from "vitest";
import { SessionFileMissingError } from "../src/external-wiring.js";
import {
  externalCloseFailure,
  externalOpenFailure,
  externalSessionNotice,
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
 * #259 — 진단이 MCP 오류 채널을 안 타는지는 `record` 쪽에서 이미 본다
 * (`engine-memory.test.ts`). 여기서는 그 구조화된 값을 CLI 가 텍스트로 옮기는 배치만 본다.
 */
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
