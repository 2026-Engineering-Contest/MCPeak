import assert from "node:assert/strict";
import { test } from "node:test";
import { renderReport, type ReportInput } from "../src/lib/report-render.ts";
import type { RunRecord } from "../src/lib/aggregate.ts";
import type { FaultId } from "../src/lib/faults.ts";

const TOOL_FAULTS: readonly FaultId[] = ["F1", "F2", "F3", "F4", "F5", "F6"];
const CONTROL_FAULTS: readonly FaultId[] = ["C1", "C2"];

function rec(
  faultId: FaultId,
  condition: RunRecord["condition"],
  attempt: number,
  ok: boolean,
  passCount: number,
): RunRecord {
  return {
    faultId,
    condition,
    attempt,
    verdict: ok ? "success" : "targetStillFailing",
    passCount,
    regressed: [],
    inputTokens: condition === "defect" ? null : 1000 + attempt,
    outputTokens: condition === "defect" ? null : 200 + attempt,
    durationMs: condition === "defect" ? null : 60000 + attempt,
  };
}

/**
 * 도구 결함(F1~F6) 단순 수리 3/30, 진단 수리 20/30 이 되도록 만든 합성 데이터.
 * - plain: F1 의 attempt 1,2,3 만 성공, 나머지 27 회는 실패 → 3/30
 * - diagnosed: F1~F4 는 5 회 모두 성공(20), F5·F6 은 5 회 모두 실패 → 20/30
 */
function buildRecords(): RunRecord[] {
  const records: RunRecord[] = [];

  for (const faultId of [...TOOL_FAULTS, ...CONTROL_FAULTS]) {
    records.push(rec(faultId, "defect", 1, false, 8));
  }

  for (const faultId of TOOL_FAULTS) {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const ok = faultId === "F1" && attempt <= 3;
      records.push(rec(faultId, "plain", attempt, ok, ok ? 12 : 11));
    }
  }
  for (const faultId of TOOL_FAULTS) {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const ok = faultId === "F1" || faultId === "F2" || faultId === "F3" || faultId === "F4";
      records.push(rec(faultId, "diagnosed", attempt, ok, ok ? 12 : 11));
    }
  }

  for (const faultId of CONTROL_FAULTS) {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const ok = attempt <= 3;
      records.push(rec(faultId, "plain", attempt, ok, ok ? 12 : 11));
      records.push(rec(faultId, "diagnosed", attempt, ok, ok ? 12 : 11));
    }
  }

  return records;
}

function buildDetection(): ReportInput["detection"] {
  return {
    F1: { detected: true, evidence: "tools-call-audio 실패가 오디오 mimeType 을 가리킨다", bundleFailures: 2 },
    F2: { detected: true, evidence: "tools-call-image 실패가 이미지 항목을 가리킨다", bundleFailures: 3 },
    F3: { detected: true, evidence: "tools-call-error 실패가 오류 처리 로직을 가리킨다", bundleFailures: 12 },
    F4: { detected: true, evidence: "tools-call-embedded-resource 실패가 uri 누락을 가리킨다", bundleFailures: 1 },
    F5: { detected: false, evidence: null, bundleFailures: 0 },
    F6: { detected: false, evidence: null, bundleFailures: 0 },
    C1: { detected: false, evidence: null, bundleFailures: 0 },
    C2: { detected: false, evidence: null, bundleFailures: 0 },
  };
}

const PREMISES = [
  "결함은 우리가 주입했고, 대상 서버는 공식 참조 서버 하나다",
  "수리 에이전트는 Claude Code + Sonnet 5 하나다",
  "에이전트는 코드 실행을 못 하는 조건이다",
  "mcpeak 은 도구 영역만 본다. 대조 결함 결과가 이 한계를 그대로 보여 준다",
  "반복 5회라 소수의 우연이 숫자를 흔들 수 있다",
];

function buildInput(): ReportInput {
  return {
    records: buildRecords(),
    detection: buildDetection(),
    baselinePassingCount: 12,
    premises: PREMISES,
    fixed: {
      conformanceCommit: "abc1234",
      conformanceVersion: "0.1.16",
      sdkVersion: "1.30.0",
      model: "claude-sonnet-5",
    },
  };
}

test("헤드라인은 도구 결함 단순/진단 수리 성공 수를 정확히 보여준다", () => {
  const out = renderReport(buildInput());
  assert.ok(
    out.includes("도구 결함 수리 성공: 단순 수리 3/30 → 진단 수리 20/30"),
    `헤드라인 줄이 없다:\n${out}`,
  );
});

test("탐지율 줄이 도구 결함 6개 중 탐지 수를 보여준다", () => {
  const out = renderReport(buildInput());
  assert.ok(
    out.includes("처음 보는 결함 서버에서 도구 결함 6개 중 4개 탐지"),
    `탐지율 줄이 없다:\n${out}`,
  );
});

test("대조 결함 표 아래 고정 문장이 그대로 있다", () => {
  const out = renderReport(buildInput());
  assert.ok(
    out.includes("대조 결함은 mcpeak 이 볼 수 없는 영역이라 ②와 ③의 차이가 없어야 정상이다"),
  );
});

test("산문에 em dash(—) 문자가 없다", () => {
  const out = renderReport(buildInput());
  assert.ok(!out.includes("—"), "em dash 문자가 포함되어 있다");
});

test("8개 절 제목이 순서대로 있다", () => {
  const out = renderReport(buildInput());
  const headings = [
    "헤드라인",
    "탐지율",
    "변형별 표",
    "대조 결함",
    "판정 분포",
    "비용",
    "전제와 한계",
    "재현 방법",
  ];
  let lastIndex = -1;
  for (const heading of headings) {
    const index = out.indexOf(heading);
    assert.ok(index !== -1, `"${heading}" 절이 없다`);
    assert.ok(index > lastIndex, `"${heading}" 절이 순서를 벗어났다`);
    lastIndex = index;
  }
});

test("전제와 한계 절에 설계 문서 8절 다섯 항목이 그대로 들어간다", () => {
  const out = renderReport(buildInput());
  for (const premise of PREMISES) {
    assert.ok(out.includes(premise), `전제 문장이 없다: ${premise}`);
  }
});

test("번들 실패 10건 이상인 변형이 있으면 그 사실을 덧붙인다", () => {
  const out = renderReport(buildInput());
  assert.ok(
    out.includes("파일럿에서 번들 실패가 10건 이상인 변형이 있었다(F3). 진단 상한 10건에 걸려 일부 실패가 진단에서 빠졌을 수 있다."),
    `번들 실패 경고 줄이 없다:\n${out}`,
  );
});

test("재현 방법 절에 고정 값이 들어간다", () => {
  const out = renderReport(buildInput());
  assert.ok(out.includes("abc1234"));
  assert.ok(out.includes("0.1.16"));
  assert.ok(out.includes("1.30.0"));
  assert.ok(out.includes("claude-sonnet-5"));
  assert.ok(out.includes("pnpm baseline"));
  assert.ok(out.includes("pnpm report"));
});
