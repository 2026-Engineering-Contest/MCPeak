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
 */

const HOME = "/home/alice";

/** 경로 → 파일 내용(문자열) 또는 디렉터리(`null`). */
function fakeFs(entries: Readonly<Record<string, string | null>>): SandboxTargetFs {
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

const WORKSPACE = {
  "/home/alice/work": null,
  "/home/alice/work/repo": null,
  "/home/alice/work/repo/pnpm-workspace.yaml": "packages:\n",
  "/home/alice/work/repo/.git": null,
  "/home/alice/work/repo/examples": null,
  "/home/alice/work/repo/examples/srv": null,
  "/home/alice/work/repo/examples/srv/server.mjs": "",
  "/home/alice/work/repo/examples/srv/package.json": '{"homepage":"https://srv.example.org"}',
  "/home/alice/work/repo/examples/srv/README.md": "API: https://api.example.org/v1",
  "/home/alice/other": null,
  "/home/alice/other/server.mjs": "",
} as const;

const resolveRoot = (
  input: { mountPath?: string; cwd: string; serverArgs?: readonly string[] },
  entries: Readonly<Record<string, string | null>> = WORKSPACE,
) =>
  resolveMountRoot(
    { home: HOME, serverArgs: [], ...input },
    fakeFs({ "/": null, "/home": null, [HOME]: null, ...entries }),
  );

describe("resolveMountRoot", () => {
  it("--sandbox-mount 가 있으면 그 절대 경로", async () => {
    await expect(
      resolveRoot({ mountPath: "/home/alice/work/repo/examples", cwd: "/home/alice/work/repo" }),
    ).resolves.toBe("/home/alice/work/repo/examples");
    // 상대 경로는 cwd 기준으로 푼다.
    await expect(
      resolveRoot({ mountPath: "examples/srv", cwd: "/home/alice/work/repo" }),
    ).resolves.toBe("/home/alice/work/repo/examples/srv");
  });

  it("--sandbox-mount 경로가 없거나 디렉터리가 아니면 §6.3 문장", async () => {
    await expect(
      resolveRoot({ mountPath: "./nope", cwd: "/home/alice/work/repo" }),
    ).rejects.toThrow(new SandboxTargetError("--sandbox-mount 경로가 없습니다: ./nope"));
    await expect(
      resolveRoot({ mountPath: "examples/srv/server.mjs", cwd: "/home/alice/work/repo" }),
    ).rejects.toThrow("--sandbox-mount 경로가 없습니다: examples/srv/server.mjs");
  });

  it("없으면 cwd 에서 위로 가장 가까운 pnpm-workspace.yaml 의 디렉터리", async () => {
    await expect(resolveRoot({ cwd: "/home/alice/work/repo/examples/srv" })).resolves.toBe(
      "/home/alice/work/repo",
    );
    // 더 가까운 .git 이 있어도 pnpm-workspace.yaml 이 이긴다. node_modules 심링크가 그 루트를 가리킨다.
    await expect(
      resolveRoot(
        { cwd: "/home/alice/work/repo/examples/srv" },
        { ...WORKSPACE, "/home/alice/work/repo/examples/.git": null },
      ),
    ).resolves.toBe("/home/alice/work/repo");
  });

  it("pnpm-workspace.yaml 이 없으면 가장 가까운 .git 의 디렉터리", async () => {
    const { "/home/alice/work/repo/pnpm-workspace.yaml": _removed, ...withoutWorkspace } =
      WORKSPACE;
    await expect(
      resolveRoot({ cwd: "/home/alice/work/repo/examples/srv" }, withoutWorkspace),
    ).resolves.toBe("/home/alice/work/repo");
    // worktree 의 .git 은 디렉터리가 아니라 파일이다.
    await expect(
      resolveRoot(
        { cwd: "/home/alice/work/repo/examples/srv" },
        { ...withoutWorkspace, "/home/alice/work/repo/.git": "gitdir: /elsewhere\n" },
      ),
    ).resolves.toBe("/home/alice/work/repo");
  });

  it("둘 다 없으면 cwd", async () => {
    await expect(
      resolveRoot({ cwd: "/home/alice/other" }, { "/home/alice/other": null }),
    ).resolves.toBe("/home/alice/other");
  });

  it("서버 인자의 절대 경로가 범위 밖이면 §6.3 문장", async () => {
    await expect(
      resolveRoot({ cwd: "/home/alice/work/repo", serverArgs: ["/home/alice/other/server.mjs"] }),
    ).rejects.toThrow(
      new SandboxTargetError(
        "서버 인자 '/home/alice/other/server.mjs' 가 격리에 보이는 범위(/home/alice/work/repo) 밖에 있습니다. 둘을 함께 담는 디렉터리를 --sandbox-mount 로 주세요.",
      ),
    );
    // 범위 안의 절대 경로는 통과한다.
    await expect(
      resolveRoot({
        cwd: "/home/alice/work/repo",
        serverArgs: ["/home/alice/work/repo/examples/srv/server.mjs"],
      }),
    ).resolves.toBe("/home/alice/work/repo");
    // 이름만 앞부분이 같은 형제 디렉터리는 범위 밖이다.
    await expect(
      resolveRoot(
        { cwd: "/home/alice/work/repo", serverArgs: ["/home/alice/work/repo-old/server.mjs"] },
        { ...WORKSPACE, "/home/alice/work/repo-old/server.mjs": "" },
      ),
    ).rejects.toThrow("서버 인자 '/home/alice/work/repo-old/server.mjs' 가 격리에 보이는 범위");
  });

  it("서버 인자의 상대 경로는 cwd 기준으로 풀어 판정한다", async () => {
    await expect(
      resolveRoot({ cwd: "/home/alice/work/repo/examples", serverArgs: ["srv/server.mjs"] }),
    ).resolves.toBe("/home/alice/work/repo");
    // 문장에는 사용자가 쓴 글자 그대로 싣는다.
    await expect(
      resolveRoot({
        mountPath: "/home/alice/work/repo",
        cwd: "/home/alice/work",
        serverArgs: ["../other/server.mjs"],
      }),
    ).rejects.toThrow(
      "서버 인자 '../other/server.mjs' 가 격리에 보이는 범위(/home/alice/work/repo) 밖에 있습니다. 둘을 함께 담는 디렉터리를 --sandbox-mount 로 주세요.",
    );
  });

  it("존재하지 않는 경로 꼴 인자(예: --port)는 판정하지 않는다", async () => {
    await expect(
      resolveRoot({
        cwd: "/home/alice/work/repo",
        serverArgs: ["examples/srv/server.mjs", "--port", "8080", "/no/such/file", "../ghost"],
      }),
    ).resolves.toBe("/home/alice/work/repo");
  });

  it("범위가 홈 디렉터리이거나 / 면 §6.3 문장", async () => {
    const sentence = (root: string) =>
      `격리에 보일 범위가 홈 디렉터리나 / 입니다: ${root}. 진짜 자격 증명이 컨테이너에 보입니다. 서버 코드가 있는 디렉터리를 --sandbox-mount 로 주세요.`;
    await expect(resolveRoot({ mountPath: HOME, cwd: "/home/alice/work/repo" })).rejects.toThrow(
      new SandboxTargetError(sentence(HOME)),
    );
    await expect(resolveRoot({ mountPath: "/", cwd: "/home/alice/work/repo" })).rejects.toThrow(
      new SandboxTargetError(sentence("/")),
    );
    // 옵션 없이 홈에서 실행해 범위가 홈으로 정해진 경우도 같다.
    await expect(resolveRoot({ cwd: HOME }, {})).rejects.toThrow(sentence(HOME));
    // 홈 아래의 디렉터리는 된다.
    await expect(resolveRoot({ cwd: "/home/alice/other" }, WORKSPACE)).resolves.toBe(
      "/home/alice/other",
    );
  });
});

describe("readDeclarationTexts", () => {
  const read = (serverArgs: readonly string[], mountRoot = "/home/alice/work/repo") =>
    readDeclarationTexts(
      { mountRoot, cwd: "/home/alice/work/repo", serverArgs },
      fakeFs({ "/": null, "/home": null, [HOME]: null, ...WORKSPACE }),
    );

  it("서버 인자 중 파일로 풀리는 첫 경로에서 가장 가까운 package.json 과 그 옆의 README.md 를 읽는다", async () => {
    await expect(read(["--flag", "examples/srv/server.mjs"])).resolves.toEqual([
      { source: "package.json", text: '{"homepage":"https://srv.example.org"}' },
      { source: "readme", text: "API: https://api.example.org/v1" },
    ]);
  });

  it("package.json 을 마운트 범위 밖에서는 찾지 않는다", async () => {
    await expect(
      readDeclarationTexts(
        {
          mountRoot: "/home/alice/work/repo/examples/srv/lib",
          cwd: "/home/alice/work/repo",
          serverArgs: ["/home/alice/work/repo/examples/srv/lib/main.mjs"],
        },
        fakeFs({ ...WORKSPACE, "/home/alice/work/repo/examples/srv/lib/main.mjs": "" }),
      ),
    ).resolves.toEqual([]);
  });

  it("파일로 풀리는 인자가 없거나 package.json 이 없으면 빈 배열이다", async () => {
    await expect(read(["-y", "some-mcp-server@1.2.3"])).resolves.toEqual([]);
    await expect(read(["/home/alice/other/server.mjs"], "/home/alice/other")).resolves.toEqual([]);
  });

  it("package.json 옆에 README.md 가 없으면 package.json 만 낸다", async () => {
    const { "/home/alice/work/repo/examples/srv/README.md": _removed, ...withoutReadme } =
      WORKSPACE;
    await expect(
      readDeclarationTexts(
        {
          mountRoot: "/home/alice/work/repo",
          cwd: "/home/alice/work/repo",
          serverArgs: ["examples/srv/server.mjs"],
        },
        fakeFs(withoutReadme),
      ),
    ).resolves.toEqual([
      { source: "package.json", text: '{"homepage":"https://srv.example.org"}' },
    ]);
  });
});
