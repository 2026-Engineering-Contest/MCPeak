import { describe, expect, it } from "vitest";
import { planCanaries } from "../src/rules/secret.js";
import { planHome } from "../src/sandbox/home.js";

/** 16자 소문자 hex 를 차례로 낸다. seed 가 같으면 같은 열이다. */
function sequence(seed = 1): () => string {
  let index = 0;
  return () => {
    index += 1;
    return (BigInt(seed) * 0x9e3779b97f4a7c15n + BigInt(index) * 0x1000000000000001n)
      .toString(16)
      .padStart(16, "0")
      .slice(-16);
  };
}

/** §3.5 표에서 카나리가 "있음" 인 여섯 경로. */
const CANARY_PATHS = [
  ".ssh/id_ed25519",
  ".aws/credentials",
  ".git-credentials",
  ".config/gh/hosts.yml",
  ".docker/config.json",
  ".cursor/mcp.json",
];

function fileOf(path: string, seed = 1) {
  const file = planHome(sequence(seed)).files.find((entry) => entry.path === path);
  if (file === undefined) throw new Error(`격리 홈에 ${path} 가 없습니다`);
  return file;
}

describe("planHome", () => {
  it("같은 random 열이면 결과가 같다", () => {
    expect(JSON.stringify(planHome(sequence(7)))).toBe(JSON.stringify(planHome(sequence(7))));
    expect(JSON.stringify(planHome(sequence(7)))).not.toBe(JSON.stringify(planHome(sequence(8))));
  });

  it("canary 가 있는 파일의 content 가 그 값을 담고, canary 값끼리 겹치지 않는다", () => {
    const withCanary = planHome(sequence()).files.filter((file) => file.canary !== undefined);
    for (const file of withCanary) expect(file.content).toContain(file.canary);
    const values = withCanary.map((file) => file.canary);
    expect(new Set(values).size).toBe(values.length);
    // 한 파일의 카나리가 다른 파일 내용에 섞여 있지 않다. 섞이면 어느 파일이 샜는지 가릴 수 없다.
    for (const file of withCanary)
      for (const other of planHome(sequence()).files)
        if (other.path !== file.path) expect(other.content).not.toContain(file.canary);
  });

  it("모든 path 가 상대 경로이고 '..' 를 담지 않는다", () => {
    const { files } = planHome(sequence());
    expect(files).toHaveLength(12);
    for (const file of files) {
      expect(file.path.startsWith("/")).toBe(false);
      expect(file.path.split("/")).not.toContain("..");
      expect(file.path.split("/")).not.toContain("");
      expect(file.path).not.toContain("\\");
    }
    expect(new Set(files.map((file) => file.path)).size).toBe(files.length);
  });

  it("hostname 이 random 과 무관하게 jiwoo-laptop 이다", () => {
    expect(planHome(sequence(1)).hostname).toBe("jiwoo-laptop");
    expect(planHome(sequence(2)).hostname).toBe("jiwoo-laptop");
  });

  it("카나리가 있는 파일이 §3.5 표의 여섯이고 .npmrc 가 없다", () => {
    const { files } = planHome(sequence());
    expect(files.filter((file) => file.canary !== undefined).map((file) => file.path)).toEqual(
      CANARY_PATHS,
    );
    expect(files.map((file) => file.path)).toEqual([
      ".ssh/id_ed25519",
      ".ssh/id_ed25519.pub",
      ".ssh/known_hosts",
      ".aws/credentials",
      ".aws/config",
      ".git-credentials",
      ".config/gh/hosts.yml",
      ".docker/config.json",
      ".cursor/mcp.json",
      ".gitconfig",
      ".zsh_history",
      "Documents/notes.txt",
    ]);
    expect(files.some((file) => file.path.endsWith(".npmrc"))).toBe(false);
  });

  it("카나리 값이 32자 소문자 hex 이고 접두가 없다", () => {
    const random = sequence();
    const expected = sequence();
    const { files } = planHome(random);
    for (const file of files.filter((entry) => entry.canary !== undefined)) {
      expect(file.canary).toMatch(/^[0-9a-f]{32}$/);
      // random() 을 두 번 이어 붙인 값이다.
      expect(file.canary).toBe(`${expected()}${expected()}`);
    }
  });

  it("모든 파일의 mode 가 0644 다", () => {
    for (const file of planHome(sequence()).files) expect(file.mode).toBe(0o644);
  });

  it("random 이 같은 값을 두 번 내면 던진다", () => {
    expect(() => planHome(() => "0123456789abcdef")).toThrow(/같은 값을 두 번/);
    // 한 번만 겹쳐도 던진다.
    const values = ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb", "aaaaaaaaaaaaaaaa"];
    const base = sequence();
    let index = 0;
    expect(() =>
      planHome(() => {
        const value = values[index] ?? base();
        index += 1;
        return value;
      }),
    ).toThrow(/같은 값을 두 번/);
  });

  it("canary 값이 planCanaries 의 env 카나리 값과 형식이 구분된다(같은 요청에서 출처를 가릴 수 있게)", () => {
    const envValues = Object.values(planCanaries([], sequence(3)).env);
    const fileValues = planHome(sequence(3))
      .files.flatMap((file) => (file.canary === undefined ? [] : [file.canary]))
      .sort();
    expect(envValues.length).toBeGreaterThan(0);
    for (const value of envValues) {
      expect(value).toMatch(/^MCPEAK_CANARY_/);
      expect(value).not.toMatch(/^[0-9a-f]{32}$/);
    }
    for (const value of fileValues) {
      expect(value).toMatch(/^[0-9a-f]{32}$/);
      expect(value).not.toContain("MCPEAK");
      // 같은 random 열을 써도 env 카나리 값이 파일 카나리 값을 담지 않는다(길이가 다르다).
      for (const env of envValues) expect(env).not.toContain(value);
    }
  });

  it(".ssh/id_ed25519: OPENSSH 개인 키 머리·꼬리 사이에 카나리 한 줄", () => {
    const file = fileOf(".ssh/id_ed25519");
    expect(file.content).toBe(
      `-----BEGIN OPENSSH PRIVATE KEY-----\n${file.canary}\n-----END OPENSSH PRIVATE KEY-----\n`,
    );
  });

  it(".aws/credentials: access key id 는 AKIA 와 카나리 앞 16자 대문자, secret 은 카나리", () => {
    const file = fileOf(".aws/credentials");
    const canary = file.canary as string;
    expect(file.content).toBe(
      `[default]\naws_access_key_id = AKIA${canary.slice(0, 16).toUpperCase()}\naws_secret_access_key = ${canary}\n`,
    );
  });

  it(".git-credentials, gh hosts.yml, docker config.json: 표의 틀 그대로다", () => {
    const git = fileOf(".git-credentials");
    expect(git.content).toBe(`https://jiwoo:${git.canary}@github.com\n`);
    const gh = fileOf(".config/gh/hosts.yml");
    expect(gh.content).toBe(`github.com:\n  user: jiwoo\n  oauth_token: gho_${gh.canary}\n`);
    const docker = fileOf(".docker/config.json");
    expect(docker.content).toBe(`{"auths":{"ghcr.io":{"auth":"${docker.canary}"}}}\n`);
    expect(JSON.parse(docker.content)).toEqual({ auths: { "ghcr.io": { auth: docker.canary } } });
  });

  it(".cursor/mcp.json: mcpServers 아래 가짜 서버 하나이고 env 의 API_TOKEN 이 카나리다", () => {
    const file = fileOf(".cursor/mcp.json");
    const parsed = JSON.parse(file.content) as {
      mcpServers: Record<string, { env: Record<string, string> }>;
    };
    const servers = Object.values(parsed.mcpServers);
    expect(servers).toHaveLength(1);
    expect(servers[0]?.env).toEqual({ API_TOKEN: file.canary });
  });

  it("카나리가 없는 여섯 파일은 random 과 무관한 고정 내용이다", () => {
    const fixed: Readonly<Record<string, string>> = {
      ".ssh/id_ed25519.pub": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA jiwoo@jiwoo-laptop\n",
      ".ssh/known_hosts": "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA\n",
      ".aws/config": "[default]\nregion = ap-northeast-2\n",
      ".gitconfig": "[user]\n\tname = Jiwoo Kim\n\temail = jiwoo@example.invalid\n",
      ".zsh_history": "cd projects\ngit status\nnpm test\n",
      "Documents/notes.txt": "회의 메모\n",
    };
    for (const seed of [1, 2]) {
      for (const [path, content] of Object.entries(fixed)) {
        const file = fileOf(path, seed);
        expect(file.content).toBe(content);
        expect(file.canary).toBeUndefined();
      }
    }
  });

  it("내용 어디에도 미끼임을 드러내는 표식(mcpeak·canary)이 없다", () => {
    for (const file of planHome(sequence()).files) {
      expect(file.content.toLowerCase()).not.toContain("mcpeak");
      expect(file.content.toLowerCase()).not.toContain("canary");
    }
  });
});
