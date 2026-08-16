import { DEFAULT_MAX_REPAIR_CASES } from "@ohmymcp/generate";
import { describe, expect, it } from "vitest";
import { commandHelp } from "../src/help.js";
import {
  DEFAULT_REPAIR_MAX_CASES,
  parseRepairCommand,
  type RepairCommandDependencies,
  runRepairCommand,
} from "../src/repair-command.js";

const BASE = ["bundle.json", "--provider", "codex", "--model", "gpt-5-codex"];

function deps(overrides: Partial<RepairCommandDependencies> = {}) {
  const writes = { out: [] as string[], err: [] as string[] };
  const value: RepairCommandDependencies = {
    readFile: async () => "{}",
    writeStdout: (text) => writes.out.push(text),
    writeStderr: (text) => writes.err.push(text),
    ...overrides,
  };
  return { value, writes };
}

/** 파싱 실패는 runRepairCommand 를 거쳐 CLI_USAGE 로 나온다. 그 문자열을 판정에 쓴다. */
async function usageOf(argv: readonly string[]): Promise<string> {
  const d = deps();
  const code = await runRepairCommand(argv, d.value);
  expect(code).toBe(1);
  return d.writes.err.join("");
}

describe("parseRepairCommand", () => {
  it("--provider 없이 부르면 CLI_USAGE 다", async () => {
    expect(() => parseRepairCommand(["bundle.json", "--model", "m"])).toThrow(
      "`--provider` 옵션이 필요합니다.",
    );
    expect(await usageOf(["bundle.json", "--model", "m"])).toContain("오류 [CLI_USAGE]");
  });

  it("--model 없이 부르면 CLI_USAGE 다", async () => {
    expect(() => parseRepairCommand(["bundle.json", "--provider", "codex"])).toThrow(
      "`--model` 옵션이 필요합니다.",
    );
    expect(await usageOf(["bundle.json", "--provider", "codex"])).toContain("오류 [CLI_USAGE]");
  });

  it("--provider 가 codex·claude 밖이면 CLI_USAGE 다", async () => {
    expect(() =>
      parseRepairCommand(["bundle.json", "--provider", "gemini", "--model", "m"]),
    ).toThrow("`--provider`는 codex 또는 claude여야 합니다.");
    expect(await usageOf(["bundle.json", "--provider", "gemini", "--model", "m"])).toContain(
      "codex 또는 claude",
    );
  });

  it("--max-cases 0·음수·소수·비정수 문자열이 CLI_USAGE 다", () => {
    for (const value of ["0", "-1", "1.5", "열", "1e3", ""])
      expect(() => parseRepairCommand([...BASE, "--max-cases", value])).toThrow();
  });

  it("--max-cases 기본값이 DEFAULT_MAX_REPAIR_CASES 다", () => {
    expect(parseRepairCommand(BASE).maxCases).toBe(DEFAULT_MAX_REPAIR_CASES);
    // 파싱은 generate 를 로드하지 않는다. 두 상수가 갈라지면 여기서 깨진다.
    expect(DEFAULT_REPAIR_MAX_CASES).toBe(DEFAULT_MAX_REPAIR_CASES);
    expect(parseRepairCommand([...BASE, "--max-cases", "3"]).maxCases).toBe(3);
  });

  it("--no-stderr 가 includeStderr 를 거짓으로 만든다", () => {
    expect(parseRepairCommand(BASE).includeStderr).toBe(true);
    expect(parseRepairCommand([...BASE, "--no-stderr"]).includeStderr).toBe(false);
    expect(parseRepairCommand(BASE).yes).toBe(false);
    expect(parseRepairCommand([...BASE, "--yes"]).yes).toBe(true);
    expect(() => parseRepairCommand([...BASE, "--no-stderr=true"])).toThrow();
  });

  it("번들 경로가 없으면 CLI_USAGE 다", async () => {
    expect(() => parseRepairCommand(["--provider", "codex", "--model", "m"])).toThrow(
      "repair 번들 JSON 경로가 필요합니다.",
    );
    expect(await usageOf(["--provider", "codex", "--model", "m"])).toContain("오류 [CLI_USAGE]");
  });

  it("ohmymcp repair --help 가 옵션 목록을 찍는다", () => {
    const help = commandHelp("repair");
    expect(help).toContain("ohmymcp repair <bundle.json>");
    for (const option of ["--provider", "--model", "--max-cases", "--no-stderr", "--yes"])
      expect(help).toContain(option);
  });
});

describe("runRepairCommand", () => {
  it("번들을 읽지 못하면 종료 코드가 1 이다", async () => {
    const d = deps({
      readFile: async () => {
        throw new Error("ENOENT");
      },
    });
    expect(await runRepairCommand(BASE, d.value)).toBe(1);
    expect(d.writes.err.join("")).toContain("REPAIR_BUNDLE_READ_FAILED");
  });

  it("번들이 형식에 안 맞으면 사유 문장과 함께 1 이다", async () => {
    const d = deps({ readFile: async () => JSON.stringify({ bundleVersion: 2 }) });
    expect(await runRepairCommand(BASE, d.value)).toBe(1);
    expect(d.writes.err.join("")).toContain("최신 `ohmymcp test --repair-bundle` 로 다시 만드세요");
  });

  /**
   * 진단 통로가 없으면 번들이 멀쩡해도 보낼 곳이 없다. 정상 경로가 0 을 낸다는 보장은
   * `repair-render.test.ts` 의 `종료 코드가 diagnosis·unsure 모두 0 이다` 가 갖는다.
   */
  it("진단 통로가 없으면 안내와 함께 1 이다", async () => {
    const bundle = {
      bundleVersion: 1,
      generatedBy: "ohmymcp 0.7.0",
      spec: { suiteId: "weather", suiteName: "날씨", approval: "matched", fingerprint: "a" },
      failures: [{ caseId: "c1", caseName: "케이스", status: "failed", diagnostics: [] }],
    };
    const d = deps({ readFile: async () => JSON.stringify(bundle) });
    expect(await runRepairCommand(BASE, d.value)).toBe(1);
    expect(d.writes.err.join("")).toContain("REPAIR_RUNTIME_UNAVAILABLE");
  });
});
