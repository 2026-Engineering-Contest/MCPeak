// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildPerfRequest,
  type PerfForm,
  performanceUnavailable,
  perfStartNotice,
} from "../src/analyze/build-perf-request.js";

const REMOTE_REASON =
  "원격(HTTP) 서버는 측정할 수 없습니다. 성능 측정은 서버 프로세스 안에 관측 코드를 실어야 해서, 대시보드가 직접 띄우는 stdio 서버만 됩니다.";
const UNAPPROVED_LINE =
  "이 명세는 아직 승인되지 않았습니다(approval 없음). 케이스 내용을 확인한 뒤 측정하세요.";
const REPEAT_ERROR = "반복 횟수는 1 이상 100 이하의 정수여야 합니다.";

const FORM: PerfForm = { suitePath: "s.json", repeat: "5", tools: [] };

describe("buildPerfRequest", () => {
  it("원격 대상은 사유 문장으로 거절한다", () => {
    expect(performanceUnavailable("http")).toBe(REMOTE_REASON);
    expect(performanceUnavailable("stdio")).toBeNull();
    expect(() => buildPerfRequest([], undefined, "http", FORM)).toThrow(REMOTE_REASON);
  });

  it("명세가 없거나 json 이 아니면 거절한다", () => {
    expect(() => buildPerfRequest([], undefined, "stdio", { ...FORM, suitePath: "  " })).toThrow(
      "측정할 명세를 고르세요.",
    );
    expect(() => buildPerfRequest([], undefined, "stdio", { ...FORM, suitePath: "a.txt" })).toThrow(
      "명세 경로는 .json 으로 끝나야 합니다.",
    );
  });

  it("반복 횟수는 1 이상 100 이하 정수다", () => {
    for (const repeat of ["0", "101", "1.5", "abc", ""]) {
      expect(() => buildPerfRequest([], undefined, "stdio", { ...FORM, repeat })).toThrow(
        REPEAT_ERROR,
      );
    }
    expect(buildPerfRequest([], undefined, "stdio", { ...FORM, repeat: "1" }).repeat).toBe(1);
    expect(buildPerfRequest([], undefined, "stdio", { ...FORM, repeat: "100" }).repeat).toBe(100);
  });

  it("본문은 빈 도구를 빼고 선택 필드를 생략한다", () => {
    expect(
      buildPerfRequest(["--command", "node"], "srv", "stdio", {
        suitePath: " s.json ",
        repeat: "3",
        tools: [" a ", ""],
      }),
    ).toEqual({
      argv: ["--command", "node"],
      serverId: "srv",
      suitePath: "s.json",
      repeat: 3,
      tools: ["a"],
    });
    const bare = buildPerfRequest(["--command", "node"], undefined, "stdio", FORM);
    expect(Object.keys(bare)).toEqual(["argv", "suitePath", "repeat"]);
  });

  it("고지는 승인 여부에 따라 줄 수가 다르다", () => {
    const approved = perfStartNotice(5, true);
    expect(approved).toHaveLength(2);
    expect(approved[0]).toBe(
      "명세의 성공 케이스를 케이스마다 5번 실제로 호출합니다. 쓰기 도구도 포함됩니다.",
    );
    const unapproved = perfStartNotice(3, false);
    expect(unapproved).toHaveLength(3);
    expect(unapproved[2]).toBe(UNAPPROVED_LINE);
  });
});
