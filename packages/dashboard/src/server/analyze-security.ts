import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AuditReport } from "@mcpeak/audit";
import {
  type AuditCommandDependencies,
  nodeAuditDependencies,
  runAuditCommand,
} from "@mcpeak/cli/commands";
import type { AnalyzeSecurityRequest, AnalyzeSecurityResponse } from "../api-types.js";
import { resolveProjectPath } from "./paths.js";

/**
 * 보안 점검 실행기. `mcpeak audit --json` 의 커맨드 함수(`runAuditCommand`)를 그대로 돌리고 stdout
 * 바이트를 메모리로 받는다(ADR-0046, ADR-0110). 규칙·정렬·종료 코드를 여기서 다시 쓰지 않는다.
 * 화면에 나오는 위치 문장과 격리 상태 문장도 `@mcpeak/audit` 가 만든 글자다.
 *
 * 테스트가 실제 서버에 붙지 않고 fake 를 끼울 수 있도록 커맨드 함수와 동적 import 로더를
 * `overrides` 로 바꿔치기할 수 있게 연다. `analyze.ts` 의 `AnalyzeTokensOverrides` 와 같은 꼴이다.
 */
export interface SecurityModuleLoaders {
  readonly loadCore: () => Promise<typeof import("@mcpeak/core")>;
  readonly loadAudit: () => Promise<typeof import("@mcpeak/audit")>;
}

export interface AnalyzeSecurityOverrides {
  /** 기본값은 `@mcpeak/cli/commands` 의 `runAuditCommand`. 테스트가 fake 로 바꾼다. */
  readonly runner?: typeof runAuditCommand;
  readonly loaders?: Partial<SecurityModuleLoaders>;
  /** `routes.ts` 가 `resolveCandidateEnv` 로 만든 후보 env. `analyze.ts` 의 같은 필드와 같은 뜻. */
  readonly candidateEnv?: Readonly<Record<string, string>>;
}

export type PrepareSecurityOutcome =
  | { readonly ok: true; readonly argv: readonly string[] }
  | { readonly ok: false; readonly error: string };

export type AnalyzeSecurityOutcome =
  | { readonly ok: true; readonly body: AnalyzeSecurityResponse }
  | { readonly ok: false; readonly error: string };

const defaultLoaders: SecurityModuleLoaders = {
  loadCore: () => import("@mcpeak/core"),
  loadAudit: () => import("@mcpeak/audit"),
};

/** CLI `audit-command.ts` 의 같은 이름과 같은 목록. 대상 옵션 중 값을 다음 토큰으로 받는 것이다. */
const TARGET_VALUE_OPTIONS = new Set(["--command", "--arg", "--env", "--url", "--header-env"]);

const RUNTIME_UNAVAILABLE =
  "오류 [ANALYZE_RUNTIME_UNAVAILABLE]: 점검에 필요한 @mcpeak/core·@mcpeak/audit 를 로드하지 못했습니다.\n해결: 의존성을 설치한 뒤 다시 실행하세요.";

function usage(token: string): string {
  return `오류 [ANALYZE_USAGE]: argv 에는 대상 옵션(--command, --arg, --env, --url, --header-env)과 그 값만 실을 수 있습니다: '${token}'\n해결: 점검 옵션은 요청의 probe·baselinePath·updateBaseline·sandbox 필드로 보내세요.`;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** 던져진 값의 첫 줄. 스택이나 여러 줄 메시지를 문장 가운데에 싣지 않는다. */
function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0] ?? "";
}

/** 요청을 가두고 CLI argv 로 조립한다. 서버에 붙지 않는다. */
export async function prepareSecurityRun(
  root: string,
  request: AnalyzeSecurityRequest,
  overrides: Pick<AnalyzeSecurityOverrides, "loaders"> = {},
): Promise<PrepareSecurityOutcome> {
  const loaders: SecurityModuleLoaders = { ...defaultLoaders, ...overrides.loaders };

  // 1. argv 는 (대상 옵션, 값) 쌍의 나열이어야 한다. 값은 `--` 로 시작해도 값이다(`--arg --port`).
  //    쌍이 아닌 토큰을 통과시키면 `--baseline`·`--json`·`--sandbox-mount` 가 가드 없이 CLI 에 닿는다.
  for (let index = 0; index < request.argv.length; index += 2) {
    const token = request.argv[index] as string;
    if (!TARGET_VALUE_OPTIONS.has(token) || index + 1 >= request.argv.length)
      return { ok: false, error: usage(token) };
  }

  // 2. 기준 파일 경로를 가둔다.
  const baselinePath = request.baselinePath;
  if (baselinePath !== undefined) {
    const absolute = resolveProjectPath(root, baselinePath);
    if (absolute === null) return { ok: false, error: "허용되지 않는 경로입니다." };
    if (!baselinePath.endsWith(".json"))
      return { ok: false, error: "기준 파일은 .json 확장자 파일만 쓸 수 있습니다." };
    // 갱신은 한 번의 클릭이다. 이전에 mcpeak audit 가 만든 기준 파일이 아니면 덮어쓰지 않는다.
    if (request.updateBaseline === true) {
      let text: string | undefined;
      try {
        text = await readFile(absolute, "utf8");
      } catch (error) {
        if (!isMissing(error))
          return { ok: false, error: `기준 파일을 읽지 못했습니다: ${baselinePath}` };
      }
      if (text !== undefined) {
        let audit: typeof import("@mcpeak/audit");
        try {
          audit = await loaders.loadAudit();
        } catch {
          return { ok: false, error: RUNTIME_UNAVAILABLE };
        }
        try {
          audit.parseBaseline(text);
        } catch {
          return {
            ok: false,
            error: `기준 파일이 아닌 파일은 덮어쓰지 않습니다: ${baselinePath}\n→ 기준 파일 갱신은 이전에 mcpeak audit 가 만든 기준 파일만 바꿉니다. 다른 경로를 쓰세요.`,
          };
        }
      }
    }
  }

  // 3. 조립. 순서를 고정한다. 같은 요청이면 항상 같은 배열이다.
  //    `--baseline` 값은 상대경로 그대로다. 절대경로로 바꾸면 리포트 문장이 머신마다 달라진다.
  const argv: string[] = [];
  if (request.probe !== undefined) argv.push("--probe", request.probe);
  if (baselinePath !== undefined) argv.push("--baseline", baselinePath);
  if (request.updateBaseline === true) argv.push("--update-baseline");
  if (request.sandbox !== undefined) {
    argv.push("--sandbox");
    if (request.sandbox.compareHost) argv.push("--compare-host");
    for (const host of request.sandbox.allowHosts) argv.push("--allow-host", host);
  }
  argv.push("--json", ...request.argv);
  return { ok: true, argv };
}

