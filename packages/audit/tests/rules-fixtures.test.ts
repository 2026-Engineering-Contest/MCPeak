import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerMessage } from "@mcpeak/core";
import { describe, expect, it } from "vitest";
import { collectStrings } from "../src/collect.js";
import { runDescRules } from "../src/rules/description.js";
import { runFlowRules } from "../src/rules/flow.js";
import { runLaunchRules } from "../src/rules/launch.js";
import { runProtocolRules } from "../src/rules/protocol.js";
import { collectResultStrings, runResultRules, type ToolCallResult } from "../src/rules/result.js";
import { runSchemaRules } from "../src/rules/schema.js";
import { planCanaries, runSecretRules } from "../src/rules/secret.js";
import { compareBaseline, computeSurface, parseBaseline } from "../src/surface/index.js";
import type { AuditBaseline, AuditTarget, Finding, RawTool } from "../src/types.js";
import { fakeFetch, type Route } from "./helpers/fake-fetch.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MALICIOUS = join(HERE, "fixtures", "malicious");
const BENIGN = join(HERE, "fixtures", "benign");

/**
 * §8.1 픽스처의 전체 꼴. 기본 키(serverName·tools·prompts·resources·instructions·expect)에 더해
 * 가족마다 덧붙인 키가 있다(T3·T4 보고서의 "픽스처" 절, result 는 이 태스크).
 */
interface Fixture {
  readonly serverName?: string;
  readonly tools?: RawTool[];
  readonly prompts?: Record<string, unknown>[];
  readonly resources?: Record<string, unknown>[];
  readonly instructions?: string;
  /** launch: runLaunchRules 에 넘긴다. */
  readonly target?: AuditTarget;
  /** secret: 카나리 값 차례와 사용자가 넘긴 실제 값. */
  readonly secret?: { readonly random: string[]; readonly forwarded: Record<string, string> };
  /** surface: 기준 파일 내용. */
  readonly baseline?: AuditBaseline;
  /** protocol: 서버 연결 없이 runProtocolRules 에 직접 넘긴다. fetch 는 가짜 fetch 의 응답표. */
  readonly protocolContext?: {
    readonly target: AuditTarget;
    readonly fetch?: Route[];
    readonly serverMessages?: ServerMessage[];
    readonly listChanged?: {
      readonly notified: boolean;
      readonly surfaceHashBefore: string;
      readonly surfaceHashAfter: string;
    };
  };
  /** result: 호출 결과. runResultRules 에 넘기고, 응답 문자열은 secret 에도 넣는다. */
  readonly results?: ToolCallResult[];
  readonly maxMessageBytes?: number;
  readonly expect?: { readonly ruleId: string; readonly count: number };
}

const DEFAULT_MAX_MESSAGE_BYTES = 10 * 1024 * 1024;

/** 카나리 기본 차례. 픽스처에 secret 키가 없을 때 쓴다. 값은 어느 설명에도 나오지 않는다. */
function sequence(values: readonly string[] | undefined): () => string {
  let index = 0;
  return () => {
    const value = values?.[index] ?? `00000000${(index + 1).toString(16).padStart(8, "0")}`;
    index += 1;
    return value;
  };
}

/**
 * 픽스처 하나에 모든 가족을 돌린다. 도구 목록 계열(desc·schema·flow·secret)은 언제나 돌고, 나머지는
 * 픽스처에 그 재료(target·baseline·protocolContext·results)가 있을 때만 돈다. 재료 없이 돌리면
 * 판정할 것이 없기 때문이다(예: launch 는 target 이 있어야 의미가 있다).
 */
async function runAll(fixture: Fixture): Promise<Finding[]> {
  const serverName = fixture.serverName ?? "fixture-server";
  const tools = fixture.tools ?? [];
  const listStrings = collectStrings({
    tools,
    prompts: fixture.prompts ?? [],
    resources: fixture.resources ?? [],
    instructions: fixture.instructions,
  });
  const results = fixture.results ?? [];
  const forwarded = fixture.secret?.forwarded ?? {};
  const plan = planCanaries(Object.keys(forwarded), sequence(fixture.secret?.random));

  const findings: Finding[] = [
    ...runDescRules(listStrings, { serverName }),
    ...runSchemaRules(tools),
    ...runFlowRules(tools),
    ...runSecretRules([...listStrings, ...collectResultStrings(results)], plan, forwarded),
    ...runResultRules(results, fixture.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES),
  ];
  if (fixture.target !== undefined) findings.push(...runLaunchRules(fixture.target));
  if (fixture.baseline !== undefined) {
    const baseline = parseBaseline(JSON.stringify(fixture.baseline));
    const current = computeSurface(tools, { name: serverName, version: "1.0.0" });
    findings.push(...compareBaseline(baseline, current, tools));
  }
  if (fixture.protocolContext !== undefined) {
    const context = fixture.protocolContext;
    findings.push(
      ...(await runProtocolRules({
        target: context.target,
        fetch: fakeFetch(context.fetch ?? []).fetch,
        serverMessages: context.serverMessages ?? [],
        listChanged: context.listChanged ?? {
          notified: false,
          surfaceHashBefore: "h1",
          surfaceHashAfter: "h1",
        },
      })),
    );
  }
  return findings;
}

