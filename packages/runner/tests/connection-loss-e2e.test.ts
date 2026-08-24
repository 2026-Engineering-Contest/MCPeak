import { fileURLToPath } from "node:url";
import { connectStdio } from "@mcpeak/core";
import { afterEach, describe, expect, it } from "vitest";
import { runSuite } from "../src/index.js";
import { renderReport } from "../src/reporter.js";
import type { TestSuiteSpec } from "../src/spec/types.js";

/**
 * 이슈 #279 의 재현을 실제 프로세스로 확인한다.
 *
 * 가짜 client 로 하는 단위 테스트는 "코드가 `PROCESS_EXITED` 면 멈춘다" 까지만 증명한다.
 * **실제로 그 코드가 오는지**는 core 의 진단 갱신과 SDK 의 거절이 어떤 순서로 오느냐에
 * 달려 있고, 그것은 프로세스를 진짜 죽여 봐야 안다. 연결 상실 판정을 세 코드로 넓힌 근거가
 * 이 순서 문제다(ADR-0073).
 */
const dyingServer = fileURLToPath(new URL("./fixtures/dies-midway.mjs", import.meta.url));

const call = (id: string, expected: boolean): TestSuiteSpec["cases"][number] => ({
  id,
  name: id,
  operation: { type: "callTool", tool: "add", input: { a: 1, b: 2 } },
  assertions: [{ type: "isError", expected }],
});

const suite: TestSuiteSpec = {
  schemaVersion: 1,
  id: "dies",
  name: "중간에 죽는 서버",
  defaultTimeoutMs: 5_000,
  cases: [
    call("add-success", false),
    call("add-missing-a", true),
    call("add-missing-b", true),
    call("add-type-a", true),
    call("add-type-b", true),
  ],
};

const connections = new Set<Awaited<ReturnType<typeof connectStdio>>>();

afterEach(async () => {
  await Promise.all([...connections].map((item) => item.forceClose().catch(() => undefined)));
  connections.clear();
});

describe.sequential("실제로 죽는 서버", () => {
  it("첫 호출에서 멈추고 나머지 4건을 not run 으로 남긴다", async () => {
    const connection = await connectStdio({ command: process.execPath, args: [dyingServer] });
    connections.add(connection);

    const report = await runSuite({ client: connection.client, suite }).report;

    expect(report.stopReason).toMatchObject({ type: "connectionLost", caseId: "add-success" });
    expect(report.cases.map((item) => item.status)).toEqual([
      "failed",
      "notRun",
      "notRun",
      "notRun",
      "notRun",
    ]);
    expect(report.summary).toMatchObject({ total: 5, failed: 1, notRun: 4 });
    // 안 돈 케이스 4건이 거절 근거 미확인 경고에서 빠진다. 서버가 죽어 아무것도 못 한
    // 상황에서 그 경고는 소음이다(#279 곁다리).
    expect(report.summary.rejectionUnverified).toBe(0);
  });

  it("화면이 한 줄로 원인을 말한다", async () => {
    const connection = await connectStdio({ command: process.execPath, args: [dyingServer] });
    connections.add(connection);

    const report = await runSuite({ client: connection.client, suite }).report;
    const stopLine = renderReport(report)
      .split("\n")
      .find((line) => line.startsWith("중단:"));

    // 종료 코드를 관측했는지는 SDK 의 거절과 child 의 exit 이벤트 순서에 달려 있다. 순서를
    // 단언하면 기계에 따라 빨개지므로, 문장이 프로세스 사망을 말하는 것까지 고정한다.
    expect(stopLine).toMatch(
      /^중단: 서버 프로세스가 종료되어 실행을 멈췄습니다\.( \(종료 코드 42\))?$/,
    );
  });
});
