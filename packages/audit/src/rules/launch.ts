import type { AuditBaseline, AuditTarget, Finding, RuleInfo } from "../types.js";

export const LAUNCH_RULES: readonly RuleInfo[] = [
  {
    id: "launch/inline-code",
    family: "launch",
    defaultSeverity: "high",
    summary: "실행 명령이 인터프리터·셸에 코드를 인라인으로 넘기는지 본다.",
  },
  {
    id: "launch/pipe-to-shell",
    family: "launch",
    defaultSeverity: "high",
    summary: "원격 스크립트를 받아 셸로 바로 넘기는지 본다.",
  },
  {
    id: "launch/unpinned-package",
    family: "launch",
    defaultSeverity: "medium",
    summary: "npx·uvx 류로 띄우는 패키지의 버전이 고정됐는지 본다.",
  },
  {
    id: "launch/remote-source",
    family: "launch",
    defaultSeverity: "high",
    summary: "패키지 관리자가 레지스트리가 아닌 원격 주소에서 코드를 받는지 본다.",
  },
  {
    id: "launch/env-passthrough",
    family: "launch",
    defaultSeverity: "info",
    summary: "비밀처럼 보이는 환경변수의 실제 값을 서버에 넘기는지 알린다.",
  },
] as const;

const INTERPRETERS = new Set(["node", "bun", "deno", "python", "python3", "ruby", "perl", "php"]);
/**
 * §3.5 의 목록에서 `-r` 을 뺐다. `-r` 은 모듈 프리로드(`node -r dotenv/config`)라 코드 인라인이 아니고,
 * 흔한 정상 실행을 오탐한다(오케스트레이터 결정, 2026-10-03).
 */
const INTERPRETER_FLAGS = new Set(["-e", "--eval", "-c", "--input-type=module"]);
const SHELLS = new Set(["sh", "bash", "zsh", "fish", "cmd", "cmd.exe", "powershell", "pwsh"]);
/** `-c` 는 대소문자를 구분한다(`bash -C` 는 noclobber). 나머지는 Windows 관례라 구분하지 않는다. */
const SHELL_FLAGS_EXACT = new Set(["-c"]);
const SHELL_FLAGS_FOLDED = new Set(["/c", "-command", "-encodedcommand"]);

const NPM_RUNNERS = new Set(["npx", "pnpx", "bunx"]);
const PYPI_RUNNERS = new Set(["uvx", "pipx"]);
const REMOTE_FETCHERS = new Set(["npx", "pnpx", "bunx", "uvx", "pipx", "pip", "npm", "git"]);

const PIPE_TO_SHELL =
  /\b(curl|wget|iwr|Invoke-WebRequest)\b[^|]*\|\s*(sh|bash|zsh|python3?|node|pwsh|powershell)\b/;
const REMOTE_URL = /^(https?|git|git\+https?|ssh):\/\//;
const SECRET_NAME = /(TOKEN|SECRET|KEY|PASSWORD|PASSWD|CREDENTIAL|AUTH)/i;

const EVIDENCE_LIMIT = 80;

function clip(text: string): string {
  return text.length > EVIDENCE_LIMIT ? `${text.slice(0, EVIDENCE_LIMIT)}…` : text;
}

/** 경로 구분자는 `/`·`\` 둘 다 본다. 비교는 소문자, `cmd.exe` 외의 `.exe` 는 떼어 `node.exe` 도 `node` 로 본다. */
function basename(command: string): string {
  const last = command.split(/[\\/]/).pop() ?? "";
  const lower = last.toLowerCase();
  if (lower === "cmd.exe") return lower;
  return lower.endsWith(".exe") ? lower.slice(0, -4) : lower;
}

interface PackageArg {
  readonly index: number;
  readonly spec: string;
}

/**
 * 패키지 실행기의 패키지 인자. 첫 비옵션 인자다. `pipx run <pkg>` 의 `run` 은 하위 명령이라 건너뛴다.
 * 원격 주소와 로컬 경로는 레지스트리 패키지가 아니라 돌려주지 않는다(remote-source 가 따로 본다).
 */
function packageArg(base: string, args: readonly string[]): PackageArg | undefined {
  let skippedSubcommand = base !== "pipx";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg.startsWith("-")) continue;
    if (!skippedSubcommand) {
      skippedSubcommand = true;
      if (arg === "run") continue;
    }
    if (REMOTE_URL.test(arg) || /^(\.{1,2}\/|\/|file:)/.test(arg)) return undefined;
    return { index, spec: arg };
  }
  return undefined;
}

interface ParsedPackage {
  readonly manager: "npm" | "pypi";
  readonly name: string;
  readonly version?: string;
}

function parseNpmSpec(spec: string): ParsedPackage {
  // 스코프 패키지의 첫 '@' 는 이름의 일부다. 버전 구분자는 그 뒤의 '@' 다.
  const at = spec.indexOf("@", spec.startsWith("@") ? 1 : 0);
  if (at < 0) return { manager: "npm", name: spec };
  return { manager: "npm", name: spec.slice(0, at), version: spec.slice(at + 1) };
}

function parsePypiSpec(spec: string): ParsedPackage {
  const pinned = /^([^=@]+?)(?:==|@)(.+)$/.exec(spec);
  if (pinned?.[1] !== undefined && pinned[2] !== undefined) {
    return { manager: "pypi", name: stripExtras(pinned[1]), version: pinned[2] };
  }
  return { manager: "pypi", name: stripExtras(spec.split(/[<>=!~;\s]/)[0] ?? spec) };
}

function stripExtras(name: string): string {
  return name.split("[")[0] ?? name;
}

