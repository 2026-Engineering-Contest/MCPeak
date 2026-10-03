import { describe, expect, it } from "vitest";
import { extractDeclaredHosts } from "../src/sandbox/declared.js";
import type { CollectedString, Location, SandboxOptions } from "../src/types.js";

type DeclarationTexts = SandboxOptions["declarationTexts"];

const NPM = "registry.npmjs.org";

const TOOL: Location = {
  kind: "tool",
  toolIndex: 0,
  toolName: "get_forecast",
  path: "description",
};

const surface = (raw: string, location: Location = TOOL, isKey = false): CollectedString => ({
  location,
  raw,
  isKey,
});

function extract(input: {
  allowHosts?: readonly string[];
  surfaceStrings?: readonly CollectedString[];
  declarationTexts?: DeclarationTexts;
}): readonly string[] {
  return extractDeclaredHosts({
    allowHosts: input.allowHosts ?? [],
    surfaceStrings: input.surfaceStrings ?? [],
    declarationTexts: input.declarationTexts ?? [],
  });
}

const readme = (text: string): DeclarationTexts => [{ source: "readme", text }];
const packageJson = (value: unknown): DeclarationTexts => [
  { source: "package.json", text: JSON.stringify(value) },
];

describe("extractDeclaredHosts", () => {
  it("--allow-host 값이 소문자로 들어가고 '*.' 항목이 함께 생긴다", () => {
    expect(extract({ allowHosts: ["API.Example.com"] })).toEqual([
      "*.api.example.com",
      "api.example.com",
      NPM,
    ]);
  });

  it("--allow-host 를 주지 않으면 그 항목이 없다", () => {
    expect(extract({})).toEqual([NPM]);
  });

  it("--allow-host 가 이미 '*.' 로 시작하면 그 항목 하나만 생긴다", () => {
    expect(extract({ allowHosts: ["*.example.com", " "] })).toEqual(["*.example.com", NPM]);
  });

  it("설명·README·package.json 에서 온 호스트에는 '*.' 항목이 생기지 않는다", () => {
    const hosts = extract({
      surfaceStrings: [surface("문서: https://docs.example.com/guide")],
      declarationTexts: [
        ...readme("API: https://api.example.com/v1"),
        ...packageJson({ homepage: "https://home.example.com" }),
      ],
    });
    expect(hosts).toEqual(["api.example.com", "docs.example.com", "home.example.com", NPM]);
    expect(hosts.some((host) => host.startsWith("*."))).toBe(false);
  });

  it(".invalid·.example·.local 로 끝나는 이름은 받지 않는다", () => {
    expect(
      extract({
        declarationTexts: readme(
          [
            "https://example.invalid/a",
            "https://api.service.example/b",
            "http://printer.local/c",
            "http://app.localhost:3000/d",
            "https://collect.sandbox-target.example.net/v1",
          ].join("\n"),
        ),
      }),
    ).toEqual(["collect.sandbox-target.example.net", NPM]);
  });

  it("URL 꼴이 아닌 맨 도메인(server.mjs, e.g)은 뽑지 않는다", () => {
    expect(
      extract({
        surfaceStrings: [surface("날씨를 조회합니다 (Open-Meteo). e.g. api.open-meteo.com")],
        declarationTexts: readme("실행: node server.mjs\n호스트 `api.open-meteo.com` 를 부릅니다."),
      }),
    ).toEqual([NPM]);
  });

  it("package.json 의 homepage·repository·bugs 의 호스트를 뽑는다", () => {
    expect(
      extract({
        declarationTexts: packageJson({
          homepage: "https://home.example.com/#readme",
          repository: { type: "git", url: "git+https://github.com/acme/server.git" },
          bugs: { url: "https://bugs.example.com/issues" },
        }),
      }),
    ).toEqual(["bugs.example.com", "github.com", "home.example.com", NPM]);
    expect(
      extract({
        declarationTexts: packageJson({
          repository: "https://gitlab.com/acme/server",
          bugs: "https://tracker.example.com/",
        }),
      }),
    ).toEqual(["gitlab.com", NPM, "tracker.example.com"]);
  });

  it("package.json 의 다른 필드와 깨진 JSON 에서는 뽑지 않는다", () => {
    expect(
      extract({
        declarationTexts: packageJson({
          description: "https://desc.example.com",
          author: { url: "https://author.example.com" },
          scripts: { post: "curl https://script.example.com" },
          repository: "github:acme/server",
        }),
      }),
    ).toEqual([NPM]);
    expect(
      extract({
        declarationTexts: [
          { source: "package.json", text: '{ "homepage": "https://home.example.com"' },
          { source: "package.json", text: "null" },
        ],
      }),
    ).toEqual([NPM]);
  });

  it("README 의 URL 에서 호스트를 뽑고 코드 블록 안의 URL 도 포함한다", () => {
    const text = [
      "# 서버",
      "| `api.open-meteo.com` | https://api.open-meteo.com/v1/forecast | `get_forecast` |",
      "문서는 [여기](https://docs.example.com/guide)에 있습니다. 상태: <https://status.example.com>.",
      "끝에 마침표가 붙은 주소 https://tail.example.com.",
      "```bash",
      "curl 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson'",
      "```",
    ].join("\n");
    expect(extract({ declarationTexts: readme(text) })).toEqual([
      "api.open-meteo.com",
      "docs.example.com",
      "earthquake.usgs.gov",
      NPM,
      "status.example.com",
      "tail.example.com",
    ]);
  });

  it("도구 설명의 URL 호스트를 뽑는다", () => {
    expect(
      extract({
        surfaceStrings: [
          surface("예보를 조회합니다. 출처 https://api.open-meteo.com/v1/forecast"),
          surface("도시 이름. 참고 https://geocoding-api.open-meteo.com", {
            ...TOOL,
            path: "inputSchema.properties.city.description",
          }),
          surface("https://prompt.example.com", {
            kind: "prompt",
            name: "p",
            path: "description",
          }),
          surface("https://resource.example.com", {
            kind: "resource",
            uri: "note://1",
            path: "description",
          }),
          surface("서버 안내 https://instructions.example.com", { kind: "instructions", path: "" }),
        ],
      }),
    ).toEqual([
      "api.open-meteo.com",
      "geocoding-api.open-meteo.com",
      "instructions.example.com",
      "prompt.example.com",
      NPM,
      "resource.example.com",
    ]);
  });

  it("설명이 아닌 표면 문자열(이름·키·기본값·호출 응답)의 URL 은 선언이 아니다", () => {
    expect(
      extract({
        surfaceStrings: [
          surface("https://name.example.com", { ...TOOL, path: "name" }),
          surface("https://default.example.com", {
            ...TOOL,
            path: "inputSchema.properties.url.default",
          }),
          surface("https://key.example.com", TOOL, true),
          surface("https://result.example.com", {
            kind: "result",
            toolIndex: 0,
            toolName: "get_forecast",
            path: "description",
          }),
          surface("https://uri.example.com/x", { kind: "resource", uri: "u", path: "uri" }),
        ],
      }),
    ).toEqual([NPM]);
  });

  it("IP 주소와 localhost 는 선언으로 받지 않는다", () => {
    expect(
      extract({
        declarationTexts: readme(
          [
            "http://127.0.0.1:8080/",
            "http://169.254.169.254/latest/meta-data/",
            "http://[::1]:3000/",
            "http://0x7f.1/",
            "http://localhost:3000/mcp",
            "https://ok.example.com:8443/x",
          ].join(" "),
        ),
      }),
    ).toEqual(["ok.example.com", NPM]);
  });

  it("풀리지 않는 URL 과 호스트 이름 문법에 맞지 않는 것은 버린다", () => {
    expect(
      extract({
        declarationTexts: readme(
          // biome-ignore lint/suspicious/noTemplateCurlyInString: 문서에 적힌 템플릿 모양을 그대로 넣는다.
          "https:// http://<your-domain>/x https://${HOST}/v1 https://exa_mple.com/ https://a..b/",
        ),
      }),
    ).toEqual([NPM]);
  });

  it("결과가 정렬돼 있고 중복이 없다", () => {
    const hosts = extract({
      allowHosts: ["zeta.example.com", "ZETA.example.com", "alpha.example.com"],
      surfaceStrings: [surface("https://Mid.Example.com/a https://mid.example.com/b")],
      declarationTexts: [
        ...readme("https://alpha.example.com https://registry.npmjs.org/pkg"),
        ...packageJson({ homepage: "https://mid.example.com" }),
      ],
    });
    expect(hosts).toEqual([
      "*.alpha.example.com",
      "*.zeta.example.com",
      "alpha.example.com",
      "mid.example.com",
      NPM,
      "zeta.example.com",
    ]);
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it("입력 순서를 섞어도 결과가 같다", () => {
    const texts: DeclarationTexts = [
      ...readme("https://b.example.com https://a.example.com"),
      ...packageJson({ homepage: "https://c.example.com" }),
    ];
    expect(extract({ allowHosts: ["x.io", "y.io"], declarationTexts: texts })).toEqual(
      extract({ allowHosts: ["y.io", "x.io"], declarationTexts: [...texts].reverse() }),
    );
  });

  it("registry.npmjs.org 가 기본으로 들어 있다", () => {
    expect(extract({})).toContain(NPM);
  });
});
