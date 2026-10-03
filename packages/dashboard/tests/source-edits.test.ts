import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SourceEdit } from "../src/api-types.js";
import { planSourceEdits, resolveSourceFile } from "../src/server/source-edits.js";

const NOT_FOUND =
  "소스 파일에서 찾지 못했습니다. SDK 나 라이브러리가 만드는 값이면 소스에서 고칠 수 없습니다.";
const UNSUPPORTED = "이 종류의 변경은 자동으로 고치지 않습니다. 직접 고쳐야 합니다.";
const DIFFERENT_AFTER = "같은 문자열을 서로 다르게 바꾸는 변경이 있어 건드리지 않습니다.";
const PROMOTED =
  "공통 파라미터 설명은 서버 instructions 에 사전을 함께 더해야 뜻이 남습니다. 자동으로 고치지 않습니다.";
const SAME_AS_PROMOTED =
  "같은 설명이 공통 파라미터 변경에도 있어 어느 것인지 가릴 수 없습니다. 건드리지 않습니다.";
const OVERLAP = "다른 변경과 같은 자리를 고치게 되어 건드리지 않습니다.";

function cleaned(before: string, after: string, tool = "t"): SourceEdit {
  return { tool, change: { kind: "description-cleaned", path: "description", before, after } };
}

type RemovedReason = Extract<SourceEdit["change"], { kind: "description-removed" }>["reason"];

function removed(before: string, tool = "t", reason: RemovedReason = "restates-name"): SourceEdit {
  return {
    tool,
    change: {
      kind: "description-removed",
      path: "inputSchema.properties.id.description",
      before,
      reason,
    },
  };
}

function keyRemoved(key: string, tool = "t"): SourceEdit {
  return { tool, change: { kind: "schema-key-removed", path: "inputSchema", key } };
}

/** 변경 하나를 반영한 결과 소스. ready 가 아니면 테스트가 틀린 것이라 바로 알린다. */
function applyOne(source: string, edit: SourceEdit): string {
  const plan = planSourceEdits(source, [edit]);
  expect(plan.results.map((result) => result.status)).toEqual(["ready"]);
  return plan.after;
}

function example(relative: string): Promise<string> {
  return readFile(fileURLToPath(new URL(`../../../examples/${relative}`, import.meta.url)), "utf8");
}

