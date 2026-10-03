/**
 * `mcpeak audit --sandbox` 가 컨테이너에 보일 호스트 디렉터리(마운트 범위)를 정하고, 서버가 스스로
 * 적은 목적지 선언(README·package.json)을 읽는다(계획서 §3.1, §3.6, §7).
 *
 * 파일 접근은 주입받은 `stat`·`readFile` 로만 한다. 경로 판정은 글자로만 하고 심볼릭 링크를 풀지
 * 않는다.
 */
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export interface SandboxTargetFs {
  /** 경로가 가리키는 것. 없거나 볼 수 없으면 undefined 다. 던지지 않는다. */
  stat(path: string): Promise<"file" | "directory" | undefined>;
  readFile(path: string): Promise<string>;
}

/** 마운트 범위를 정하지 못했다. `message` 가 §6.3 의 사용법 오류 문장이다. */
export class SandboxTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxTargetError";
  }
}

/** `path` 가 `root` 자신이거나 그 아래인가. */
export function isInside(root: string, path: string): boolean {
  const rest = relative(root, path);
  return rest === "" || (rest !== ".." && !rest.startsWith(`..${sep}`) && !isAbsolute(rest));
}

/** `start` 에서 위로 올라가며 `name` 이 있는 가장 가까운 디렉터리. */
async function nearestWith(
  start: string,
  name: string,
  fs: Pick<SandboxTargetFs, "stat">,
): Promise<string | undefined> {
  for (let dir = start; ; dir = dirname(dir)) {
    if ((await fs.stat(resolve(dir, name))) !== undefined) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

/**
 * 마운트 범위(§3.1 의 네 규칙).
 *
 * 1. `--sandbox-mount` 가 있으면 그것. 있어야 하고 디렉터리여야 한다.
 * 2. 없으면 `cwd` 에서 위로 가장 가까운 `pnpm-workspace.yaml` 의 디렉터리, 없으면 가장 가까운 `.git`
 *    의 디렉터리, 둘 다 없으면 `cwd`. pnpm 의 `node_modules` 심링크가 워크스페이스 루트를 가리켜서
 *    서버 디렉터리만 보이면 import 가 깨진다.
 * 3. 범위가 홈 디렉터리 자체이거나 `/` 면 거절한다. 홈 전체를 보이면 진짜 자격 증명이 보인다.
 * 4. 서버 인자 중 호스트에 있는 경로로 풀리는 것이 범위 밖이면 거절한다. 컨테이너에는 그 파일이 없다.
 */
export async function resolveMountRoot(
  input: {
    readonly mountPath?: string;
    readonly cwd: string;
    readonly home: string;
    readonly serverArgs: readonly string[];
  },
  fs: Pick<SandboxTargetFs, "stat">,
): Promise<string> {
  let root: string;
  if (input.mountPath !== undefined) {
    root = resolve(input.cwd, input.mountPath);
    if ((await fs.stat(root)) !== "directory")
      throw new SandboxTargetError(`--sandbox-mount 경로가 없습니다: ${input.mountPath}`);
  } else {
    root =
      (await nearestWith(input.cwd, "pnpm-workspace.yaml", fs)) ??
      (await nearestWith(input.cwd, ".git", fs)) ??
      input.cwd;
  }
  if (root === resolve(input.home) || dirname(root) === root)
    throw new SandboxTargetError(
      `격리에 보일 범위가 홈 디렉터리나 / 입니다: ${root}. 진짜 자격 증명이 컨테이너에 보입니다. 서버 코드가 있는 디렉터리를 --sandbox-mount 로 주세요.`,
    );
  for (const arg of input.serverArgs) {
    const path = resolve(input.cwd, arg);
    if (isInside(root, path)) continue;
    // `--port` 나 `8080` 같은 인자는 경로로 풀어도 없는 파일이다. 있는 것만 판정한다.
    if ((await fs.stat(path)) === undefined) continue;
    throw new SandboxTargetError(
      `서버 인자 '${arg}' 가 격리에 보이는 범위(${root}) 밖에 있습니다. 둘을 함께 담는 디렉터리를 --sandbox-mount 로 주세요.`,
    );
  }
  return root;
}

/**
 * 서버가 스스로 적은 목적지 선언의 출처(§3.6). 서버 인자 중 파일로 풀리는 첫 경로의 디렉터리에서
 * 위로 올라가며 마운트 범위 안의 가장 가까운 `package.json` 과, 같은 디렉터리의 `README.md` 를
 * 읽는다. 없으면 빈 배열이다. 순서는 언제나 package.json 다음 README 다.
 */
export async function readDeclarationTexts(
  input: {
    readonly mountRoot: string;
    readonly cwd: string;
    readonly serverArgs: readonly string[];
  },
  fs: SandboxTargetFs,
): Promise<ReadonlyArray<{ readonly source: "readme" | "package.json"; readonly text: string }>> {
  let entry: string | undefined;
  for (const arg of input.serverArgs) {
    const path = resolve(input.cwd, arg);
    if (isInside(input.mountRoot, path) && (await fs.stat(path)) === "file") {
      entry = path;
      break;
    }
  }
  if (entry === undefined) return [];
  for (let dir = dirname(entry); isInside(input.mountRoot, dir); dir = dirname(dir)) {
    const manifest = resolve(dir, "package.json");
    if ((await fs.stat(manifest)) === "file") {
      const texts: Array<{ source: "readme" | "package.json"; text: string }> = [];
      const push = async (source: "readme" | "package.json", path: string) => {
        // 읽지 못한 파일은 선언이 없는 것으로 본다. 선언은 판정을 누그러뜨리기만 한다.
        try {
          texts.push({ source, text: await fs.readFile(path) });
        } catch {}
      };
      await push("package.json", manifest);
      const readme = resolve(dir, "README.md");
      if ((await fs.stat(readme)) === "file") await push("readme", readme);
      return texts;
    }
    if (dirname(dir) === dir) break;
  }
  return [];
}
