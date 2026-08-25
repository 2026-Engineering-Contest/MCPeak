import type { McpClient } from "@mcpeak/core";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_REPORT_BYTES,
  REPORT_PAYLOAD_NOTICE_RATIO,
  type RunnerReport,
  renderReport,
  runSuite,
  type TestSuiteSpec,
} from "../src/index.js";
import { byteLength } from "../src/sanitization.js";

/**
 * 보고서 상한(1MB)은 올릴 수 없고 넘으면 예외로 죽는다. 벽에 닿기 전에 알리는 것이 목적이다(#92).
 * 케이스 수 같은 대리 지표가 아니라 **실제 바이트**로 판정한다. 케이스당 크기는 서버마다 달라
 * 개수로는 벽의 위치를 모른다.
 */
const suite: TestSuiteSpec = {
  schemaVersion: 1,
  id: "payload",
  name: "payload",
  cases: [
    {
      id: "call",
      name: "call",
      operation: { type: "callTool", tool: "get_weather", input: { city: "Seoul" } },
      assertions: [{ type: "isError", expected: false }],
    },
  ],
};
const client = (): McpClient => ({
  listTools: async () => [],
  callTool: async () => ({ content: null, isError: false, raw: { temperature: 21 } }),
  close: async () => {},
});
const baseline = async (): Promise<RunnerReport> => runSuite({ client: client(), suite }).report;

describe("보고서 크기 근접 고지", () => {
  it("상한의 80% 미만이면 payload 키를 만들지 않는다", async () => {
    const report = await baseline();
    expect("payload" in report).toBe(false);
  });

  it("상한의 80% 이상이면 실제 바이트와 상한을 싣는다", async () => {
    const size = byteLength(await baseline());
    const limit = Math.ceil(size / 0.9);
    const report = await runSuite({
      client: client(),
      suite,
      payloadLimits: { maxReportBytes: limit },
    }).report;
    expect(report.payload).toEqual({ reportBytes: size, limitBytes: limit });
  });

  it("80% 경계에서 고지한다. 경계는 포함이다", async () => {
    const size = byteLength(await baseline());
    // size 가 limit 의 80% 이상이 되는 가장 큰 limit. 올림하면 상한이 커져 80% 밑으로 떨어진다.
    const limit = Math.floor(size / REPORT_PAYLOAD_NOTICE_RATIO);
    expect(size).toBeGreaterThanOrEqual(limit * REPORT_PAYLOAD_NOTICE_RATIO);
    const report = await runSuite({
      client: client(),
      suite,
      payloadLimits: { maxReportBytes: limit },
    }).report;
    expect(report.payload?.reportBytes).toBe(size);
  });

  it("reportBytes 는 payload 키를 넣기 전의 크기다. 자기 자신을 세지 않는다", async () => {
    const size = byteLength(await baseline());
    const report = await runSuite({
      client: client(),
      suite,
      payloadLimits: { maxReportBytes: Math.ceil(size / 0.9) },
    }).report;
    const { payload: _payload, ...without } = report;
    expect(byteLength(without)).toBe(report.payload?.reportBytes);
  });

  it("상한 초과 판정도 payload 키를 넣기 전 크기로 한다. 고지 때문에 넘지 않는다", async () => {
    const size = byteLength(await baseline());
    const execution = runSuite({
      client: client(),
      suite,
      payloadLimits: { maxReportBytes: size },
    });
    await expect(execution.report).resolves.toMatchObject({
      payload: { reportBytes: size, limitBytes: size },
    });
  });

  it("기본 상한 1MB 를 상수로 안다", () => {
    expect(DEFAULT_MAX_REPORT_BYTES).toBe(1_048_576);
    expect(REPORT_PAYLOAD_NOTICE_RATIO).toBe(0.8);
  });
});

describe("renderReport 의 보고서 크기 고지", () => {
  const withPayload = async (payload: RunnerReport["payload"]): Promise<RunnerReport> => ({
    ...(await baseline()),
    ...(payload === undefined ? {} : { payload }),
  });

  it("payload 가 없으면 고지 줄이 없다", async () => {
    expect(renderReport(await withPayload(undefined))).not.toContain("보고서 크기");
  });

  it("실제 크기·상한·비율과 조치를 찍는다", async () => {
    const text = renderReport(
      await withPayload({ reportBytes: 870_000, limitBytes: DEFAULT_MAX_REPORT_BYTES }),
    );
    expect(text).toContain(
      "  → 보고서 크기가 850KB 로 상한 1024KB 의 82% 입니다.\n" +
        "    케이스나 응답이 더 커지면 test 실행이 보고서 상한 초과로 실패합니다. 상한은 올릴 수 없습니다.\n" +
        "    툴을 나눠 여러 명세 파일로 만들면 피할 수 있습니다.",
    );
  });

  it("고지는 요약 줄 뒤에 온다", async () => {
    const lines = renderReport(
      await withPayload({ reportBytes: 900_000, limitBytes: DEFAULT_MAX_REPORT_BYTES }),
    ).split("\n");
    const summaryIndex = lines.findIndex((line) => line.includes("total)"));
    const noticeIndex = lines.findIndex((line) => line.includes("보고서 크기"));
    expect(summaryIndex).toBeGreaterThanOrEqual(0);
    expect(noticeIndex).toBeGreaterThan(summaryIndex);
  });
});