describe("planSourceEdits", () => {
  it("description-cleaned 는 따옴표를 지키고 내용만 바꾼다", () => {
    const edit = cleaned("A tool.  ", "A tool.");
    expect(applyOne('description: "A tool.  ",', edit)).toBe('description: "A tool.",');
    expect(applyOne("description: 'A tool.  ',", edit)).toBe("description: 'A tool.',");
    expect(applyOne("description: `A tool.  `,", edit)).toBe("description: `A tool.`,");
  });

  it("after 에 따옴표·개행이 있으면 그 따옴표에 맞게 이스케이프한다", () => {
    // 템플릿 자리표시는 백틱 안에서만 보간이다. 린트가 일반 문자열 속 표기를 실수로 보므로 이어 붙인다.
    const placeholder = `${"$"}{e}`;
    const after = `a "b" 'c' \`d\` ${placeholder} \\ f\ng`;
    const edit = cleaned("x", after);
    expect(applyOne('d: "x"', edit)).toBe(`d: "a \\"b\\" 'c' \`d\` ${placeholder} \\\\ f\\ng"`);
    expect(applyOne("d: 'x'", edit)).toBe(`d: 'a "b" \\'c\\' \`d\` ${placeholder} \\\\ f\\ng'`);
    expect(applyOne("d: `x`", edit)).toBe(`d: \`a "b" 'c' \\\`d\\\` \\${placeholder} \\\\ f\\ng\``);
  });

  it('이스케이프 표기(\\n, \\")로 적힌 리터럴도 찾는다', () => {
    const edit = cleaned('line "one"\ntwo  ', "line one");
    expect(applyOne('description: "line \\"one\\"\\ntwo  ",', edit)).toBe(
      'description: "line one",',
    );
    // 작은따옴표 안에서도 JSON 표기(\")는 같은 값이다.
    expect(applyOne("description: 'line \\\"one\\\"\\ntwo  ',", edit)).toBe(
      "description: 'line one',",
    );
  });

  it("따옴표가 섞여 다른 값이 되는 표기는 리터럴로 세지 않는다", () => {
    // `"a" + "b"` 는 값이 `ab` 인 식이지 내용이 `a" + "b` 인 리터럴이 아니다.
    const source = 'description: "a" + "b",';
    const plan = planSourceEdits(source, [cleaned('a" + "b', "ab")]);
    expect(plan.results[0]?.status).toBe("not-found");
    expect(plan.after).toBe(source);
  });

  it("description-removed 는 .describe(…) 를 통째로 지운다", () => {
    expect(applyOne('id: z.string().describe("id"),', removed("id"))).toBe("id: z.string(),");
    expect(applyOne("id: z.string().describe( 'id', ),", removed("id"))).toBe("id: z.string(),");
  });

  it(".describe(…) 가 줄의 첫 토큰이면 앞 줄의 개행과 들여쓰기까지 지운다", () => {
    const source = 'id: z\n  .string()\n  .uuid()\n  .describe("id"),\nname: z.string(),\n';
    expect(applyOne(source, removed("id"))).toBe(
      "id: z\n  .string()\n  .uuid(),\nname: z.string(),\n",
    );
  });

  it("description-removed 는 description 속성을 지운다", () => {
    expect(applyOne('id: { type: "string", description: "id" }', removed("id"))).toBe(
      'id: { type: "string" }',
    );
    expect(applyOne('"id": {"description": "id", "type": "string"}', removed("id"))).toBe(
      '"id": {"type": "string"}',
    );
  });

  it("빈 properties·required, additionalProperties:true 속성을 지운다", () => {
    expect(applyOne('{ type: "object", properties: {  } }', keyRemoved("properties"))).toBe(
      '{ type: "object" }',
    );
    expect(applyOne('{ type: "object", required: [ ] }', keyRemoved("required"))).toBe(
      '{ type: "object" }',
    );
    expect(
      applyOne(
        '{ type: "object", additionalProperties: true }',
        keyRemoved("additionalProperties"),
      ),
    ).toBe('{ type: "object" }');
  });

  it("값이 비어 있지 않은 properties·required 와 additionalProperties:false 는 찾지 않는다", () => {
    const source =
      '{ properties: { a: {} }, required: ["a"], additionalProperties: false, additionalProperties: trueish }';
    const plan = planSourceEdits(source, [
      keyRemoved("properties"),
      keyRemoved("required"),
      keyRemoved("additionalProperties"),
    ]);
    expect(plan.results.map((result) => result.status)).toEqual([
      "not-found",
      "not-found",
      "not-found",
    ]);
    expect(plan.after).toBe(source);
  });

  it("문자열 값의 $schema·$id·$comment·title 속성을 지운다", () => {
    const source = [
      "{",
      '  $schema: "http://json-schema.org/draft-07/schema#",',
      "  $id: 'urn:x',",
      "  $comment: `note`,",
      '  title: "Input",',
      '  type: "object",',
      "}",
    ].join("\n");
    const plan = planSourceEdits(source, [
      keyRemoved("$schema"),
      keyRemoved("$id"),
      keyRemoved("$comment"),
      keyRemoved("title"),
    ]);
    expect(plan.results.map((result) => result.status)).toEqual([
      "ready",
      "ready",
      "ready",
      "ready",
    ]);
    expect(plan.after).toBe('{\n  type: "object",\n}');
  });

  it("문자열이 아닌 title 값은 찾지 않는다", () => {
    const source = "{ title: name, $id: makeId() }";
    const plan = planSourceEdits(source, [keyRemoved("title"), keyRemoved("$id")]);
    expect(plan.results.map((result) => result.status)).toEqual(["not-found", "not-found"]);
    expect(plan.after).toBe(source);
  });

  it("속성 삭제 규칙 네 가지", () => {
    const edit = keyRemoved("properties");
    expect(applyOne('{ type: "object", properties: {} }', edit)).toBe('{ type: "object" }');
    expect(applyOne('{ properties: {}, type: "object" }', edit)).toBe('{ type: "object" }');
    expect(applyOne("{ properties: {} }", edit)).toBe("{}");
    expect(
      applyOne('    inputSchema: {\n      type: "object",\n      properties: {},\n    },\n', edit),
    ).toBe('    inputSchema: {\n      type: "object",\n    },\n');
  });

  it("키에 따옴표가 있어도 찾는다", () => {
    expect(applyOne('{"type": "object", "properties": {}}', keyRemoved("properties"))).toBe(
      '{"type": "object"}',
    );
    expect(applyOne("{ 'properties': {}, 'type': 'object' }", keyRemoved("properties"))).toBe(
      "{ 'type': 'object' }",
    );
  });

  it("다른 이름의 일부인 키는 찾지 않는다", () => {
    const source = "{ patternProperties: {}, schema.properties: {} }";
    const plan = planSourceEdits(source, [keyRemoved("properties")]);
    expect(plan.results[0]?.status).toBe("not-found");
    expect(plan.after).toBe(source);
  });

  it("출현 수가 0 이면 not-found 이고 소스는 그대로다", () => {
    const source = 'const tool = { description: "B" };\n';
    const plan = planSourceEdits(source, [cleaned("A  ", "A"), keyRemoved("$schema")]);
    expect(plan.results.map((result) => result.status)).toEqual(["not-found", "not-found"]);
    expect(plan.results.map((result) => result.detail)).toEqual([NOT_FOUND, NOT_FOUND]);
    expect(plan.readyCount).toBe(0);
    expect(plan.after).toBe(source);
  });

  it("출현 수가 변경 수와 다르면 ambiguous 이고 건드리지 않는다", () => {
    const source = "a = { properties: {} };\nb = { properties: {} };\nc = { properties: {} };\n";
    const plan = planSourceEdits(source, [
      keyRemoved("properties", "a"),
      keyRemoved("properties", "b"),
    ]);
    const detail =
      "소스에서 3곳을 찾았는데 변경은 2건입니다. 어느 것이 도구 정의인지 가릴 수 없어 건드리지 않습니다.";
    expect(plan.results.map((result) => [result.status, result.detail])).toEqual([
      ["ambiguous", detail],
      ["ambiguous", detail],
    ]);
    expect(plan.readyCount).toBe(0);
    expect(plan.after).toBe(source);
  });

  it("출현 수가 변경 수와 같으면 전부 ready 이고 전부 반영한다", () => {
    const line = '  { type: "object", properties: {} },\n';
    const source = line.repeat(4);
    const plan = planSourceEdits(
      source,
      ["a", "b", "c", "d"].map((tool) => keyRemoved("properties", tool)),
    );
    expect(plan.results.map((result) => [result.status, result.detail])).toEqual(
      Array.from({ length: 4 }, () => ["ready", "소스에서 4곳을 찾았습니다."]),
    );
    expect(plan.readyCount).toBe(4);
    expect(plan.after).toBe('  { type: "object" },\n'.repeat(4));
  });

  it("같은 before 를 다르게 바꾸는 cleaned 는 ambiguous 다", () => {
    const source = 'a = "x  ";\nb = "x  ";\n';
    const plan = planSourceEdits(source, [cleaned("x  ", "x", "a"), cleaned("x  ", "X", "b")]);
    expect(plan.results.map((result) => [result.status, result.detail])).toEqual([
      ["ambiguous", DIFFERENT_AFTER],
      ["ambiguous", DIFFERENT_AFTER],
    ]);
    expect(plan.after).toBe(source);
  });

  it("ready 인 두 그룹의 반영 범위가 겹치면 둘 다 ambiguous 다", () => {
    // 같은 리터럴을 하나는 내용을 바꾸고 하나는 .describe(…) 째로 지운다.
    const source = 'id: z.string().describe("id  "),\n';
    const plan = planSourceEdits(source, [cleaned("id  ", "id"), removed("id  ")]);
    expect(plan.results.map((result) => [result.status, result.detail])).toEqual([
      ["ambiguous", OVERLAP],
      ["ambiguous", OVERLAP],
    ]);
    expect(plan.readyCount).toBe(0);
    expect(plan.after).toBe(source);
  });

  it("reason 이 promoted 인 description-removed 는 소스에 있어도 unsupported 이고 건드리지 않는다", () => {
    // 출현 1곳·변경 1건이라 다른 사유였다면 ready 다.
    const source = 'limit: z.number().describe("최대 개수"),\n';
    expect(planSourceEdits(source, [removed("최대 개수")]).readyCount).toBe(1);

    const edit = removed("최대 개수", "t", "promoted");
    const plan = planSourceEdits(source, [edit]);
    expect(plan.results).toEqual([{ ...edit, status: "unsupported", detail: PROMOTED }]);
    expect(plan.readyCount).toBe(0);
    expect(plan.after).toBe(source);
  });

  it("promoted 는 소스에 없어도 not-found 가 아니라 unsupported 다", () => {
    const source = "const tools = [];\n";
    const plan = planSourceEdits(source, [removed("최대 개수", "t", "promoted")]);
    expect(plan.results.map((result) => [result.status, result.detail])).toEqual([
      ["unsupported", PROMOTED],
    ]);
    expect(plan.after).toBe(source);
  });

  it("promoted 와 같은 before 를 가진 다른 사유 변경은 ambiguous 다", () => {
    const source = 'limit: z.number().describe("최대 개수"),\n';
    const plan = planSourceEdits(source, [
      removed("최대 개수", "a", "restates-name"),
      removed("최대 개수", "b", "promoted"),
    ]);
    expect(plan.results.map((result) => [result.status, result.detail])).toEqual([
      ["ambiguous", SAME_AS_PROMOTED],
      ["unsupported", PROMOTED],
    ]);
    expect(plan.readyCount).toBe(0);
    expect(plan.after).toBe(source);
  });

  it("promoted 와 before 가 같아도 소스에 없으면 not-found 가 먼저다", () => {
    const source = "const tools = [];\n";
    const plan = planSourceEdits(source, [
      removed("최대 개수", "a", "restates-name"),
      removed("최대 개수", "b", "promoted"),
    ]);
    expect(plan.results.map((result) => [result.status, result.detail])).toEqual([
      ["not-found", NOT_FOUND],
      ["unsupported", PROMOTED],
    ]);
  });

  it("promoted 가 섞이면 출현 수가 변경 수와 달라도 공통 파라미터 문장이 먼저다", () => {
    const source = 'a: z.number().describe("최대 개수"),\nb: z.number().describe("최대 개수"),\n';
    const plan = planSourceEdits(source, [
      removed("최대 개수", "a", "restates-name"),
      removed("최대 개수", "b", "promoted"),
    ]);
    expect(plan.results.map((result) => [result.status, result.detail])).toEqual([
      ["ambiguous", SAME_AS_PROMOTED],
      ["unsupported", PROMOTED],
    ]);
    expect(plan.after).toBe(source);
  });

  it("before 가 다른 promoted 는 다른 그룹에 영향을 주지 않는다", () => {
    const source = 'id: z.string().describe("id"),\n';
    const plan = planSourceEdits(source, [removed("id"), removed("최대 개수", "t", "promoted")]);
    expect(plan.results.map((result) => result.status)).toEqual(["ready", "unsupported"]);
    expect(plan.after).toBe("id: z.string(),\n");
  });

  it("지원하지 않는 key 는 unsupported 다", () => {
    const source = "{ default: 1 }";
    const plan = planSourceEdits(source, [keyRemoved("default")]);
    expect(plan.results).toEqual([
      { ...keyRemoved("default"), status: "unsupported", detail: UNSUPPORTED },
    ]);
    expect(plan.after).toBe(source);
  });

  it("안전하게 지울 수 없는 자리의 속성은 unsupported 이고 건드리지 않는다", () => {
    // 값 뒤에 다른 식이 이어진다. 속성만 떼어 내면 문법이 깨진다.
    const source = "{ required: [].concat(extra) }";
    const plan = planSourceEdits(source, [keyRemoved("required")]);
    expect(plan.results.map((result) => [result.status, result.detail])).toEqual([
      ["unsupported", UNSUPPORTED],
    ]);
    expect(plan.after).toBe(source);
  });

  it("results 는 edits 와 같은 순서이고 detail 은 §3.4 문장이다", () => {
    const source = '{ title: "T", properties: {} }\n{ properties: {} }\n';
    const edits = [
      keyRemoved("default"),
      keyRemoved("properties"),
      keyRemoved("$schema"),
      keyRemoved("title"),
    ];
    const plan = planSourceEdits(source, edits);
    expect(plan.results).toEqual([
      { ...edits[0], status: "unsupported", detail: UNSUPPORTED },
      {
        ...edits[1],
        status: "ambiguous",
        detail:
          "소스에서 2곳을 찾았는데 변경은 1건입니다. 어느 것이 도구 정의인지 가릴 수 없어 건드리지 않습니다.",
      },
      { ...edits[2], status: "not-found", detail: NOT_FOUND },
      { ...edits[3], status: "ready", detail: "소스에서 1곳을 찾았습니다." },
    ]);
    expect(plan.readyCount).toBe(1);
    expect(plan.after).toBe("{ properties: {} }\n{ properties: {} }\n");
  });

  it("같은 입력은 같은 결과다", () => {
    const source = '{ title: "T", properties: {} }\nx.describe("id")\n';
    const edits = [keyRemoved("title"), keyRemoved("properties"), removed("id"), cleaned("T", "t")];
    const first = planSourceEdits(source, edits);
    const second = planSourceEdits(source, edits);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("examples/audit-target-server/server.mjs 의 properties 변경 4건이 전부 ready 다", async () => {
    const source = await example("audit-target-server/server.mjs");
    const plan = planSourceEdits(
      source,
      ["a", "b", "c", "d"].map((tool) => keyRemoved("properties", tool)),
    );
    expect(plan.results.map((result) => result.status)).toEqual([
      "ready",
      "ready",
      "ready",
      "ready",
    ]);
    expect(plan.readyCount).toBe(4);
    expect(plan.after).not.toContain("properties: {}");
    expect(plan.after.split('{ type: "object" }').length - 1).toBe(4);
    // 지운 글자 말고는 달라진 데가 없다.
    expect(plan.after).toBe(source.replaceAll(", properties: {} }", " }"));
  });

  it("examples/zod-notes-server/server.mjs 는 describe 1건만 ready 이고 $schema 3건은 not-found 다", async () => {
    const source = await example("zod-notes-server/server.mjs");
    const plan = planSourceEdits(source, [
      keyRemoved("$schema", "get_note"),
      removed("노트 id (UUID)", "get_note"),
      keyRemoved("$schema", "create_note"),
      keyRemoved("$schema", "list_notes"),
    ]);
    expect(plan.results.map((result) => result.status)).toEqual([
      "not-found",
      "ready",
      "not-found",
      "not-found",
    ]);
    expect(plan.readyCount).toBe(1);
    expect(plan.after).not.toContain("노트 id (UUID)");
    expect(plan.after).toBe(
      source.replace(
        '.meta({ examples: [EXAMPLE_ID] })\n          .describe("노트 id (UUID)"),',
        ".meta({ examples: [EXAMPLE_ID] }),",
      ),
    );
    expect(plan.after).not.toBe(source);
  });
});

describe("resolveSourceFile", () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mcpeak-source-edits-"));
    outside = await mkdtemp(join(tmpdir(), "mcpeak-source-edits-outside-"));
    await mkdir(join(root, "srv"));
    await writeFile(join(root, "srv", "server.mjs"), "// server\n");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  const NOT_RESOLVED =
    "실행 명령에서 프로젝트 안의 서버 소스 파일을 찾지 못했습니다.\n해결: 인자에 스크립트 경로가 있어야 합니다(예: node ./server.mjs).";

  it("--arg 의 스크립트 경로를 찾는다", async () => {
    expect(await resolveSourceFile(root, ["--command", "node", "--arg", "srv/server.mjs"])).toEqual(
      { ok: true, absolute: join(root, "srv", "server.mjs"), relative: "srv/server.mjs" },
    );
  });

  it("--command 자체가 스크립트면 그것을 고른다", async () => {
    await writeFile(join(root, "run.py"), "# server\n");
    expect(
      await resolveSourceFile(root, ["--command", "./run.py", "--arg", "srv/server.mjs"]),
    ).toEqual({ ok: true, absolute: join(root, "run.py"), relative: "run.py" });
  });

  it("절대경로도 루트 안이면 받는다", async () => {
    const absolute = join(root, "srv", "server.mjs");
    expect(await resolveSourceFile(root, ["--command", "node", "--arg", absolute])).toEqual({
      ok: true,
      absolute,
      relative: "srv/server.mjs",
    });
  });

  it("--url 이면 원격 문장으로 거절한다", async () => {
    expect(
      await resolveSourceFile(root, [
        "--url",
        "http://localhost:3000/mcp",
        "--arg",
        "srv/server.mjs",
      ]),
    ).toEqual({
      ok: false,
      error: "원격(HTTP) 서버는 소스 파일 위치를 알 수 없어 고칠 수 없습니다.",
    });
  });

  it("루트 밖·node_modules·없는 파일·다른 확장자는 건너뛰고, 남는 게 없으면 찾지 못함 문장이다", async () => {
    await writeFile(join(outside, "server.mjs"), "// outside\n");
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, "node_modules", "pkg", "server.mjs"), "// dep\n");
    await writeFile(join(root, "config.json"), "{}\n");
    await mkdir(join(root, "dir.mjs"));
    const skipped = [
      "--command",
      "node",
      "--arg",
      join(outside, "server.mjs"),
      "--arg",
      "../escape.mjs",
      "--arg",
      "node_modules/pkg/server.mjs",
      "--arg",
      "missing.mjs",
      "--arg",
      "config.json",
      "--arg",
      "dir.mjs",
      // --env 값은 후보가 아니다.
      "--env",
      "srv/server.mjs",
    ];
    expect(await resolveSourceFile(root, skipped)).toEqual({ ok: false, error: NOT_RESOLVED });
    // 건너뛴 뒤에 맞는 후보가 있으면 그것을 고른다.
    expect(await resolveSourceFile(root, [...skipped, "--arg", "srv/server.mjs"])).toEqual({
      ok: true,
      absolute: join(root, "srv", "server.mjs"),
      relative: "srv/server.mjs",
    });
    expect(await resolveSourceFile(root, [])).toEqual({ ok: false, error: NOT_RESOLVED });
  });
});
