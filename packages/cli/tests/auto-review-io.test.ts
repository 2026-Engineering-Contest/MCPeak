import { describe, expect, it } from "vitest";
import { autoReviewIO } from "../src/auto-review-io.js";

function make() {
  const lines: string[] = [];
  const io = autoReviewIO({ write: (text) => lines.push(text) });
  return { io, lines };
}

describe("autoReviewIO 정책", () => {
  it("검토 메뉴는 처음 save, 그 뒤 cancel", async () => {
    const { io } = make();
    expect(await io.choose("검토 메뉴", ["show", "save", "cancel"])).toBe("save");
    expect(await io.choose("검토 메뉴", ["show", "save", "cancel"])).toBe("cancel");
  });
  it("확인은 예. 선언 위반이 남은 후보의 적용만 아니오", async () => {
    const { io } = make();
    expect(await io.confirm("이 요청을 전송할까요?")).toBe(true);
    expect(await io.confirm("계속할까요?")).toBe(true);
    expect(await io.confirm("   다시 실행할까요?")).toBe(true);
    expect(await io.confirm("최종 JSON을 저장할까요?")).toBe(true);
    expect(await io.confirm("위반 2건이 남아 있습니다. 그래도 적용합니까?")).toBe(false);
  });
  it("실패 분류는 서버 결함(s)", async () => {
    const { io } = make();
    expect(await io.input("      선택: ")).toBe("s");
  });
  it("교정 값 입력은 엔터(제안 또는 현재 값 채택)", async () => {
    const { io } = make();
    expect(
      await io.input(
        '  get_weather.city (필드 1/1, string, 현재 "example", 엔터 = 제안 값 "서울"): ',
      ),
    ).toBe("");
  });
  it("자동 결정을 sink 에 한 줄씩 남기고 write 는 그대로 넘긴다", async () => {
    const { io, lines } = make();
    io.write("본문\n");
    await io.confirm("계속할까요?");
    await io.input("      선택: ");
    expect(lines).toEqual([
      "본문\n",
      "▸ 자동 승인: 계속할까요? → 예\n",
      "▸ 자동 승인: 선택: → s\n",
    ]);
    expect(io.interactive).toBe(true);
  });
});
