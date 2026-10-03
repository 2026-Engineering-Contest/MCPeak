// 실험용 에이전트 파이프라인의 순수 함수. 프로세스·네트워크·LLM 호출은 여기 없다.
// `mcpeak test --json` 의 결과(TestReport)를 받아 분류·보고서 생성만 한다.

/** 정상 케이스인가. 생성기는 정상 케이스에 `isError: false` 단언을 둔다. */
export function isSuccessCase(c) {
  return c.spec.assertions.some((a) => a.type === "isError" && a.expected === false);
}

/** 실패한 케이스의 오류 문장(서버 응답의 notes)을 모은다. */
export function failureNotes(c) {
  return c.assertions.flatMap((a) => a.diagnostic?.notes ?? []);
}

/**
 * LLM 없이 확정할 수 있는 분류.
 *   - 거절 케이스 실패 → defect (거절해야 할 입력에 성공했다)
 *   - 정상 케이스가 Output validation 오류 → defect (출력 계약 위반)
 *   - 정상 케이스가 서버 거절 메시지로 실패 → 자리값일 수 있으니 "ask" (LLM 에 묻는다)
 */
export function classifyDeterministic(c) {
  if (c.status === "passed") return { kind: "pass" };
  if (!isSuccessCase(c)) return { kind: "defect", reason: "거절해야 할 입력에 성공 응답" };
  const notes = failureNotes(c).join("\n");
  if (/Output validation error/i.test(notes))
    return { kind: "defect", reason: "출력이 선언한 outputSchema 와 다름" };
  if (c.operation?.status !== "completed")
    return { kind: "defect", reason: `호출이 완료되지 않음 (${c.operation?.status})` };
  return { kind: "ask", notes };
}

/** 좁은 LLM 호출의 프롬프트. 툴 이름·보낸 입력·오류 문장만 넣는다. */
export function buildClassifyPrompt({ tool, input, notes, schema }) {
  return [
    "MCP 서버 도구를 정상 입력으로 호출했는데 서버가 거절했다. 두 가지 중 하나로 판정하라.",
    "1) 보낸 값이 스키마상 유효하지만 서버가 모르는 자리값(placeholder)이고, 오류 문장이 쓸 수 있는 값을 알려 준다 → 그 값을 제안한다.",
    "2) 허용돼야 할 입력을 서버가 거절한 것이다 → 결함이다.",
    "",
    `도구: ${tool}`,
    schema ? `inputSchema: ${JSON.stringify(schema)}` : "",
    `보낸 입력: ${JSON.stringify(input)}`,
    `서버 오류:\n${notes}`,
    "",
    "JSON 한 줄로만 답하라. 다른 말은 쓰지 마라.",
    '자리값이면 {"kind":"placeholder","field":"<필드>","value":<서버가 받을 값>}',
    '결함이면 {"kind":"defect","reason":"<한 문장>"}',
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** LLM 응답 파싱. 형식이 어긋나면 안전하게 defect 로 떨어진다. */
export function parseClassifyResponse(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return { kind: "defect", reason: "분류 응답을 해석하지 못함" };
  try {
    const j = JSON.parse(m[0]);
    if (j.kind === "placeholder" && typeof j.field === "string" && "value" in j) return j;
    if (j.kind === "defect") return { kind: "defect", reason: String(j.reason ?? "") };
  } catch {}
  return { kind: "defect", reason: "분류 응답을 해석하지 못함" };
}

/** 픽스처 파일 객체를 만든다. 같은 도구·필드는 나중 값이 이긴다. */
export function buildFixtures(placeholders) {
  const tools = {};
  for (const p of placeholders) {
    tools[p.tool] ??= {};
    tools[p.tool][p.field] = p.value;
  }
  return { schemaVersion: 1, tools };
}

const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

/** task.md 의 보고 형식 그대로 report.md 본문을 만든다. */
export function writeReport({ report, classified, warnings, fixtures, suitePath }) {
  const lines = ["# 검증 보고", ""];
  lines.push(`명세 파일: \`${suitePath}\` (mcpeak generate 로 생성)`);
  if (fixtures && Object.keys(fixtures.tools ?? {}).length > 0)
    lines.push(
      `픽스처: \`mcpeak.fixtures.json\` ${cell(JSON.stringify(fixtures.tools))} 적용 후 재생성`,
    );
  lines.push(
    "",
    "## 케이스",
    "",
    "| 도구 | 케이스 | 입력 | 기대 | 실제 | 판정 |",
    "|---|---|---|---|---|---|",
  );
  for (const c of report.cases) {
    const op = c.spec.operation;
    const tool = op.type === "callTool" ? op.tool : op.type;
    const input = op.type === "callTool" ? JSON.stringify(op.input) : "";
    const expected = isSuccessCase(c) ? "성공" : "거절";
    const cls = classified.get(c.spec.id);
    let actual, verdict;
    if (c.status === "passed") {
      actual = expected;
      verdict = "통과";
    } else {
      const n =
        failureNotes(c)[0] ??
        c.assertions.find((a) => a.status === "failed")?.diagnostic?.message ??
        "";
      actual = `${expected === "성공" ? "거절" : "성공"} (${n})`;
      verdict = cls?.kind === "defect" ? "**실패(결함)**" : "실패";
    }
    lines.push(
      `| ${cell(tool)} | ${cell(c.spec.name)} | \`${cell(input)}\` | ${expected} | ${cell(actual)} | ${verdict} |`,
    );
  }
  lines.push(
    "",
    "## 결함",
    "",
    "| # | 도구 | 위반 축 | 재현 입력 | 설명 |",
    "|---|---|---|---|---|",
  );
  let n = 0;
  for (const c of report.cases) {
    const cls = classified.get(c.spec.id);
    if (cls?.kind !== "defect") continue;
    const op = c.spec.operation;
    lines.push(
      `| ${++n} | ${cell(op.tool)} | ${cell(c.spec.name)} | \`${cell(JSON.stringify(op.input))}\` | ${cell(cls.reason)}. ${cell(failureNotes(c)[0] ?? "")} |`,
    );
  }
  if (n === 0) lines.push("", "결함 없음.");
  lines.push("", "## 검증하지 못한 것", "");
  if (warnings.length === 0) lines.push("없음.");
  for (const w of warnings) lines.push(`- ${cell(w)}`);
  return `${lines.join("\n")}\n`;
}

/** 에이전트가 읽을 한 화면 요약. */
export function summarize({ report, classified, fixtures, llm }) {
  const defects = report.cases.filter((c) => classified.get(c.spec.id)?.kind === "defect");
  const out = [
    `케이스 ${report.summary.total}건: 통과 ${report.summary.passed}, 실패 ${report.summary.failed}`,
  ];
  out.push(`결함 ${defects.length}건`);
  for (const c of defects)
    out.push(`  ✗ ${c.spec.operation.tool}  ${c.spec.name}  ← ${failureNotes(c)[0] ?? ""}`);
  if (fixtures && Object.keys(fixtures.tools ?? {}).length)
    out.push(`픽스처 적용: ${JSON.stringify(fixtures.tools)}`);
  if (llm)
    out.push(
      `내부 LLM 호출 ${llm.calls}회, 입력 ${llm.input_tokens} 출력 ${llm.output_tokens} 토큰, $${llm.cost.toFixed(4)}`,
    );
  out.push("보고서: report.md");
  return out.join("\n");
}
