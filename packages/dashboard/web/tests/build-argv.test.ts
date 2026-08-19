// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { GenerateForm } from "../src/generate/build-argv.js";
import { buildGenerateArgv } from "../src/generate/build-argv.js";

/** 최소 필수 입력만 채운 폼. 각 테스트가 필요한 필드만 덮어쓴다. */
const BASE: GenerateForm = {
  // command에는 실행 파일 하나만 온다(CLI --command 계약). 스크립트 경로는 args로 간다.
  command: "node",
  args: [],
  suiteId: "weather",
  suiteName: "날씨 서버",
  outPath: "examples/weather/suite.json",
  force: false,
  mode: "ai",
  provider: "claude",
  model: "",
  dryRun: true,
  repair: true,
  cassettePath: "",
  record: false,
  resetCmd: "",
};

describe("buildGenerateArgv", () => {
  it("최소 필수 입력의 argv가 §4-4 순서와 정확히 일치한다", () => {
    expect(buildGenerateArgv(BASE)).toEqual([
      "--command",
      "node",
      "--suite-id",
      "weather",
      "--name",
      "날씨 서버",
      "--out",
      "examples/weather/suite.json",
      "--provider",
      "claude",
    ]);
  });

  it("args 두 개가 --arg 쌍 두 벌로 나온다", () => {
    const argv = buildGenerateArgv({ ...BASE, args: ["--port", "8080"] });
    expect(argv.slice(0, 6)).toEqual(["--command", "node", "--arg", "--port", "--arg", "8080"]);
  });

  it("baseline 모드는 --baseline-only를 넣고 --provider·--model을 넣지 않는다", () => {
    const argv = buildGenerateArgv({ ...BASE, mode: "baseline", model: "claude-sonnet-5" });
    expect(argv).toContain("--baseline-only");
    expect(argv).not.toContain("--provider");
    expect(argv).not.toContain("--model");
  });

  it("ai 모드에서 model이 비어 있으면 --model이 없다", () => {
    expect(buildGenerateArgv(BASE)).not.toContain("--model");
    expect(buildGenerateArgv({ ...BASE, model: "claude-sonnet-5" })).toEqual([
      ...buildGenerateArgv(BASE),
      "--model",
      "claude-sonnet-5",
    ]);
  });

  it("dryRun을 끄면 --no-dry-run이 들어간다", () => {
    const argv = buildGenerateArgv({ ...BASE, dryRun: false });
    expect(argv).toContain("--no-dry-run");
  });

  it("dryRun 끔 + 카세트는 throw한다(초기화 명령, 자동 교정 동시 끔도 각각)", () => {
    expect(() =>
      buildGenerateArgv({ ...BASE, dryRun: false, cassettePath: "cassette.json" }),
    ).toThrowError("시험 실행을 끄면 카세트를 녹화할 수 없습니다.");
    expect(() =>
      buildGenerateArgv({ ...BASE, dryRun: false, resetCmd: "rm -rf tmp" }),
    ).toThrowError("시험 실행을 끄면 초기화 명령을 쓸 수 없습니다.");
    expect(() => buildGenerateArgv({ ...BASE, dryRun: false, repair: false })).toThrowError(
      "시험 실행과 자동 교정을 동시에 끌 수 없습니다.",
    );
  });

  it("record인데 카세트가 비면 throw한다", () => {
    expect(() => buildGenerateArgv({ ...BASE, record: true })).toThrowError(
      "재녹화는 카세트 저장 위치가 있어야 합니다.",
    );
  });

  it("필수 빈 값마다 throw한다", () => {
    expect(() => buildGenerateArgv({ ...BASE, command: "" })).toThrowError(
      "실행 명령을 입력하세요.",
    );
    expect(() => buildGenerateArgv({ ...BASE, suiteId: "" })).toThrowError(
      "스위트 ID를 입력하세요.",
    );
    expect(() => buildGenerateArgv({ ...BASE, suiteName: "" })).toThrowError(
      "스위트 이름을 입력하세요.",
    );
    expect(() => buildGenerateArgv({ ...BASE, outPath: "" })).toThrowError(
      "저장 위치를 입력하세요.",
    );
  });

  it("같은 폼 두 번 조립이 깊은 동일이다(결정론)", () => {
    const form: GenerateForm = {
      ...BASE,
      args: ["--flag", "값"],
      force: true,
      model: "claude-sonnet-5",
      cassettePath: "cassette.json",
      record: true,
      resetCmd: "./reset.sh",
    };
    expect(buildGenerateArgv(form)).toEqual(buildGenerateArgv(form));
  });
});
