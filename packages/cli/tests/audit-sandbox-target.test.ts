import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readDeclarationTexts,
  resolveMountRoot,
  SandboxTargetError,
  type SandboxTargetFs,
} from "../src/audit-sandbox-target.js";

/**
 * 계획서 §8.7 의 둘째 describe. 파일 시스템은 건드리지 않는다. `stat`·`readFile` 을 표 하나로 바꿔
 * 넣는다(인메모리).
 *
 * 경로는 글자로 박지 않고 `path.join` 으로 만든다. 제품 코드가 `path.resolve` 로 경로를 푸는데 그
 * 결과가 OS 마다 다르다 — 윈도우에서 `/home/alice` 는 `C:\home\alice` 로 풀린다. POSIX 꼴을 박으면
 * 그 표의 어느 키와도 맞지 않아 "경로가 없습니다" 로 끝난다(#539).
 */

/** 플랫폼의 파일 시스템 뿌리. POSIX 는 `/`, 윈도우는 cwd 가 있는 드라이브(`C:\`). */
const ROOT = resolve("/");
const HOME = join(ROOT, "home", "alice");
const WORK = join(HOME, "work");
const REPO = join(WORK, "repo");
const EXAMPLES = join(REPO, "examples");
const SRV = join(EXAMPLES, "srv");
const OTHER = join(HOME, "other");

/** 경로 → 파일 내용(문자열) 또는 디렉터리(`null`). */
type Entries = Readonly<Record<string, string | null>>;

function fakeFs(entries: Entries): SandboxTargetFs {
  const table = new Map(Object.entries(entries));
  return {
    stat: async (path) => {
      if (!table.has(path)) return undefined;
      return table.get(path) === null ? "directory" : "file";
    },
    readFile: async (path) => {
      const content = table.get(path);
      if (typeof content !== "string")
        throw Object.assign(new Error(`ENOENT: no such file, open '${path}'`), { code: "ENOENT" });
      return content;
    },
  };
}

/** 표에서 경로 몇 개를 뺀 사본. 키가 플랫폼마다 달라서 글자로 구조분해할 수 없다. */
function without(entries: Entries, ...paths: readonly string[]): Entries {
  const copy: Record<string, string | null> = { ...entries };
  for (const path of paths) delete copy[path];
  return copy;
}

const WORKSPACE: Entries = {
  [WORK]: null,
  [REPO]: null,
  [join(REPO, "pnpm-workspace.yaml")]: "packages:\n",
  [join(REPO, ".git")]: null,
  [EXAMPLES]: null,
  [SRV]: null,
  [join(SRV, "server.mjs")]: "",
  [join(SRV, "package.json")]: '{"homepage":"https://srv.example.org"}',
  [join(SRV, "README.md")]: "API: https://api.example.org/v1",
  [OTHER]: null,
  [join(OTHER, "server.mjs")]: "",
};

const resolveRoot = (
  input: { mountPath?: string; cwd: string; serverArgs?: readonly string[] },
  entries: Entries = WORKSPACE,
) =>
  resolveMountRoot(
    { home: HOME, serverArgs: [], ...input },
    fakeFs({ [ROOT]: null, [join(ROOT, "home")]: null, [HOME]: null, ...entries }),
  );

