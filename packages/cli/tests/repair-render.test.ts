import { describe, expect, it, vi } from "vitest";
import type { ReviewIO } from "../src/generate-command.js";
import type { RepairBundle } from "../src/repair-bundle.js";
import { type RepairCommandDependencies, runRepairCommand } from "../src/repair-command.js";

const ARGV = ["bundle.json", "--provider", "codex", "--model", "gpt-5-codex"];

const bundle = (overrides: Partial<RepairBundle> = {}): RepairBundle =>
  ({
    bundleVersion: 1,
    generatedBy: "mcpeak 0.7.0",
    spec: {
      suiteId: "weather",
      suiteName: "날씨 서버 계약",
      approval: "matched",
      fingerprint: "a".repeat(64),
    },
    failures: [
      {
        caseId: "get-weather-unknown-city",
        caseName: "없는 도시는 거절한다",
        status: "failed",
        tool: "get_weather",
        input: { city: "toString" },
        diagnostics: [{ code: "IS_ERROR_MISMATCH", message: "isError 가 다릅니다." }],
      },
      {
        caseId: "add-negative",
        caseName: "음수를 더한다",
        status: "failed",
        tool: "add",
        input: { a: -1, b: 2 },
        diagnostics: [{ code: "BODY_SCHEMA_MISMATCH", message: "본문이 다릅니다." }],
      },
    ],
    ...overrides,
  }) as RepairBundle;

const cause = (overrides: Record<string, unknown> = {}) => ({
  caseId: "get-weather-unknown-city",
  summary: "도시 존재 검사가 프로토타입 속성을 통과시킨다",
  location: "get_weather 핸들러의 도시 존재 검사",
  evidence: "city='toString' 입력에 isError:false 와 빈 본문",
  target: "server" as const,
  ...overrides,
});

const discarded = (
  overrides: Partial<{
    unknownCase: number;
    specTarget: number;
    unsureCauses: number;
  }> = {},
) => ({ unknownCase: 0, specTarget: 0, unsureCauses: 0, ...overrides });

const diagnosisResult = (causes: readonly unknown[], omitted = discarded()) => ({
  status: "diagnosis" as const,
  causes,
  discarded: omitted,
});

/**
 * generate 의 진단 통로를 흉내 낸다. 실제 codex·claude 프로세스는 부르지 않는다.
 * prepare 는 요청 조립 결과의 모양만 맞추면 되고, 화면 판정에 필요한 값만 담는다.
 */
function diagnosis(options: {
  result?: unknown;
  dispatchStatus?:
    | "diagnosis"
    | "providerFailed"
    | "invalid"
    | "approvalInvalidated"
    | "resultLimitExceeded";
  stderr?: string;
  omittedFailures?: number;
  sentFailures?: number;
}) {
  const calls = { diagnose: 0, dispatch: 0 };
  const prepare = ((input: Record<string, unknown>) => {
    const failures = (input.failures as readonly unknown[]).slice(
      0,
      options.sentFailures ?? (input.maxCases as number),
    );
    const includeStderr = input.includeStderr !== false;
    return {
      request: {
        specApproved: input.specApproved,
        suite: input.suite,
        failures,
        ...(includeStderr && options.stderr !== undefined
          ? {
              processDiagnostics: {
                stderr: options.stderr,
                stderrTruncated: false,
                exitCode: 1,
                signal: null,
              },
            }
          : {}),
        tools: [],
      },
      byteLength: 18_842,
      providerId: input.providerId,
      model: input.model,
      providerTimeoutMs: 120_000,
      maxResultBytes: 262_144,
      redactionsApplied: true,
      requiresApproval: true,
      fingerprint: "f".repeat(64),
      omitted: { failures: options.omittedFailures ?? 0, stderrBytes: 0 },
      binding: {},
    };
  }) as unknown as NonNullable<RepairCommandDependencies["diagnosis"]>["prepare"];
  const dispatch = (async () => {
    calls.dispatch += 1;
    const status = options.dispatchStatus ?? "diagnosis";
    if (status === "providerFailed")
      return {
        status,
        failure: { providerId: "codex", code: "nonZeroExit", timeoutMs: 1, reason: "unknownModel" },
      };
    if (status !== "diagnosis") return { status };
    return { status, result: options.result };
  }) as unknown as NonNullable<RepairCommandDependencies["diagnosis"]>["dispatch"];
  const makeProvider = (model: string) =>
    ({
      id: "codex" as const,
      model,
      diagnose: async () => {
        calls.diagnose += 1;
        return {};
      },
    }) as never;
  return {
    calls,
    value: { prepare, dispatch, providers: { codex: makeProvider, claude: makeProvider } },
  };
}

