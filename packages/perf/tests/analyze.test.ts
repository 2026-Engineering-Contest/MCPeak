import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { renderReport } from "../src/report.js";
import { readTrace } from "../src/trace.js";
import type { PerfMeasurement, PerfPlan, PerfReport } from "../src/types.js";

// 설계 §10.1 의 골든. 입력은 계획 §7.4 의 값이고, 기대 파일은 그 손계산과 대조한 것이다.

const GOLDEN = fileURLToPath(new URL("./fixtures/golden/", import.meta.url));
const SECRET = "SECRET_7c1";

async function golden(name: string): Promise<{
  readonly report: () => PerfReport;
  readonly traceText: string;
  readonly expectedJson: string;
  readonly expectedTxt: string;
}> {
  const dir = `${GOLDEN}${name}/`;
  const read = (file: string) => readFile(`${dir}${file}`, "utf8");
  const plan = JSON.parse(await read("plan.json")) as PerfPlan;
  const measurements = JSON.parse(await read("measurements.json")) as PerfMeasurement[];
  const { entries } = await readTrace(dir);
  return {
    report: () =>
      analyze({
        plan,
        measurements,
        trace: entries,
        coldStart: { connectMs: 312, listToolsMs: 4 },
        server: { command: "node examples/live-weather-server/server.mjs", toolCount: 11 },
        generatorVersion: "0.0.0-test",
      }),
    traceText: await read("trace.jsonl"),
    expectedJson: await read("expected.json"),
    expectedTxt: await read("expected.txt"),
  };
}

const json = (report: PerfReport) => `${JSON.stringify(report, null, 2)}\n`;

describe("analyze 골든", () => {
  it("golden/live-weather 의 analyze 결과와 renderReport 결과가 기대 파일과 바이트 단위로 같다", async () => {
    const g = await golden("live-weather");
    const report = g.report();
    expect(json(report)).toBe(g.expectedJson);
    expect(renderReport(report)).toBe(g.expectedTxt);
  });

  it("golden/no-observation 도 같다", async () => {
    const g = await golden("no-observation");
    expect(g.traceText).toBe("");
    const report = g.report();
    expect(json(report)).toBe(g.expectedJson);
    expect(renderReport(report)).toBe(g.expectedTxt);
  });

  it("같은 입력 두 번이 같은 JSON", async () => {
    for (const name of ["live-weather", "no-observation"]) {
      const g = await golden(name);
      expect(json(g.report())).toBe(json(g.report()));
    }
  });

  it("리포트 JSON 과 텍스트 어디에도 비밀 문자열이 없다", async () => {
    const g = await golden("live-weather");
    // 비밀은 trace 의 URL 쿼리·요청 헤더·응답 본문에만 있다(계획 E7).
    expect(g.traceText).toContain(`apikey=${SECRET}`);
    expect(g.traceText).toContain(`"x-api-key":"${SECRET}"`);
    expect(g.traceText).toContain(`\\"note\\":\\"${SECRET}\\"`);
    const report = g.report();
    expect(json(report).includes(SECRET)).toBe(false);
    expect(renderReport(report).includes(SECRET)).toBe(false);
    expect(g.expectedJson.includes(SECRET)).toBe(false);
    expect(g.expectedTxt.includes(SECRET)).toBe(false);
  });
});