const read = (path: string): Fixture => JSON.parse(readFileSync(path, "utf8")) as Fixture;

const maliciousFiles = readdirSync(MALICIOUS)
  .filter((file) => file.endsWith(".json"))
  .sort();

const describeFinding = (finding: Finding) =>
  `${finding.severity} ${finding.ruleId} @ ${finding.location.kind}:${finding.location.path} → ${finding.message}`;

describe("malicious 픽스처", () => {
  it.each(maliciousFiles)("%s: 기대 규칙이 정확히 1건이고 다른 규칙은 0건이다", async (file) => {
    const fixture = read(join(MALICIOUS, file));
    expect(fixture.expect, `${file} 에 expect 가 없습니다`).toBeDefined();
    const findings = await runAll(fixture);
    // 실패하면 무엇이 더 걸렸는지 그대로 보이게 문장 목록으로 비교한다.
    expect(findings.map(describeFinding)).toEqual([
      expect.stringContaining(` ${fixture.expect?.ruleId} @ `),
    ]);
    expect(fixture.expect?.count).toBe(1);
  });

  it("규칙 가족마다 픽스처가 하나 이상 있다", () => {
    const families = new Set(maliciousFiles.map((file) => file.split("-")[0]));
    expect([...families].sort()).toEqual([
      "desc",
      "flow",
      "launch",
      "protocol",
      "result",
      "schema",
      "secret",
      "surface",
    ]);
  });
});

/** 심각도 info 와 flow 가족을 뺀 발견. english-real-shapes 의 통과 기준이다(§8.1). */
const material = (findings: readonly Finding[]) =>
  findings.filter((finding) => finding.severity !== "info" && !finding.ruleId.startsWith("flow/"));

describe("benign 픽스처", () => {
  it("english-real-shapes.json 에서 info·flow 를 제외한 발견이 0건이다", async () => {
    const fixture = read(join(BENIGN, "english-real-shapes.json"));
    expect(fixture.tools).toHaveLength(21);
    expect(material(await runAll(fixture)).map(describeFinding)).toEqual([]);
  });

  it("korean-examples.json 에서 발견이 0건이다", async () => {
    const { servers } = JSON.parse(readFileSync(join(BENIGN, "korean-examples.json"), "utf8")) as {
      servers: Fixture[];
    };
    expect(servers.map((server) => server.serverName)).toEqual([
      "example-weather-server",
      "example-zod-notes-server",
      "example-live-weather-server",
      "example-mock-server",
    ]);
    const found: string[] = [];
    for (const server of servers)
      found.push(
        ...(await runAll(server)).map((f) => `${server.serverName}: ${describeFinding(f)}`),
      );
    // 계획서 §8.1 은 "발견 0" 이지만, live-weather 의 search_city 는 제약 없는 `query` 인자를 실제로
    // 갖고 있어 schema/over-broad 의 두 번째 조건(info, T2·§9.4 결정)이 걸린다. 예제를 옮긴 것이라
    // 픽스처를 고치면 거짓이 된다. 그 한 건만 글자 그대로 허용하고, 다른 발견은 하나도 허용하지 않는다.
    expect(found).toEqual([
      "example-live-weather-server: info schema/over-broad @ tool:inputSchema.properties.query → 입력 제약이 없는 질의 인자입니다: 'query'",
    ]);
  });

  it("fixtures/tools-list.sample.json 에서 발견이 0건이다", async () => {
    const sample = read(join(HERE, "..", "..", "..", "fixtures", "tools-list.sample.json"));
    expect((await runAll({ ...sample, serverName: "sample" })).map(describeFinding)).toEqual([]);
  });
});

/** 도구 목록 계열 픽스처의 도구를 전부 모은 큰 서버 하나. 가족 간 상호작용까지 결정론을 본다. */
function everyTool(): RawTool[] {
  return maliciousFiles.flatMap((file) => read(join(MALICIOUS, file)).tools ?? []);
}

/** toolIndex 를 지우고 toolName 으로 다시 정렬한 비교용 꼴. */
function byToolName(findings: readonly Finding[]): unknown[] {
  return findings
    .map((finding) => {
      const { location } = finding;
      const name = "toolName" in location ? location.toolName : "";
      const rest =
        location.kind === "tool" || location.kind === "result"
          ? { kind: location.kind, toolName: location.toolName, path: location.path }
          : location;
      return { name, finding: { ...finding, location: rest } };
    })
    .sort((left, right) =>
      JSON.stringify([left.name, left.finding]) < JSON.stringify([right.name, right.finding])
        ? -1
        : 1,
    )
    .map((entry) => entry.finding);
}

describe("결정론", () => {
  it("같은 입력에 두 번 돌린 findings 가 깊은 비교로 같다", async () => {
    const fixture: Fixture = { serverName: "determinism", tools: everyTool() };
    expect(await runAll(fixture)).toEqual(await runAll(fixture));
  });

  it("도구 순서를 뒤집어 넣어도 findings 를 toolName 기준으로 다시 정렬하면 같다", async () => {
    const tools = everyTool();
    const forward = await runAll({ serverName: "determinism", tools });
    const backward = await runAll({ serverName: "determinism", tools: [...tools].reverse() });
    expect(forward.length).toBeGreaterThan(0);
    expect(byToolName(backward)).toEqual(byToolName(forward));
  });
});
