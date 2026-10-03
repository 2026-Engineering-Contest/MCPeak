/**
 * `@mcpeak/audit` 의 Docker 백엔드가 쓰는 바깥 접점(`DockerIo`)의 Node 구현. 그 패키지는
 * `node:child_process` 와 파일 시스템을 직접 쓰지 않고 CLI 가 넣어 준다(격리 계획서 §7). 인터페이스
 * 주석(`packages/audit/src/sandbox/docker.ts`)이 계약의 정본이다.
 *
 * docker 는 `execFile` 로 부른다. 셸을 거치지 않으므로 인자의 글자가 명령으로 읽히지 않는다.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DockerIo } from "@mcpeak/audit";

/**
 * docker CLI 가 데몬을 찾는 데 쓰는 호스트 변수. 설정된 것만 `launchEnv` 로 넘어간다. 뒤의 둘은 TLS
 * 로 붙는 데몬에 필요하다.
 */
const DOCKER_CLIENT_ENV = [
  "PATH",
  "HOME",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
] as const;

/** 시스템 콜 기록을 `cat` 으로 통째로 읽는다. 도구가 많은 서버의 기록은 수십 MB 가 된다. */
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

const TEMP_PREFIX = "mcpeak-audit-sandbox-";

/**
 * `@mcpeak/audit` 패키지의 `sandbox` 디렉터리(Dockerfile 과 게이트웨이 소스). 패키지 진입점에서 위로
 * 올라가며 찾는다. 설치본은 진입점이 `dist/` 에, 소스 실행(vitest)은 `src/` 에 있고 둘 다 한 단계
 * 위가 패키지 루트다. 빌드 산출물이 아직 없어 진입점을 풀지 못하면 저장소 안의 자리를 쓴다.
 */
export function auditSandboxDir(): string {
  const starts: string[] = [];
  try {
    starts.push(dirname(fileURLToPath(import.meta.resolve("@mcpeak/audit"))));
  } catch {
    // 아래의 저장소 자리로 간다.
  }
  starts.push(fileURLToPath(new URL("../../audit/src", import.meta.url)));
  for (const start of starts) {
    for (let dir = start; ; dir = dirname(dir)) {
      if (existsSync(join(dir, "sandbox", "Dockerfile"))) return join(dir, "sandbox");
      if (dirname(dir) === dir) break;
    }
  }
  throw new Error(
    "@mcpeak/audit 의 sandbox 디렉터리(Dockerfile)를 찾지 못했습니다. @mcpeak/audit 를 다시 설치하세요.",
  );
}

/** `dir` 아래의 모든 파일. 경로는 `dir` 기준 상대 경로(구분자 `/`)이고 코드 단위 순으로 정렬한다. */
async function listFiles(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await listFiles(join(dir, entry.name), path)));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function nodeDockerIo(options: {
  /** 백엔드의 진행 문장(이미지를 처음 만들 때의 한 줄)을 받는다. */
  progress(line: string): void;
}): DockerIo {
  // 격리를 쓰지 않는 실행이 패키지 자리를 찾느라 실패하지 않게, 처음 쓸 때 찾는다.
  let sandboxDir: string | undefined;
  const findSandboxDir = () => {
    sandboxDir ??= auditSandboxDir();
    return sandboxDir;
  };
  return {
    run(args, runOptions = {}) {
      return new Promise((resolve, reject) => {
        execFile(
          "docker",
          [...args],
          {
            env: { ...process.env, ...runOptions.extraEnv },
            encoding: "utf8",
            maxBuffer: MAX_OUTPUT_BYTES,
            ...(runOptions.timeoutMs === undefined ? {} : { timeout: runOptions.timeoutMs }),
          },
          (error, stdout, stderr) => {
            if (error === null) return resolve({ code: 0, stdout, stderr });
            // 0 이 아닌 종료 코드는 실패가 아니라 결과다. 호출자가 stderr 첫 줄을 이유로 쓴다.
            if (typeof error.code === "number")
              return resolve({ code: error.code, stdout, stderr });
            // 실행 파일이 없으면 `code: "ENOENT"` 그대로 올린다. 호출자가 docker-missing 으로 읽는다.
            if (error.code === "ENOENT") return reject(error);
            if (error.killed && runOptions.timeoutMs !== undefined)
              return reject(
                new Error(
                  `docker ${args[0] ?? ""} 이 ${Math.round(runOptions.timeoutMs / 1000)}초 안에 끝나지 않았습니다`,
                ),
              );
            reject(error);
          },
        );
      });
    },
    dockerClientEnv() {
      const env: Record<string, string> = {};
      for (const name of DOCKER_CLIENT_ENV) {
        const value = process.env[name];
        if (value !== undefined && value !== "") env[name] = value;
      }
      return env;
    },
    async makeTempDir() {
      const dir = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
      // mkdtemp 는 0700 으로 만든다. 컨테이너의 `node` 사용자(uid 1000)가 마운트된 홈을 읽어야 한다.
      await chmod(dir, 0o755);
      return dir;
    },
    async writeFile(path, content, mode) {
      // `mkdir` 과 `writeFile` 의 mode 는 umask 에 깎인다. 만든 것마다 chmod 로 맞춘다. 이미 있던
      // 디렉터리의 권한은 건드리지 않는다.
      const parent = dirname(path);
      const firstCreated = await mkdir(parent, { recursive: true, mode: 0o755 });
      if (firstCreated !== undefined)
        for (let dir = parent; ; dir = dirname(dir)) {
          await chmod(dir, 0o755);
          if (dir === firstCreated || dirname(dir) === dir) break;
        }
      await writeFile(path, content, { encoding: "utf8", mode });
      await chmod(path, mode);
    },
    readFile: (path) => readFile(path, "utf8"),
    removeDir: (path) => rm(path, { recursive: true, force: true }),
    async readSandboxSources() {
      const dir = findSandboxDir();
      return Promise.all(
        (await listFiles(dir)).map(async (path) => ({
          path,
          content: await readFile(join(dir, path), "utf8"),
        })),
      );
    },
    get sandboxDir() {
      return findSandboxDir();
    },
    fetch: globalThis.fetch,
    random: () => randomBytes(8).toString("hex"),
    progress: options.progress,
  };
}
