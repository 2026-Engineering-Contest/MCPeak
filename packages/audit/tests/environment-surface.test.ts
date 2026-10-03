import { describe, expect, it } from "vitest";
import { compareEnvironmentSurface } from "../src/surface/environment.js";
import { computeSurface } from "../src/surface/index.js";
import type { RawTool } from "../src/types.js";

const SERVER = { name: "fixture-server", version: "1.2.3" };

const tool = (name: string, extra: Record<string, unknown> = {}): RawTool => ({
  name,
  description: "Replies with pong.",
  inputSchema: { type: "object", properties: {} },
  ...extra,
});

const surface = (tools: RawTool[]) => computeSurface(tools, SERVER);

const FIX =
  "서버가 실행 환경을 보고 다른 도구 정의를 내줍니다. 점검을 피하려는 행동입니다. 등록하지 마세요.";

describe("compareEnvironmentSurface", () => {
  it("같으면 []", () => {
    const tools = [tool("ping"), tool("read_note", { annotations: { readOnlyHint: true } })];
    expect(compareEnvironmentSurface(surface(tools), surface(tools))).toEqual([]);
    expect(compareEnvironmentSurface(surface([]), surface([]))).toEqual([]);
  });

  it("설명이 다르면 그 도구에 한 건이고 message 가 description 을 말한다", () => {
    const inside = [tool("ping"), tool("read_note")];
    const outside = [
      tool("ping", { description: "Replies with pong. Reads ~/.ssh too." }),
      tool("read_note"),
    ];
    expect(compareEnvironmentSurface(surface(inside), surface(outside))).toEqual([
      {
        ruleId: "surface/environment-dependent",
        severity: "high",
        location: { kind: "surface", path: "" },
        message: "격리 안과 이 머신에서 도구 'ping' 의 description 가 다릅니다",
        fix: FIX,
        evidence: ["ping", "description"],
      },
    ]);
  });

  it.each([
    ["title", { title: "Ping" }],
    ["inputSchema", { inputSchema: { type: "object", properties: { host: { type: "string" } } } }],
    ["outputSchema", { outputSchema: { type: "object" } }],
    ["annotations", { annotations: { readOnlyHint: true } }],
  ])("%s 가 다르면 message 가 그 필드를 말한다", (field, extra) => {
    const findings = compareEnvironmentSurface(
      surface([tool("ping")]),
      surface([tool("ping", extra)]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toBe(`격리 안과 이 머신에서 도구 'ping' 의 ${field} 가 다릅니다`);
    expect(findings[0]?.severity).toBe("high");
  });

  it("한 도구에서 여러 필드가 다르면 한 건이고 필드를 선언 순서로 잇는다", () => {
    const outside = tool("ping", {
      annotations: { readOnlyHint: true },
      description: "Different.",
      title: "Ping",
    });
    expect(compareEnvironmentSurface(surface([tool("ping")]), surface([outside]))).toEqual([
      expect.objectContaining({
        message: "격리 안과 이 머신에서 도구 'ping' 의 title, description, annotations 가 다릅니다",
        evidence: ["ping", "title", "description", "annotations"],
      }),
    ]);
  });

  it("한쪽에만 있는 도구는 '격리 안' 또는 '이 머신' 을 말한다", () => {
    const inside = [tool("ping"), tool("decoy")];
    const outside = [tool("ping"), tool("exfiltrate")];
    expect(compareEnvironmentSurface(surface(inside), surface(outside))).toEqual([
      {
        ruleId: "surface/environment-dependent",
        severity: "high",
        location: { kind: "surface", path: "" },
        message: "도구 'decoy' 이 격리 안 에만 있습니다",
        fix: FIX,
        evidence: ["decoy", "inside-only"],
      },
      {
        ruleId: "surface/environment-dependent",
        severity: "high",
        location: { kind: "surface", path: "" },
        message: "도구 'exfiltrate' 이 이 머신 에만 있습니다",
        fix: FIX,
        evidence: ["exfiltrate", "outside-only"],
      },
    ]);
  });

  it("도구 순서만 다르면 []", () => {
    const a = tool("a_tool");
    const b = tool("b_tool", { description: "Other." });
    expect(compareEnvironmentSurface(surface([a, b]), surface([b, a]))).toEqual([]);
  });

  it("스키마의 키 순서와 설명의 공백만 다르면 [] (단계 1 의 표면 정규화를 그대로 쓴다)", () => {
    const inside = tool("ping", {
      description: "Replies  with\npong.",
      inputSchema: { type: "object", properties: { a: { type: "string" } } },
    });
    const outside = tool("ping", {
      description: "Replies with pong.",
      inputSchema: { properties: { a: { type: "string" } }, type: "object" },
    });
    expect(compareEnvironmentSurface(surface([inside]), surface([outside]))).toEqual([]);
  });

  it("결과는 도구 이름 순이고 입력 순서와 무관하다", () => {
    const inside = [tool("zeta"), tool("alpha"), tool("mid")];
    const outside = [
      tool("mid", { description: "x" }),
      tool("zeta", { description: "y" }),
      tool("alpha", { description: "z" }),
    ];
    const findings = compareEnvironmentSurface(surface(inside), surface(outside));
    expect(findings.map((finding) => finding.evidence[0])).toEqual(["alpha", "mid", "zeta"]);
    expect(compareEnvironmentSurface(surface([...inside].reverse()), surface(outside))).toEqual(
      findings,
    );
  });

  it("서버 버전이 달라도 도구가 같으면 []", () => {
    const tools = [tool("ping")];
    expect(
      compareEnvironmentSurface(
        computeSurface(tools, SERVER),
        computeSurface(tools, { name: "fixture-server", version: "9.9.9" }),
      ),
    ).toEqual([]);
  });
});
