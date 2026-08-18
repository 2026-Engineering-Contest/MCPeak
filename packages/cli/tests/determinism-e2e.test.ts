import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { run } from "../src/index.js";

vi.mock("@ohmymcp-hsu/core", async () => import("../../core/src/index.js"));
vi.mock("@ohmymcp-hsu/runner", async () => import("../../runner/src/index.js"));

/**
 * 결정론성 확인의 실서버 E2E (설계 문서 §9.3). **실제 서버 프로세스를 띄우므로 직렬이다.**
 *
 * 유닛(`test-command.test.ts`)은 전부 가짜 의존성이라 실제 러너·클라이언트·종료 절차가 물린
 * 조합을 한 번도 안 돈다. 이 파일이 그 자리다. T3 에서 캡처 래퍼가 종료 절차의 client 동일성
 * 계약을 깨 서버가 좀비로 남았던 결함이 유닛 1879개를 전부 통과했다.
 */
const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const root = resolve(here, "../../..");
const wrapper = join(here, "fixtures/stdio-server-wrapper.mjs");
const weatherServer = join(root, "examples/weather-server/server.mjs");
const weatherSuite = join(here, "fixtures/weather-suite.json");
const nondeterministicServer = join(here, "fixtures/nondeterministic-weather-server.mjs");
const nondeterministicSuite = join(here, "fixtures/nondeterministic-weather.suite.json");

/** 2회 실행 + 서버 기동 두 번이라 기본 5초로는 모자란다. 여유는 넉넉히 둔다. */
const E2E_TIMEOUT_MS = 60_000;

const parsePid = (text: string): number | undefined => {
  if (!/^[1-9][0-9]*$/.test(text.trim())) return undefined;
  const pid = Number(text.trim());
  return Number.isSafeInteger(pid) ? pid : undefined;
};

/**
 * 마지막 회차 서버가 종료됐는지 본다. 래퍼는 회차마다 같은 파일에 자기 PID 를 덮어쓰므로
 * 이 값은 **2회차** 서버다. 1회차는 2회차가 시작되기 전에 닫혀야 하고, 그 순서는 유닛이
 * (`1회차 연결을 닫은 뒤에 2회차 연결을 연다`) 고정한다.
 */
async function expectExited(pidFile: string): Promise<void> {
  const pid = parsePid(await readFile(pidFile, "utf8"));
  if (pid === undefined) throw new Error("PID 파일은 양의 정수를 포함해야 합니다.");
  const started = Date.now();
  for (let polls = 1; ; polls += 1) {
    try {
      process.kill(pid, 0);
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return;
      throw error;
    }
    if (polls >= 25 && Date.now() - started >= 3_000)
      throw new Error(
        `서버(PID ${pid})가 종료되지 않았습니다. --determinism 의 2회차 연결이 닫히지 않으면 ` +
          "CI 가 매달립니다. test-command.ts 의 finalize·forceClose 경로를 확인하세요.",
      );
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 20));
  }
}

/**
 * 실행 파일 경로를 앵커로 잡아 센다. `ps aux | grep -c '[패턴]'` 은 그 문자열을 인자로 가진
 * 자기 셸까지 세어 서버가 0개인데 2를 낸다(T3 재작업에서 실제로 밟았다).
 *
 * **이 파일 전용 fixture 경로에만 쓴다.** `examples/weather-server` 는 다른 테스트 파일도
 * 띄우고 vitest 는 파일을 병렬로 돌리므로, 공유 경로를 세면 남의 살아 있는 서버가 잡혀
 * 간헐 실패한다(실제로 밟았다). 공유 서버의 잔존은 래퍼가 남기는 PID 로 본다.
 *
 * Windows 의 `ps`(Git Bash 등)는 procps 의 `-eo` 옵션을 지원하지 않으므로, 같은 정보를
 * `Get-CimInstance Win32_Process`의 `CommandLine`으로 대신 얻는다. 결과는 파일로 받는다 —
 * 파이프로 직접 받으면 콘솔 코드페이지(예: cp949)를 거쳐 프로젝트 경로의 한글이 깨질 수
 * 있는데, `Out-File -Encoding utf8`은 그 변환을 우회한다.
 */