function isPinned(base: string, spec: string): boolean {
  if (NPM_RUNNERS.has(base)) return /@\d/.test(spec.startsWith("@") ? spec.slice(1) : spec);
  return spec.includes("==") || spec.includes("@");
}

function finding(
  ruleId: Finding["ruleId"],
  severity: Finding["severity"],
  path: string,
  message: string,
  fix: string,
  evidence: string,
): Finding {
  return {
    ruleId,
    severity,
    location: { kind: "launch", path },
    message,
    fix,
    evidence: [evidence],
  };
}

function inlineCode(index: number, fragment: string): Finding {
  const clipped = clip(fragment);
  return finding(
    "launch/inline-code",
    "high",
    `args[${index}]`,
    `실행 명령이 코드를 인라인으로 담고 있습니다: ${clipped}`,
    "명령은 패키지나 파일을 가리켜야 합니다. 인라인 코드는 TrustFall(2026-05) 형 실행입니다.",
    clipped,
  );
}

function isInlineFlag(base: string, arg: string): boolean {
  if (INTERPRETERS.has(base)) return INTERPRETER_FLAGS.has(arg) || arg.startsWith("--eval=");
  if (SHELLS.has(base)) {
    return SHELL_FLAGS_EXACT.has(arg) || SHELL_FLAGS_FOLDED.has(arg.toLowerCase());
  }
  return false;
}

export function runLaunchRules(target: AuditTarget): Finding[] {
  if (target.kind !== "stdio" || target.command === undefined) return [];
  const base = basename(target.command);
  const args = target.args ?? [];
  const findings: Finding[] = [];

  args.forEach((arg, index) => {
    if (isInlineFlag(base, arg)) {
      const next = args[index + 1];
      findings.push(inlineCode(index, next === undefined ? arg : `${arg} ${next}`));
    } else if (arg.includes("`") || arg.includes("$(")) {
      findings.push(inlineCode(index, arg));
    }

    const piped = PIPE_TO_SHELL.exec(arg);
    if (piped !== null) {
      findings.push(
        finding(
          "launch/pipe-to-shell",
          "high",
          `args[${index}]`,
          "원격 스크립트를 받아 셸로 바로 넘깁니다",
          "받은 스크립트를 파일로 저장해 검토한 뒤 실행하세요.",
          clip(piped[0]),
        ),
      );
    }

    if (REMOTE_FETCHERS.has(base) && REMOTE_URL.test(arg)) {
      findings.push(
        finding(
          "launch/remote-source",
          "high",
          `args[${index}]`,
          `원격 주소에서 코드를 받아 실행합니다: ${clip(arg)}`,
          "레지스트리에 발행된 버전 고정 패키지로 바꾸세요.",
          clip(arg),
        ),
      );
    }
  });

  if (NPM_RUNNERS.has(base) || PYPI_RUNNERS.has(base)) {
    const pkg = packageArg(base, args);
    if (pkg !== undefined && !isPinned(base, pkg.spec)) {
      const name = (NPM_RUNNERS.has(base) ? parseNpmSpec(pkg.spec) : parsePypiSpec(pkg.spec)).name;
      findings.push(
        finding(
          "launch/unpinned-package",
          "medium",
          `args[${pkg.index}]`,
          `패키지 버전이 고정되지 않았습니다: ${name}`,
          `${name}@<버전> 처럼 버전을 고정하세요. 다음 실행에서 다른 코드가 돌 수 있습니다(postmark-mcp 2025-09).`,
          clip(pkg.spec),
        ),
      );
    }
  }

  for (const name of target.forwardedEnvNames) {
    if (!SECRET_NAME.test(name)) continue;
    findings.push(
      finding(
        "launch/env-passthrough",
        "info",
        `env.${name}`,
        `환경변수 ${name} 의 실제 값이 서버에 전달됩니다`,
        "응답에 그 값이 나오는지 secret/env-echo 가 봅니다. 가능하면 권한을 좁힌 토큰을 쓰세요.",
        name,
      ),
    );
  }

  return sortAndDedupe(findings);
}

/** §3.0 의 정렬·중복 제거. 비교는 코드 단위 순서다(로캘 비의존). */
function sortAndDedupe(findings: readonly Finding[]): Finding[] {
  const seen = new Set<string>();
  const unique = findings.filter((f) => {
    const key = `${f.ruleId}\u0000${f.location.path}\u0000${f.evidence[0] ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.sort((a, b) => {
    for (const [x, y] of [
      [a.ruleId, b.ruleId],
      [a.location.path, b.location.path],
      [a.evidence[0] ?? "", b.evidence[0] ?? ""],
    ] as const) {
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  });
}

export function parseLaunchPackage(target: AuditTarget): AuditBaseline["launch"] {
  if (target.kind !== "stdio" || target.command === undefined) return undefined;
  const command = target.command;
  const args = [...(target.args ?? [])];
  const base = basename(command);
  const isNpm = NPM_RUNNERS.has(base);
  if (!isNpm && !PYPI_RUNNERS.has(base)) return { command, args };
  const pkg = packageArg(base, args);
  if (pkg === undefined) return { command, args };
  const parsed = isNpm ? parseNpmSpec(pkg.spec) : parsePypiSpec(pkg.spec);
  // 키 순서를 §5.1 선언 순서로 고정한다. version 이 없으면 키 자체를 두지 않는다.
  const packageInfo =
    parsed.version === undefined
      ? { manager: parsed.manager, name: parsed.name }
      : { manager: parsed.manager, name: parsed.name, version: parsed.version };
  return { command, args, package: packageInfo };
}
