import { describe, expect, it } from "vitest";
import { parseTestCommand } from "../src/test-command.js";

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