function livingServers(serverPath: string): number {
  const listed =
    process.platform === "win32"
      ? listWindowsCommandLines()
      : execFileSync("ps", ["-eo", "args="], { encoding: "utf8" });
  return listed.split("\n").filter((line) => line.includes(serverPath) && line.includes("node"))
    .length;
}

function listWindowsCommandLines(): string {
  const directory = mkdtempSync(join(tmpdir(), "ohmymcp-livingservers-"));
  const outFile = join(directory, "procs.txt");
  try {
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Get-CimInstance Win32_Process | Select-Object -ExpandProperty CommandLine | Out-File -Encoding utf8 -FilePath '${outFile}'`,
    ]);
    return readFileSync(outFile, "utf8");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function runCliCapturingStdout(argv: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stdout: string;
}> {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    const exitCode = await run([...argv]);
    return { exitCode, stdout: out.mock.calls.map(([value]) => String(value)).join("") };
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
}

describe.sequential("결정론성 확인 E2E (실서버)", () => {
  it(
    "weather-server 는 차이 0 이다",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "ohmymcp-determinism-e2e-"));
      const pidFile = join(directory, "server.pid");
      try {
        const { exitCode, stdout } = await runCliCapturingStdout([
          "test",
          weatherSuite,
          "--command",
          process.execPath,
          "--arg",
          wrapper,
          "--arg",
          pidFile,
          "--arg",
          weatherServer,
          "--determinism",
        ]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("결정론성 확인");
        // `--reset-cmd` 없이 돌렸다. 고정 데이터 서버라 복원이 불필요해도 문장은 복원 유무를
        // 따른다. "확인했습니다" 가 아니라 "같았습니다" 여야 한다.
        expect(stdout).toContain("2회 실행 결과가 같았습니다. (3/3)");
        expect(stdout).toContain("상태를 복원하지 않았으므로 결정론성 확인은 아닙니다");
        expect(stdout).not.toContain("케이스에서 2회 실행 결과가 다릅니다");
        await expectExited(pidFile);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    E2E_TIMEOUT_MS,
  );

  it(
    "비결정 예제 서버에서 차이를 짚는다",
    async () => {
      const { exitCode, stdout } = await runCliCapturingStdout([
        "test",
        nondeterministicSuite,
        "--command",
        process.execPath,
        "--arg",
        nondeterministicServer,
        "--determinism",
      ]);
      // 비차단 진단이다. 1회차가 전부 통과했으므로 차이가 있어도 0 이다.
      expect(exitCode).toBe(0);
      expect(stdout).toContain("1/1 케이스에서 2회 실행 결과가 다릅니다");
      expect(stdout).toContain("content[0].text");
      expect(stdout).toContain("시간 의존으로 보입니다");
      // 심은 비결정 필드가 실제로 양쪽 값에 보여야 한다. 경로만 맞고 값이 안 보이면 화면이
      // 사람에게 아무것도 알려주지 못한다.
      expect(stdout).toContain("fetchedAt");
      expect(livingServers(nondeterministicServer)).toBe(0);
    },
    E2E_TIMEOUT_MS,
  );

  it(
    "--reset-cmd 와 함께면 결론 문장이 확인으로 올라간다",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "ohmymcp-determinism-e2e-"));
      const pidFile = join(directory, "server.pid");
      try {
        const { exitCode, stdout } = await runCliCapturingStdout([
          "test",
          weatherSuite,
          "--command",
          process.execPath,
          "--arg",
          wrapper,
          "--arg",
          pidFile,
          "--arg",
          weatherServer,
          "--determinism",
          // 셸을 안 거치므로 인자 없는 실행 파일이어야 한다. 상태가 없는 서버라 `true` 로 족하다.
          "--reset-cmd",
          "true",
        ]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("같은 초기 상태에서 2회 실행한 결과가 모든 케이스에서 같습니다.");
        expect(stdout).not.toContain("결정론성 확인은 아닙니다");
        await expectExited(pidFile);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    E2E_TIMEOUT_MS,
  );
});