/** 점검을 끝까지 돌린다. 던지지 않는다. `exitCode` 는 run 의 종료 코드가 된다. */
export async function analyzeSecurity(
  argv: readonly string[],
  io: { readonly writeStderr: (text: string) => void },
  context: { readonly root: string },
  overrides: AnalyzeSecurityOverrides = {},
): Promise<{ readonly exitCode: number; readonly outcome: AnalyzeSecurityOutcome }> {
  const runner = overrides.runner ?? runAuditCommand;
  const loaders: SecurityModuleLoaders = { ...defaultLoaders, ...overrides.loaders };
  const fail = (error: string) => {
    io.writeStderr(`${error}\n`);
    return { exitCode: 1, outcome: { ok: false as const, error } };
  };

  let core: typeof import("@mcpeak/core");
  let audit: typeof import("@mcpeak/audit");
  try {
    [core, audit] = await Promise.all([loaders.loadCore(), loaders.loadAudit()]);
  } catch {
    return fail(RUNTIME_UNAVAILABLE);
  }

  // CLI 의 조립을 그대로 쓰고 다섯 자리만 바꾼다.
  const base = nodeAuditDependencies(core, audit);
  let stdout = "";
  let stderrBefore = ""; // 리포트가 나오기 전의 stderr: 진행 문장과 실패 문장
  let stderrAfter = ""; // 리포트가 나온 뒤의 stderr: 격리 자원 정리 실패 문장
  const deps: AuditCommandDependencies = {
    ...base,
    readEnv: (name) => overrides.candidateEnv?.[name] ?? process.env[name],
    // 기준 파일은 상대경로로 온다. 대시보드 루트 기준으로 푼다. 절대경로(격리의 선언 출처)는 그대로다.
    readFile: (path) => readFile(resolve(context.root, path), "utf8"),
    writeFile: (path, text) => writeFile(resolve(context.root, path), text, "utf8"),
    writeStdout: (text) => {
      stdout += text;
    },
    writeStderr: (text) => {
      if (stdout === "") stderrBefore += text;
      else stderrAfter += text;
      io.writeStderr(text);
    },
    // 서버 인자의 상대 경로와 마운트 범위는 대시보드 루트를 기준으로 푼다. process.cwd() 가 아니다.
    // 서버 프로세스의 cwd 는 바꾸지 않는다. 동시에 도는 다른 run 이 깨진다.
    sandbox: { ...base.sandbox, cwd: context.root },
  };

  let exitCode: number;
  try {
    exitCode = await runner(argv, deps);
  } catch (error) {
    return fail(
      `오류 [ANALYZE_FAILED]: 점검이 예기치 않게 끝났습니다: ${firstLine(error)}\n해결: 같은 서버에 mcpeak audit 를 터미널에서 직접 돌려 같은 오류가 나는지 확인하세요.`,
    );
  }
  // 리포트 없이 끝났다(연결 실패, 사용법 오류). CLI 가 stderr 에 쓴 문장이 곧 결과다.
  if (stdout === "") {
    return { exitCode, outcome: { ok: false, error: stderrBefore.replace(/\n+$/, "") } };
  }

  let report: AuditReport;
  try {
    report = JSON.parse(stdout) as AuditReport;
  } catch (error) {
    return fail(
      `오류 [ANALYZE_FAILED]: 점검 결과를 읽지 못했습니다: ${firstLine(error)}\n해결: 같은 서버에 mcpeak audit --json 을 터미널에서 직접 돌려 출력이 JSON 인지 확인하세요.`,
    );
  }
  const rendered = audit.renderReport(report);
  // renderReport 는 "\n" 으로 끝난다. 끝 개행을 떼고 줄로 나눈다.
  const lines = rendered.replace(/\n$/, "").split("\n");
  return {
    exitCode,
    outcome: {
      ok: true,
      body: {
        report,
        reportText: stdout,
        rendered,
        views: report.findings.map((finding) => ({
          where: audit.describeLocation(finding.location),
          tool:
            "toolName" in finding.location
              ? audit.escapeInvisible(finding.location.toolName)
              : null,
          toolIndex: "toolIndex" in finding.location ? finding.location.toolIndex : -1,
        })),
        // 첫 줄은 제목이고, sandbox 가 있으면 둘째 줄이 그 상태다(report.ts renderReport).
        sandboxLine: report.sandbox === undefined ? null : (lines[1] ?? null),
        limits: lines.slice(lines.lastIndexOf("") + 1),
        exitCode,
        cleanupError: stderrAfter.replace(/\n+$/, ""),
      },
    },
  };
}
