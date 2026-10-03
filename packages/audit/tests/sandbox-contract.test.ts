import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as indexModule from "../src/index.js";
import {
  AUDIT_SCHEMA_VERSION,
  AuditError,
  audit,
  BEHAVIOR_RULES,
  compareEnvironmentSurface,
  computeSurface,
  createDockerBackend,
  exfiltratedCanaries,
  extractDeclaredHosts,
  filterNoise,
  NETWORK_RULES,
  parseTrace,
  planCalls,
  planCanaries,
  planHome,
  renderReport,
  runBehaviorRules,
  runNetworkRules,
  sandboxImageTag,
} from "../src/index.js";
import { findForm, needlesFor } from "../src/rules/secret.js";
import { SandboxCleanupError } from "../src/sandbox/backend.js";
import type { AuditReport, Location, RuleFamily } from "../src/types.js";

/** 격리 실행 계약이 `index.ts` 에 더한 값 export. 타입 export 는 런타임에 없으므로 여기 없다. */
const NEW_FUNCTIONS = {
  runBehaviorRules,
  runNetworkRules,
  exfiltratedCanaries,
  compareEnvironmentSurface,
  planCalls,
  planHome,
  extractDeclaredHosts,
  parseTrace,
  filterNoise,
  sandboxImageTag,
  createDockerBackend,
};

describe("격리 실행 공유 계약", () => {
  it.each(Object.entries(NEW_FUNCTIONS))("index 가 %s 를 함수로 내보낸다", (_name, value) => {
    expect(typeof value).toBe("function");
  });

  it("BEHAVIOR_RULES 와 NETWORK_RULES 는 배열이다", () => {
    expect(Array.isArray(BEHAVIOR_RULES)).toBe(true);
    expect(Array.isArray(NETWORK_RULES)).toBe(true);
  });

  it("AUDIT_SCHEMA_VERSION 은 1 그대로다. 올리면 기존 기준 파일이 전부 거절된다", () => {
    expect(AUDIT_SCHEMA_VERSION).toBe(1);
  });

  it("단계 1 의 export 는 그대로 남아 있다", () => {
    for (const value of [audit, renderReport, planCanaries, computeSurface]) {
      expect(typeof value).toBe("function");
    }
  });

  it("카나리 바늘(needlesFor·findForm)을 rules/secret 에서 가져올 수 있고 index 에는 올리지 않는다", () => {
    expect(findForm("x deadbeef y", needlesFor("deadbeef"))).toBe("raw");
    expect(Object.keys(indexModule)).not.toContain("needlesFor");
    expect(Object.keys(indexModule)).not.toContain("findForm");
  });

  it("게이트웨이 진입 파일을 tests 에서 ../sandbox/gateway/server.mjs 로 찾을 수 있다", () => {
    const url = import.meta.resolve("../sandbox/gateway/server.mjs");
    expect(url.endsWith("/packages/audit/sandbox/gateway/server.mjs")).toBe(true);
    expect(existsSync(fileURLToPath(url))).toBe(true);
  });

  it("Dockerfile 이 게이트웨이 옆에 있고 베이스 이미지를 다이제스트로 고정한다", () => {
    const dockerfile = fileURLToPath(new URL("../sandbox/Dockerfile", import.meta.url));
    expect(readFileSync(dockerfile, "utf8")).toMatch(
      /^FROM node:22-bookworm-slim@sha256:[0-9a-f]{64}$/m,
    );
  });

  it("SandboxCleanupError 는 리포트를 실은 AuditError 다", () => {
    const report = { schemaVersion: 1, findings: [] } as unknown as AuditReport;
    const error = new SandboxCleanupError("격리 자원을 다 치우지 못했습니다: 볼륨 1개", report);
    expect(error).toBeInstanceOf(AuditError);
    expect(error.code).toBe("SANDBOX_CLEANUP_FAILED");
    expect(error.name).toBe("SandboxCleanupError");
    expect(error.report).toBe(report);
  });

  it("타입 계약: 새 규칙 가족 둘과 call 위치가 유니온에 들어 있다", () => {
    const families: readonly RuleFamily[] = ["behavior", "network"];
    const location: Location = {
      kind: "call",
      toolIndex: 0,
      toolName: "read_note",
      callId: "path:traversal",
      path: "",
    };
    expect(families).toHaveLength(2);
    expect(location.kind).toBe("call");
  });
});