function reviewIO(answer: boolean, interactive = true) {
  const written: string[] = [];
  const io: ReviewIO = {
    input: async () => "",
    choose: async () => "",
    confirm: vi.fn(async () => answer),
    write: (text) => written.push(text),
    interactive,
  };
  return { io, written };
}

function deps(options: {
  bundle?: RepairBundle;
  diagnosis: ReturnType<typeof diagnosis>;
  reviewIO?: ReviewIO;
}) {
  const writes = { out: [] as string[], err: [] as string[] };
  const value: RepairCommandDependencies = {
    readFile: async () => JSON.stringify(options.bundle ?? bundle()),
    writeStdout: (text) => writes.out.push(text),
    writeStderr: (text) => writes.err.push(text),
    ...(options.reviewIO === undefined ? {} : { reviewIO: options.reviewIO }),
    diagnosis: options.diagnosis.value,
  };
  return { value, writes };
}

const BOUNDARY_ONE = "※ AI 제안입니다. 파일을 고치지 않았고 명세도 그대로입니다.";
const BOUNDARY_TWO = "※ 명세 쪽이 틀렸다고 판단되면 `mcpeak generate` 로 다시 승인받으세요.";

describe("repair 화면", () => {
  it("확인 화면에서 n 이면 diagnose 가 0회 호출된다", async () => {
    const d = diagnosis({ result: diagnosisResult([cause()]) });
    const io = reviewIO(false);
    const context = deps({ diagnosis: d, reviewIO: io.io });
    expect(await runRepairCommand(ARGV, context.value)).toBe(0);
    expect(d.calls.diagnose).toBe(0);
    expect(d.calls.dispatch).toBe(0);
    expect(io.written.join("")).toContain("repair 요청을 보냅니다.");
    expect(context.writes.out.join("")).toContain("전송하지 않았습니다.");
  });

  it("비대화형 + --yes 없음이면 diagnose 가 0회 호출되고 안내가 뜬다", async () => {
    const d = diagnosis({ result: diagnosisResult([cause()]) });
    const io = reviewIO(true, false);
    const context = deps({ diagnosis: d, reviewIO: io.io });
    expect(await runRepairCommand(ARGV, context.value)).toBe(1);
    expect(d.calls.diagnose).toBe(0);
    expect(d.calls.dispatch).toBe(0);
    expect(context.writes.err.join("")).toContain("`--yes` 를 붙여 다시 실행하세요");
  });

  it("--yes 면 확인 화면 없이 바로 보낸다", async () => {
    const d = diagnosis({ result: diagnosisResult([cause()]) });
    const io = reviewIO(false);
    const context = deps({ diagnosis: d, reviewIO: io.io });
    expect(await runRepairCommand([...ARGV, "--yes"], context.value)).toBe(0);
    expect(io.written).toHaveLength(0);
    expect(io.io.confirm).not.toHaveBeenCalled();
    expect(d.calls.dispatch).toBe(1);
  });

  it("제외된 실패가 0건이면 괄호를 안 찍는다", async () => {
    const none = deps({
      diagnosis: diagnosis({ result: diagnosisResult([cause()]) }),
      reviewIO: reviewIO(false).io,
    });
    await runRepairCommand(ARGV, none.value);
    const some = diagnosis({ result: diagnosisResult([cause()]), omittedFailures: 2 });
    const io = reviewIO(false);
    await runRepairCommand(ARGV, deps({ diagnosis: some, reviewIO: io.io }).value);
    expect(io.written.join("")).toContain("--max-cases");
    expect(io.written.join("")).toContain("2건 제외");
  });

  it('--no-stderr 면 stderr 줄에 "(전송하지 않음)" 이 찍힌다', async () => {
    const withStderr = reviewIO(false);
    await runRepairCommand(
      ARGV,
      deps({
        diagnosis: diagnosis({ result: diagnosisResult([cause()]), stderr: "boom\nboom\n" }),
        reviewIO: withStderr.io,
      }).value,
    );
    expect(withStderr.written.join("")).toContain("2줄");
    const without = reviewIO(false);
    await runRepairCommand(
      [...ARGV, "--no-stderr"],
      deps({
        diagnosis: diagnosis({ result: diagnosisResult([cause()]), stderr: "boom\n" }),
        reviewIO: without.io,
      }).value,
    );
    expect(without.written.join("")).toContain("stderr     (전송하지 않음)");
  });

  it("지문 일치·불일치·없음 셋에서 상단 블록이 각각 다르다", async () => {
    const screens: string[] = [];
    for (const approval of ["matched", "mismatched", "absent"] as const) {
      const context = deps({
        bundle: bundle({ spec: { ...bundle().spec, approval } }),
        diagnosis: diagnosis({ result: diagnosisResult([cause()]) }),
      });
      expect(await runRepairCommand([...ARGV, "--yes"], context.value)).toBe(0);
      screens.push(context.writes.out.join(""));
    }
    expect(new Set(screens).size).toBe(3);
    expect(screens[0]).not.toContain("⚠");
    expect(screens[1]).toContain("승인 상태가 아닙니다 (지문 불일치)");
    expect(screens[2]).toContain("승인 지문이 없습니다");
  });

  it("unsure 에서 shortfall 이 찍히고, 빈 문자열이면 그 줄만 빠진다", async () => {
    const filled = deps({
      diagnosis: diagnosis({
        result: {
          status: "unsure",
          shortfall: "서버 stderr 가 비어 있습니다.",
          discarded: discarded(),
        },
      }),
    });
    expect(await runRepairCommand([...ARGV, "--yes"], filled.value)).toBe(0);
    expect(filled.writes.out.join("")).toContain("  → 서버 stderr 가 비어 있습니다.");
    const empty = deps({
      diagnosis: diagnosis({
        result: { status: "unsure", shortfall: "", discarded: discarded() },
      }),
    });
    expect(await runRepairCommand([...ARGV, "--yes"], empty.value)).toBe(0);
    expect(empty.writes.out.join("")).toContain("판단 근거가 부족해");
    expect(empty.writes.out.join("")).not.toContain("→");
  });

  it("경계 문장 두 줄이 diagnosis·unsure·지문 불일치 모든 경로에서 찍힌다", async () => {
    const cases = [
      deps({ diagnosis: diagnosis({ result: diagnosisResult([cause()]) }) }),
      deps({
        diagnosis: diagnosis({
          result: { status: "unsure", shortfall: "", discarded: discarded() },
        }),
      }),
      deps({
        bundle: bundle({ spec: { ...bundle().spec, approval: "mismatched" } }),
        diagnosis: diagnosis({ result: diagnosisResult([cause({ target: "spec" })]) }),
      }),
    ];
    for (const context of cases) {
      await runRepairCommand([...ARGV, "--yes"], context.value);
      const screen = context.writes.out.join("");
      expect(screen).toContain(BOUNDARY_ONE);
      expect(screen).toContain(BOUNDARY_TWO);
    }
  });

  it("케이스 순서가 번들 순서와 같다", async () => {
    const reversed = [cause({ caseId: "add-negative" }), cause()];
    const context = deps({ diagnosis: diagnosis({ result: diagnosisResult(reversed) }) });
    await runRepairCommand([...ARGV, "--yes"], context.value);
    const screen = context.writes.out.join("");
    expect(screen.indexOf("get-weather-unknown-city")).toBeLessThan(screen.indexOf("add-negative"));
  });

  it("location 이 빈 문자열이면 그 줄만 빠진다", async () => {
    const context = deps({
      diagnosis: diagnosis({ result: diagnosisResult([cause({ location: "", evidence: "" })]) }),
    });
    await runRepairCommand([...ARGV, "--yes"], context.value);
    const screen = context.writes.out.join("");
    expect(screen).toContain("원인 후보");
    expect(screen).not.toContain("확인할 곳");
    expect(screen).not.toContain("근거");
  });

  it("남은 제안이 있으면 제외 사유별 안내가 찍힌다", async () => {
    const context = deps({
      diagnosis: diagnosis({
        result: diagnosisResult([cause()], discarded({ unknownCase: 1, specTarget: 2 })),
      }),
    });
    await runRepairCommand([...ARGV, "--yes"], context.value);
    const screen = context.writes.out.join("");
    expect(screen).toContain("※ 요청에 없는 케이스를 가리킨 제안 1건이 검증에서 제외됐습니다.");
    expect(screen).toContain("※ 승인된 명세를 고치라는 제안 2건이 검증에서 제외됐습니다.");
  });

  it("남은 제안과 specTarget이 함께 있으면 명세 재승인만 안내한다", async () => {
    const context = deps({
      diagnosis: diagnosis({
        result: diagnosisResult([cause()], discarded({ specTarget: 1 })),
      }),
    });
    await runRepairCommand([...ARGV, "--yes"], context.value);
    const screen = context.writes.out.join("");
    expect(screen).toContain("`mcpeak generate` 로 다시 승인받으세요");
    expect(screen).not.toContain("같은 번들로 한 번 더 물어보세요");
  });

  it("남은 제안과 unknownCase가 함께 있으면 재시도만 안내한다", async () => {
    const context = deps({
      diagnosis: diagnosis({
        result: diagnosisResult([cause()], discarded({ unknownCase: 1 })),
      }),
    });
    await runRepairCommand([...ARGV, "--yes"], context.value);
    const screen = context.writes.out.join("");
    expect(screen).toContain("같은 번들로 한 번 더 물어보세요");
    expect(screen).not.toContain("명세가 실제로 틀렸다고 보시면");
  });

  it("폐기된 제안이 없는 unsure 는 근거 부족 문안을 쓴다", async () => {
    const context = deps({
      diagnosis: diagnosis({
        result: { status: "unsure", shortfall: "", discarded: discarded() },
      }),
    });
    expect(await runRepairCommand([...ARGV, "--yes"], context.value)).toBe(0);
    expect(context.writes.out.join("")).toContain(
      "판단 근거가 부족해 원인 후보를 제시하지 못했습니다.",
    );
  });

  it("전부 폐기된 unsure 는 사유별 개수와 관련 행동만 안내한다", async () => {
    const context = deps({
      diagnosis: diagnosis({
        result: {
          status: "unsure",
          shortfall: "",
          discarded: discarded({ unknownCase: 2 }),
        },
      }),
    });
    expect(await runRepairCommand([...ARGV, "--yes"], context.value)).toBe(0);
    const screen = context.writes.out.join("");
    expect(screen).not.toContain("판단 근거가 부족해");
    expect(screen).toContain("AI 가 원인 후보 2건을 냈지만 전부 검증에서 제외했습니다.");
    expect(screen).toContain("답을 그대로 쓸 수 없어서입니다");
    expect(screen).toContain("제외 사유  요청에 없는 케이스를 가리킨 제안 2건");
    expect(screen).toContain("같은 번들로 한 번 더 물어보세요");
    expect(screen).not.toContain("명세가 실제로 틀렸다고 보시면");
    // 개수와 사유를 위에서 이미 말했다. 같은 수를 두 번 찍지 않는다.
    expect(screen).not.toContain("※ 요청에 없는 케이스");
  });

  it("전부 폐기된 unsure 에서도 경계 두 줄이 찍힌다", async () => {
    const context = deps({
      diagnosis: diagnosis({
        result: {
          status: "unsure",
          shortfall: "",
          discarded: discarded({ specTarget: 1 }),
        },
      }),
    });
    await runRepairCommand([...ARGV, "--yes"], context.value);
    const screen = context.writes.out.join("");
    expect(screen).toContain(BOUNDARY_ONE);
    expect(screen).toContain(BOUNDARY_TWO);
  });

  it("여러 사유로 전부 폐기되면 각 사유와 다음 행동을 구분한다", async () => {
    const context = deps({
      diagnosis: diagnosis({
        result: {
          status: "unsure",
          shortfall: "",
          discarded: discarded({ unknownCase: 1, specTarget: 2 }),
        },
      }),
    });
    await runRepairCommand([...ARGV, "--yes"], context.value);
    const screen = context.writes.out.join("");
    expect(screen).toContain("`mcpeak generate` 로 다시 승인받으세요");
    expect(screen).toContain("같은 번들로 한 번 더 물어보세요");
    expect(screen).toContain("요청에 없는 케이스를 가리킨 제안 1건");
    expect(screen).toContain("승인된 명세를 고치라는 제안 2건");
    expect(screen).not.toContain("구분해 두지 않아");
  });

  it("unsure 와 함께 온 원인 후보도 별도 사유로 안내한다", async () => {
    const context = deps({
      diagnosis: diagnosis({
        result: {
          status: "unsure",
          shortfall: "판단할 수 없습니다.",
          discarded: discarded({ unsureCauses: 2 }),
        },
      }),
    });
    await runRepairCommand([...ARGV, "--yes"], context.value);
    const screen = context.writes.out.join("");
    expect(screen).toContain("판단 불가 응답에 함께 온 원인 후보 2건");
    expect(screen).toContain("같은 번들로 한 번 더 물어보세요");
  });

  it("AI 출력의 제어 문자가 이스케이프된다", async () => {
    const context = deps({
      diagnosis: diagnosis({
        result: diagnosisResult([cause({ summary: "[31m빨강[0m" })]),
      }),
    });
    await runRepairCommand([...ARGV, "--yes"], context.value);
    const screen = context.writes.out.join("");
    expect(screen).not.toContain("");
    expect(screen).toContain("\\u001b[31m빨강");
  });

  it("종료 코드가 diagnosis·unsure 모두 0 이다", async () => {
    const diagnosisRun = deps({ diagnosis: diagnosis({ result: diagnosisResult([cause()]) }) });
    expect(await runRepairCommand([...ARGV, "--yes"], diagnosisRun.value)).toBe(0);
    const unsureRun = deps({
      diagnosis: diagnosis({
        result: { status: "unsure", shortfall: "근거 부족", discarded: discarded() },
      }),
    });
    expect(await runRepairCommand([...ARGV, "--yes"], unsureRun.value)).toBe(0);
  });

  it("provider 실패면 종료 코드가 1 이고 안내가 뜬다", async () => {
    const context = deps({ diagnosis: diagnosis({ dispatchStatus: "providerFailed" }) });
    expect(await runRepairCommand([...ARGV, "--yes"], context.value)).toBe(1);
    const error = context.writes.err.join("");
    expect(error).toContain("REPAIR_PROVIDER_FAILED");
    expect(error).toContain("파일은 하나도 바뀌지 않았습니다");
    expect(context.writes.out.join("")).toBe("");
  });

  it("응답이 상한을 넘으면 종료 코드가 1 이고 형식 오류와 다른 안내가 뜬다", async () => {
    const context = deps({ diagnosis: diagnosis({ dispatchStatus: "resultLimitExceeded" }) });
    expect(await runRepairCommand([...ARGV, "--yes"], context.value)).toBe(1);
    const error = context.writes.err.join("");
    expect(error).toContain("REPAIR_RESULT_LIMIT_EXCEEDED");
    // 형식이 틀린 것이 아니므로 "다른 모델로 시도하세요" 라고 말하면 안 된다.
    expect(error).toContain("--max-cases");
    expect(error).not.toContain("REPAIR_RESULT_INVALID");
    expect(error).toContain("파일은 하나도 바뀌지 않았습니다");
    expect(context.writes.out.join("")).toBe("");
  });

  it('승인 상태에서 target: "spec" 항목에만 분류 라벨이 붙는다', async () => {
    const mismatched = deps({
      bundle: bundle({ spec: { ...bundle().spec, approval: "mismatched" } }),
      diagnosis: diagnosis({ result: diagnosisResult([cause({ target: "spec" })]) }),
    });
    await runRepairCommand([...ARGV, "--yes"], mismatched.value);
    expect(mismatched.writes.out.join("")).toContain("분류       명세 쪽 원인으로 봄");
    const matched = deps({
      diagnosis: diagnosis({ result: diagnosisResult([cause({ target: "server" })]) }),
    });
    await runRepairCommand([...ARGV, "--yes"], matched.value);
    expect(matched.writes.out.join("")).not.toContain("분류");
  });
});
