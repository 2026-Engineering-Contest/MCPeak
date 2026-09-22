import { describe, expect, it } from "vitest";
import { buildRelayAiArgs } from "../src/server/relay-argv.js";

const BASE = { model: "sonnet", url: "http://127.0.0.1:51234/mcp", tag: "c2" } as const;

describe("중계 AI argv", () => {
  it("allowedTools 가 붙는다", () => {
    // 이것이 없으면 `system permission_denied` 가 나고 tools/call 이 한 번도 안 찍힌다(설계 §3).
    const args = buildRelayAiArgs(BASE);
    const at = args.indexOf("--allowedTools");
    expect(at).toBeGreaterThan(-1);
    expect(args[at + 1]).toBe("mcp__target");
  });

  it("mcp-config 의 URL 에 케이스 꼬리표가 붙는다", () => {
    const args = buildRelayAiArgs(BASE);
    const at = args.indexOf("--mcp-config");
    expect(JSON.parse(args[at + 1] as string)).toEqual({
      mcpServers: { target: { type: "http", url: "http://127.0.0.1:51234/mcp?case=c2" } },
    });
  });

  it("내장 도구를 끈 채로 둔다", () => {
    const args = buildRelayAiArgs(BASE);
    const at = args.indexOf("--tools");
    expect(at).toBeGreaterThan(-1);
    expect(args[at + 1]).toBe("");
  });

  it("json-schema 를 붙이지 않는다", () => {
    // 답의 모양을 강제하지 않는다. AI 의 답은 화면에 쓰지 않는다(설계 §5).
    expect(buildRelayAiArgs(BASE)).not.toContain("--json-schema");
  });

  it("모델이 argv 에 그대로 실린다", () => {
    const args = buildRelayAiArgs({ ...BASE, model: "haiku" });
    expect(args[args.indexOf("--model") + 1]).toBe("haiku");
  });

  it("같은 입력은 항상 같은 배열이다", () => {
    expect(buildRelayAiArgs(BASE)).toEqual(buildRelayAiArgs(BASE));
  });

  it("URL 에 이미 쿼리가 있으면 & 로 잇는다", () => {
    const args = buildRelayAiArgs({ ...BASE, url: "http://127.0.0.1:1/mcp?x=1" });
    const config = JSON.parse(args[args.indexOf("--mcp-config") + 1] as string) as {
      mcpServers: { target: { url: string } };
    };
    expect(config.mcpServers.target.url).toBe("http://127.0.0.1:1/mcp?x=1&case=c2");
  });
});
