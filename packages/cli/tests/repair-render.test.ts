import { describe, expect, it, vi } from "vitest";
import type { ReviewIO } from "../src/generate-command.js";
import { REPAIR_BUNDLE_VERSION, type RepairBundle } from "../src/repair-bundle.js";
import { type RepairCommandDependencies, runRepairCommand } from "../src/repair-command.js";
import { renderRepairProviderFailure } from "../src/repair-render.js";

const ARGV = ["bundle.json", "--provider", "codex", "--model", "gpt-5-codex"];

const bundle = (overrides: Partial<RepairBundle> = {}): RepairBundle =>
  ({
    // 상수로 쓴다. 버전을 올릴 때마다 이 픽스처가 깨질 이유가 없다. 버전 자체를 확인하는
    // 테스트는 repair-bundle-read.test.ts 가 숫자로 본다.
    bundleVersion: REPAIR_BUNDLE_VERSION,
    generatedBy: "mcpeak 0.7.0",
    spec: {
      suiteId: "weather",
      suiteName: "날씨 서버 계약",
      approval: "matched",
      runHistory: "present",
      fingerprint: "a".repeat(64),
    },
    failures: [
      {
        caseId: "get-weather-unknown-city",
        caseName: "없는 도시는 거절한다",
        status: "failed",
        tool: "get_weather",
        input: { city: "toString" },
        assertions: [{ type: "isError", status: "failed" }],
        diagnostics: [{ code: "IS_ERROR_MISMATCH", message: "isError 가 다릅니다." }],
      },
      {
        caseId: "add-negative",
        caseName: "음수를 더한다",
        status: "failed",
        tool: "add",
        input: { a: -1, b: 2 },
        assertions: [{ type: "bodyMatchesSchema", status: "failed" }],
        diagnostics: [{ code: "BODY_SCHEMA_MISMATCH", message: "본문이 다릅니다." }],
      },
    ],
    tools: [
      { name: "add", inputSchema: { type: "object" } },
      { name: "get_weather", inputSchema: { type: "object" } },
    ],
    target: { transport: "stdio" },
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
  /** prepare 가 크기 상한에서 던지는 상황. 진짜 RangeError 를 던진다(#393). */
  throwsTooLarge?: boolean;
}) {
  const calls = { diagnose: 0, dispatch: 0 };
  /** prepare 가 실제로 받은 입력. 번들이 도구를 넘겼는지 여기서 본다. */
  const prepared: Record<string, unknown>[] = [];
  const prepare = ((input: Record<string, unknown>) => {
    prepared.push(input);
    if (options.throwsTooLarge === true) throw new RangeError("request byte limit을 초과했습니다.");
    const failures = (input.failures as readonly unknown[]).slice(
      0,
      options.sentFailures ?? (input.maxCases as number),
    );
    const includeStderr = input.includeStderr !== false;
    return {
      request: {
        specTrust: input.specTrust,
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
    prepared,
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

  it("전송 확인 화면이 지문 상태와 실행 기록을 함께 적는다", async () => {
    // 확인 화면은 `--yes` 가 없을 때만 나온다. 비대화형이면 stdout 으로 찍고 멈춘다.
    const present = deps({ diagnosis: diagnosis({ result: diagnosisResult([cause()]) }) });
    await runRepairCommand(ARGV, present.value);
    expect(present.writes.out.join("")).toContain("명세 상태  승인 지문 일치 · 실행 기록 있음");
    const absent = deps({
      bundle: bundle({ spec: { ...bundle().spec, runHistory: "absent" } }),
      diagnosis: diagnosis({ result: diagnosisResult([cause()]) }),
    });
    await runRepairCommand(ARGV, absent.value);
    expect(absent.writes.out.join("")).toContain("명세 상태  승인 지문 일치 · 실행 기록 없음");
  });

  it("지문이 맞고 실행 기록이 없으면 경고 블록이 붙는다", async () => {
    const context = deps({
      bundle: bundle({ spec: { ...bundle().spec, runHistory: "absent" } }),
      diagnosis: diagnosis({ result: diagnosisResult([cause()]) }),
    });
    expect(await runRepairCommand([...ARGV, "--yes"], context.value)).toBe(0);
    const screen = context.writes.out.join("");
    expect(screen).toContain("⚠ 이 명세는 승인 지문이 일치하지만 실제 서버 실행 기록이 없습니다.");
    expect(screen).toContain(
      "  --baseline-only 나 --no-dry-run 으로 저장하면 케이스가 한 번도 실행되지 않은 채 승인됩니다.",
    );
    expect(screen).toContain(
      "  입력값이 생성 시점의 자리값일 수 있어, 아래 제안은 명세 쪽 원인도 함께 받았습니다.",
    );
  });

  it("실행 기록이 없으면 spec 항목에 분류 라벨이 붙는다", async () => {
    const context = deps({
      bundle: bundle({ spec: { ...bundle().spec, runHistory: "absent" } }),
      diagnosis: diagnosis({ result: diagnosisResult([cause({ target: "spec" })]) }),
    });
    await runRepairCommand([...ARGV, "--yes"], context.value);
    expect(context.writes.out.join("")).toContain("분류       명세 쪽 원인으로 봄");
  });

  it("네 경로의 화면이 서로 다르고 오라클 경로에만 경고가 없다", async () => {
    const paths = [
      { approval: "matched", runHistory: "present" },
      { approval: "matched", runHistory: "absent" },
      { approval: "mismatched", runHistory: "present" },
      { approval: "absent", runHistory: "absent" },
    ] as const;
    const screens: string[] = [];
    for (const path of paths) {
      const context = deps({
        bundle: bundle({ spec: { ...bundle().spec, ...path } }),
        diagnosis: diagnosis({ result: diagnosisResult([cause()]) }),
      });
      expect(await runRepairCommand([...ARGV, "--yes"], context.value)).toBe(0);
      screens.push(context.writes.out.join(""));
    }
    expect(new Set(screens).size).toBe(4);
    expect(screens[0]).not.toContain("⚠");
    expect(screens[1]).toContain("실제 서버 실행 기록이 없습니다");
    expect(screens[2]).toContain("승인 상태가 아닙니다 (지문 불일치)");
    expect(screens[3]).toContain("승인 지문이 없습니다");
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

describe("provider 실패 안내 (#285)", () => {
  it("unknownOption 이면 설치·인증을 확인하라고 하지 않는다", async () => {
    // 옵션 해석에서 죽은 것은 설치·인증 문제가 아니다. 같은 문장을 쓰면 안내를 따라가도
    // 원인에 닿지 못한다.
    const text = renderRepairProviderFailure({
      providerId: "claude",
      code: "nonZeroExit",
      reason: "unknownOption",
      option: "--safe-mode",
    });
    expect(text).toContain("REPAIR_PROVIDER_OPTION");
    expect(text).toContain("옵션: --safe-mode");
    expect(text).not.toContain("설치와 인증을 확인");
    // 파일 불변 약속은 어느 갈래에서도 유지한다.
    expect(text).toContain("파일은 하나도 바뀌지 않았습니다");
  });

  it("옵션 이름이 없으면 라벨째 뺀다", async () => {
    const text = renderRepairProviderFailure({
      providerId: "codex",
      code: "nonZeroExit",
      reason: "unknownOption",
    });
    expect(text).toContain("REPAIR_PROVIDER_OPTION");
    expect(text).not.toContain("옵션:");
  });

  it("다른 사유의 문장은 그대로다", async () => {
    const text = renderRepairProviderFailure({
      providerId: "codex",
      code: "nonZeroExit",
      reason: "rateLimited",
    });
    expect(text).toContain("REPAIR_PROVIDER_FAILED");
    expect(text).toContain("설치와 인증을 확인");
  });
});

describe("repair 가 tools 를 넘긴다", () => {
  it("진단 요청의 tools 가 비어 있지 않다", async () => {
    // 이 이슈의 원래 증상이다. 전에는 `tools: []` 가 코드에 박혀 있었다(#393).
    const diag = diagnosis({ result: diagnosisResult([cause()]) });
    const d = deps({ diagnosis: diag });
    expect(await runRepairCommand([...ARGV, "--yes"], d.value)).toBe(0);
    const sent = (diag.prepared[0] as Record<string, unknown>).tools as readonly { name: string }[];
    expect(sent.map((tool) => tool.name)).toEqual(["add", "get_weather"]);
  });

  it("outputSchema 와 description 이 있으면 함께 넘어간다", () => {
    const diag = diagnosis({ result: diagnosisResult([cause()]) });
    const withOutput = bundle({
      tools: [
        {
          name: "get_weather",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          description: "날씨",
        },
      ],
    } as Partial<RepairBundle>);
    return runRepairCommand(
      [...ARGV, "--yes"],
      deps({ bundle: withOutput, diagnosis: diag }).value,
    ).then(() => {
      const first = diag.prepared[0] as Record<string, unknown>;
      const sent = (first.tools as readonly Record<string, unknown>[])[0];
      expect(sent?.outputSchema).toEqual({ type: "object" });
      expect(sent?.description).toBe("날씨");
    });
  });

  it("도구에 outputSchema 가 없으면 키를 안 만든다", async () => {
    const diag = diagnosis({ result: diagnosisResult([cause()]) });
    await runRepairCommand([...ARGV, "--yes"], deps({ diagnosis: diag }).value);
    const first = diag.prepared[0] as Record<string, unknown>;
    const sent = (first.tools as readonly Record<string, unknown>[])[0] as object;
    expect("outputSchema" in sent).toBe(false);
  });
});

describe("process.scope", () => {
  it("process 가 있으면 scope 가 그대로 넘어간다", async () => {
    const diag = diagnosis({ result: diagnosisResult([cause()]), stderr: "boom" });
    const withProcess = bundle({
      process: {
        scope: "suite",
        stderr: "boom",
        stderrTruncated: false,
        exitCode: 1,
        signal: null,
      },
    } as Partial<RepairBundle>);
    await runRepairCommand(
      [...ARGV, "--yes"],
      deps({ bundle: withProcess, diagnosis: diag }).value,
    );
    const first = diag.prepared[0] as Record<string, unknown>;
    expect((first.processDiagnostics as { scope: string }).scope).toBe("suite");
  });

  it("process 가 없으면 그 키도 없다", async () => {
    const diag = diagnosis({ result: diagnosisResult([cause()]) });
    await runRepairCommand([...ARGV, "--yes"], deps({ diagnosis: diag }).value);
    expect("processDiagnostics" in (diag.prepared[0] as object)).toBe(false);
  });
});

describe("요청 크기 상한", () => {
  it("도구가 많아 상한을 넘으면 REPAIR_REQUEST_TOO_LARGE 로 끝낸다", async () => {
    // RangeError 가 스택 트레이스로 새면 사용자가 할 수 있는 일이 없다. 번들을 다시 만들
    // 수도 없다. 그 안에 이미 도구가 들어 있기 때문이다.
    const diag = diagnosis({ throwsTooLarge: true });
    const d = deps({ diagnosis: diag });
    expect(await runRepairCommand([...ARGV, "--yes"], d.value)).toBe(1);
    const err = d.writes.err.join("");
    expect(err).toContain("REPAIR_REQUEST_TOO_LARGE");
    expect(err).toContain("--max-cases");
    expect(err).not.toContain("at ");
    // provider 는 한 번도 안 불렀다.
    expect(diag.calls.dispatch).toBe(0);
  });

  it("상한 안이면 종전대로 돈다", async () => {
    const diag = diagnosis({ result: diagnosisResult([cause()]) });
    expect(await runRepairCommand([...ARGV, "--yes"], deps({ diagnosis: diag }).value)).toBe(0);
    expect(diag.calls.dispatch).toBe(1);
  });
});

describe("확인 화면이 보내는 도구 수를 적는다", () => {
  const screenOf = async (target?: RepairBundle) => {
    const io = reviewIO(false);
    const d = deps({
      diagnosis: diagnosis({ result: diagnosisResult([cause()]) }),
      reviewIO: io.io,
      ...(target === undefined ? {} : { bundle: target }),
    });
    await runRepairCommand(ARGV, d.value);
    return io.written.join("");
  };

  it("도구 수를 한 줄로 적는다", async () => {
    // 전송 내용이 늘었는데 화면이 그대로면 사용자는 무엇을 승인하는지 모른다(#393).
    expect(await screenOf()).toContain("  도구       2개\n");
  });

  it("스키마를 뺀 도구가 있으면 그 수도 적는다", async () => {
    const trimmed = bundle({
      tools: [
        { name: "add", inputSchema: {}, schemasOmitted: true },
        { name: "get_weather", inputSchema: { type: "object" } },
      ],
    } as Partial<RepairBundle>);
    expect(await screenOf(trimmed)).toContain("  도구       2개 (스키마 제외 1개)\n");
  });

  it("제외가 0 이면 괄호를 안 찍는다", async () => {
    // 위 scope 줄과 같은 방식이다.
    expect(await screenOf()).not.toContain("스키마 제외");
  });

  it("도구가 없으면 0개로 적는다", async () => {
    // listTools 케이스만 실패한 번들이다. 조용히 줄을 빼면 "도구가 나갔나" 를 알 수 없다.
    const none = bundle({ tools: [] } as Partial<RepairBundle>);
    expect(await screenOf(none)).toContain("  도구       0개\n");
  });
});