describe("resolveMountRoot", () => {
  it("--sandbox-mount 가 있으면 그 절대 경로", async () => {
    await expect(resolveRoot({ mountPath: EXAMPLES, cwd: REPO })).resolves.toBe(EXAMPLES);
    // 상대 경로는 cwd 기준으로 푼다.
    await expect(resolveRoot({ mountPath: "examples/srv", cwd: REPO })).resolves.toBe(SRV);
  });

  it("--sandbox-mount 경로가 없거나 디렉터리가 아니면 §6.3 문장", async () => {
    await expect(resolveRoot({ mountPath: "./nope", cwd: REPO })).rejects.toThrow(
      new SandboxTargetError("--sandbox-mount 경로가 없습니다: ./nope"),
    );
    await expect(resolveRoot({ mountPath: "examples/srv/server.mjs", cwd: REPO })).rejects.toThrow(
      "--sandbox-mount 경로가 없습니다: examples/srv/server.mjs",
    );
  });

  it("없으면 cwd 에서 위로 가장 가까운 pnpm-workspace.yaml 의 디렉터리", async () => {
    await expect(resolveRoot({ cwd: SRV })).resolves.toBe(REPO);
    // 더 가까운 .git 이 있어도 pnpm-workspace.yaml 이 이긴다. node_modules 심링크가 그 루트를 가리킨다.
    await expect(
      resolveRoot({ cwd: SRV }, { ...WORKSPACE, [join(EXAMPLES, ".git")]: null }),
    ).resolves.toBe(REPO);
  });

  it("pnpm-workspace.yaml 이 없으면 가장 가까운 .git 의 디렉터리", async () => {
    const withoutWorkspace = without(WORKSPACE, join(REPO, "pnpm-workspace.yaml"));
    await expect(resolveRoot({ cwd: SRV }, withoutWorkspace)).resolves.toBe(REPO);
    // worktree 의 .git 은 디렉터리가 아니라 파일이다.
    await expect(
      resolveRoot(
        { cwd: SRV },
        { ...withoutWorkspace, [join(REPO, ".git")]: "gitdir: /elsewhere\n" },
      ),
    ).resolves.toBe(REPO);
  });

  it("둘 다 없으면 cwd", async () => {
    await expect(resolveRoot({ cwd: OTHER }, { [OTHER]: null })).resolves.toBe(OTHER);
  });

  it("서버 인자의 절대 경로가 범위 밖이면 §6.3 문장", async () => {
    const outside = join(OTHER, "server.mjs");
    await expect(resolveRoot({ cwd: REPO, serverArgs: [outside] })).rejects.toThrow(
      new SandboxTargetError(
        `서버 인자 '${outside}' 가 격리에 보이는 범위(${REPO}) 밖에 있습니다. 둘을 함께 담는 디렉터리를 --sandbox-mount 로 주세요.`,
      ),
    );
    // 범위 안의 절대 경로는 통과한다.
    await expect(resolveRoot({ cwd: REPO, serverArgs: [join(SRV, "server.mjs")] })).resolves.toBe(
      REPO,
    );
    // 이름만 앞부분이 같은 형제 디렉터리는 범위 밖이다.
    const sibling = join(WORK, "repo-old", "server.mjs");
    await expect(
      resolveRoot({ cwd: REPO, serverArgs: [sibling] }, { ...WORKSPACE, [sibling]: "" }),
    ).rejects.toThrow(`서버 인자 '${sibling}' 가 격리에 보이는 범위`);
  });

  it("서버 인자의 상대 경로는 cwd 기준으로 풀어 판정한다", async () => {
    await expect(resolveRoot({ cwd: EXAMPLES, serverArgs: ["srv/server.mjs"] })).resolves.toBe(
      REPO,
    );
    // 문장에는 사용자가 쓴 글자 그대로 싣는다.
    await expect(
      resolveRoot({
        mountPath: REPO,
        cwd: WORK,
        serverArgs: ["../other/server.mjs"],
      }),
    ).rejects.toThrow(
      `서버 인자 '../other/server.mjs' 가 격리에 보이는 범위(${REPO}) 밖에 있습니다. 둘을 함께 담는 디렉터리를 --sandbox-mount 로 주세요.`,
    );
  });

  it("존재하지 않는 경로 꼴 인자(예: --port)는 판정하지 않는다", async () => {
    await expect(
      resolveRoot({
        cwd: REPO,
        serverArgs: ["examples/srv/server.mjs", "--port", "8080", "/no/such/file", "../ghost"],
      }),
    ).resolves.toBe(REPO);
  });

  it("범위가 홈 디렉터리이거나 / 면 §6.3 문장", async () => {
    const sentence = (root: string) =>
      `격리에 보일 범위가 홈 디렉터리나 / 입니다: ${root}. 진짜 자격 증명이 컨테이너에 보입니다. 서버 코드가 있는 디렉터리를 --sandbox-mount 로 주세요.`;
    await expect(resolveRoot({ mountPath: HOME, cwd: REPO })).rejects.toThrow(
      new SandboxTargetError(sentence(HOME)),
    );
    await expect(resolveRoot({ mountPath: ROOT, cwd: REPO })).rejects.toThrow(
      new SandboxTargetError(sentence(ROOT)),
    );
    // 옵션 없이 홈에서 실행해 범위가 홈으로 정해진 경우도 같다.
    await expect(resolveRoot({ cwd: HOME }, {})).rejects.toThrow(sentence(HOME));
    // 홈 아래의 디렉터리는 된다.
    await expect(resolveRoot({ cwd: OTHER }, WORKSPACE)).resolves.toBe(OTHER);
  });
});

describe("readDeclarationTexts", () => {
  const read = (serverArgs: readonly string[], mountRoot = REPO) =>
    readDeclarationTexts(
      { mountRoot, cwd: REPO, serverArgs },
      fakeFs({ [ROOT]: null, [join(ROOT, "home")]: null, [HOME]: null, ...WORKSPACE }),
    );

  it("서버 인자 중 파일로 풀리는 첫 경로에서 가장 가까운 package.json 과 그 옆의 README.md 를 읽는다", async () => {
    await expect(read(["--flag", "examples/srv/server.mjs"])).resolves.toEqual([
      { source: "package.json", text: '{"homepage":"https://srv.example.org"}' },
      { source: "readme", text: "API: https://api.example.org/v1" },
    ]);
  });

  it("package.json 을 마운트 범위 밖에서는 찾지 않는다", async () => {
    const lib = join(SRV, "lib");
    const entry = join(lib, "main.mjs");
    await expect(
      readDeclarationTexts(
        { mountRoot: lib, cwd: REPO, serverArgs: [entry] },
        fakeFs({ ...WORKSPACE, [entry]: "" }),
      ),
    ).resolves.toEqual([]);
  });

  it("파일로 풀리는 인자가 없거나 package.json 이 없으면 빈 배열이다", async () => {
    await expect(read(["-y", "some-mcp-server@1.2.3"])).resolves.toEqual([]);
    await expect(read([join(OTHER, "server.mjs")], OTHER)).resolves.toEqual([]);
  });

  it("package.json 옆에 README.md 가 없으면 package.json 만 낸다", async () => {
    await expect(
      readDeclarationTexts(
        { mountRoot: REPO, cwd: REPO, serverArgs: ["examples/srv/server.mjs"] },
        fakeFs(without(WORKSPACE, join(SRV, "README.md"))),
      ),
    ).resolves.toEqual([
      { source: "package.json", text: '{"homepage":"https://srv.example.org"}' },
    ]);
  });
});
