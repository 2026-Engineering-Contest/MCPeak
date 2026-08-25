// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  effectiveRepairBundlePath,
  managedRepairBundlePath,
  repairBundlePathOf,
} from "../src/repair-bundle-path.js";

/**
 * 관리 경로 규칙(설계 §6-1, §6-4). 같은 스위트면 같은 값이어야 하고, 실행 뷰가 argv 에서 같은
 * 값을 되읽을 수 있어야 한다. 두 방향이 어긋나면 폼은 채워지는데 파일은 다른 곳에 있다.
 */
describe("repair-bundle-path", () => {
  it("관리 경로는 / 를 __ 로 바꾸고 .json 을 떼어 .repair-bundle.json 을 붙인다", () => {
    expect(managedRepairBundlePath("generated/weather.baseline.json")).toBe(
      ".mcpeak/repair/generated__weather.baseline.repair-bundle.json",
    );
    expect(managedRepairBundlePath("suite.json")).toBe(".mcpeak/repair/suite.repair-bundle.json");
    // 결정론: 두 번 불러도 같다.
    expect(managedRepairBundlePath("a/b/c.json")).toBe(managedRepairBundlePath("a/b/c.json"));
  });

  it(".json 으로 끝나지 않는 스위트는 그대로 뒤에 붙인다", () => {
    expect(managedRepairBundlePath("a/b.suite")).toBe(
      ".mcpeak/repair/a__b.suite.repair-bundle.json",
    );
  });

  it("사용자 경로가 있으면 trim 해서 쓰고 비어 있으면 관리 경로다", () => {
    expect(effectiveRepairBundlePath("s.json", "  out/bundle.json ")).toBe("out/bundle.json");
    expect(effectiveRepairBundlePath("s.json", "   ")).toBe(".mcpeak/repair/s.repair-bundle.json");
    expect(effectiveRepairBundlePath("s.json", "")).toBe(".mcpeak/repair/s.repair-bundle.json");
  });

  it("argv 의 --repair-bundle 값을 읽는다 (공백 분리와 = 형식 모두)", () => {
    expect(
      repairBundlePathOf(["s.json", "--command", "node", "--repair-bundle", "out/b.json"]),
    ).toBe("out/b.json");
    expect(repairBundlePathOf(["s.json", "--repair-bundle=out/b.json", "--determinism"])).toBe(
      "out/b.json",
    );
    // 값이 없이 끝나면 없는 것과 같다.
    expect(repairBundlePathOf(["s.json", "--repair-bundle"])).toBeNull();
  });

  it("argv 에 --repair-bundle 이 없으면 null 이다", () => {
    expect(repairBundlePathOf(["s.json", "--command", "node", "--arg", "server.js"])).toBeNull();
    expect(repairBundlePathOf([])).toBeNull();
  });
});
