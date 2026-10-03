import type { HomeFile, HomePlan } from "../types.js";

/** 고정이다. 출력에 쓰지 않지만 `random()` 에 기대지 않게 한다. */
const HOSTNAME = "jiwoo-laptop";

/** 진짜 키는 0600 이지만, Linux 의 바인드 마운트에서 컨테이너의 uid 1000 이 읽으려면 0644 여야 한다(§3.5). */
const FILE_MODE = 0o644;

/** 파일 하나의 틀. `content` 가 카나리를 받으면 그 파일이 파일 카나리다. */
type Template =
  | { readonly path: string; readonly content: string }
  | { readonly path: string; readonly withCanary: (canary: string) => string };

/**
 * §3.5 의 표. 순서가 곧 `HomePlan.files` 의 순서이고, 카나리 값을 뽑는 순서다. 내용은 그 서비스의 형식만
 * 닮는다. 값은 무작위라 어느 실제 서비스에서도 유효하지 않다. `.npmrc` 는 두지 않는다. `npx` 가 그 토큰을
 * 읽어 레지스트리로 보내므로 서버가 아니라 실행기의 동작이 유출로 잡힌다.
 */
const TEMPLATES: readonly Template[] = [
  {
    path: ".ssh/id_ed25519",
    withCanary: (canary) =>
      `-----BEGIN OPENSSH PRIVATE KEY-----\n${canary}\n-----END OPENSSH PRIVATE KEY-----\n`,
  },
  {
    path: ".ssh/id_ed25519.pub",
    content: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA jiwoo@jiwoo-laptop\n",
  },
  { path: ".ssh/known_hosts", content: "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA\n" },
  {
    path: ".aws/credentials",
    // access key id 는 카나리의 앞 16자를 다시 쓴다. 이 조각은 따로 대조하지 않는다. 16자짜리 바늘은
    // 우연히 겹칠 수 있고, 비밀 키 쪽 전체 값이 같은 요청에 함께 실린다.
    withCanary: (canary) =>
      `[default]\naws_access_key_id = AKIA${canary.slice(0, 16).toUpperCase()}\naws_secret_access_key = ${canary}\n`,
  },
  { path: ".aws/config", content: "[default]\nregion = ap-northeast-2\n" },
  { path: ".git-credentials", withCanary: (canary) => `https://jiwoo:${canary}@github.com\n` },
  {
    path: ".config/gh/hosts.yml",
    withCanary: (canary) => `github.com:\n  user: jiwoo\n  oauth_token: gho_${canary}\n`,
  },
  {
    path: ".docker/config.json",
    withCanary: (canary) => `{"auths":{"ghcr.io":{"auth":"${canary}"}}}\n`,
  },
  {
    path: ".cursor/mcp.json",
    withCanary: (canary) =>
      `${JSON.stringify(
        {
          mcpServers: {
            "internal-api": {
              command: "npx",
              args: ["-y", "internal-api-mcp"],
              env: { API_TOKEN: canary },
            },
          },
        },
        null,
        2,
      )}\n`,
  },
  { path: ".gitconfig", content: "[user]\n\tname = Jiwoo Kim\n\temail = jiwoo@example.invalid\n" },
  { path: ".zsh_history", content: "cd projects\ngit status\nnpm test\n" },
  { path: "Documents/notes.txt", content: "회의 메모\n" },
];

/**
 * 격리 홈의 계획. 같은 random 열이면 같은 결과다. `random` 은 16자 소문자 hex 를 낸다(`planCanaries` 와
 * 같은 주입). 카나리 값은 `random()` 을 두 번 이어 붙인 32자이고 **접두를 붙이지 않는다.** 파일 내용에
 * 표식이 있으면 열어 본 서버가 미끼임을 안다.
 */
export function planHome(random: () => string): HomePlan {
  const drawn = new Set<string>();
  const draw = (): string => {
    const value = random();
    if (drawn.has(value)) {
      throw new Error(
        "random() 이 같은 값을 두 번 냈습니다. 어느 파일의 값이 샜는지 가리려면 파일 카나리 값은 파일마다 달라야 합니다.",
      );
    }
    drawn.add(value);
    return value;
  };
  const files = TEMPLATES.map((template): HomeFile => {
    if ("content" in template)
      return { path: template.path, content: template.content, mode: FILE_MODE };
    const canary = `${draw()}${draw()}`;
    return { path: template.path, content: template.withCanary(canary), mode: FILE_MODE, canary };
  });
  return { hostname: HOSTNAME, files };
}
