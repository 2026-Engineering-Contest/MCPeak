import type { BaselineTool, Finding } from "../types.js";
import type { computeSurface } from "./index.js";

type Fields = NonNullable<BaselineTool["fields"]>;
type Field = Exclude<keyof Fields, "hints">;

/** 필드 비교 순서. `compareBaseline` 과 같다. 문장과 `evidence` 에 이 순서로 실린다. */
const FIELDS: readonly Field[] = [
  "title",
  "description",
  "inputSchema",
  "outputSchema",
  "annotations",
];

const FIX =
  "서버가 실행 환경을 보고 다른 도구 정의를 내줍니다. 점검을 피하려는 행동입니다. 등록하지 마세요.";

function finding(message: string, evidence: readonly string[]): Finding {
  return {
    ruleId: "surface/environment-dependent",
    severity: "high",
    location: { kind: "surface", path: "" },
    message,
    fix: FIX,
    evidence,
  };
}

function byCodeUnit(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

/**
 * 격리 안과 밖(이 머신)의 표면을 비교한다. 같으면 `[]`. 다르면 도구마다 한 건이다. 비교 재료는
 * `computeSurface` 가 만든 도구 해시와 필드 단위 해시 그대로다(`compareBaseline` 이 쓰는 것과 같다).
 * 그래서 도구 순서, 스키마의 키 순서, 설명의 공백 차이는 차이로 보지 않는다. 서버 이름과 버전도 보지
 * 않는다. 같은 명령으로 띄운 같은 서버다.
 */
export function compareEnvironmentSurface(
  inside: ReturnType<typeof computeSurface>,
  outside: ReturnType<typeof computeSurface>,
): Finding[] {
  if (inside.surfaceHash === outside.surfaceHash) return [];

  const within = new Map(inside.tools.map((tool) => [tool.name, tool]));
  const without = new Map(outside.tools.map((tool) => [tool.name, tool]));
  const names = [...new Set([...within.keys(), ...without.keys()])].sort(byCodeUnit);

  const findings: Finding[] = [];
  for (const name of names) {
    const here = within.get(name);
    const there = without.get(name);
    if (here === undefined || there === undefined) {
      const inner = there === undefined;
      findings.push(
        finding(`도구 '${name}' 이 ${inner ? "격리 안" : "이 머신"} 에만 있습니다`, [
          name,
          inner ? "inside-only" : "outside-only",
        ]),
      );
      continue;
    }
    if (here.hash === there.hash) continue;
    const insideFields = here.fields;
    const outsideFields = there.fields;
    const differing =
      insideFields === undefined || outsideFields === undefined
        ? []
        : FIELDS.filter((field) => insideFields[field] !== outsideFields[field]);
    // 도구 해시는 다른데 필드 해시가 모두 같으면 어느 필드인지 모른다. 조용히 넘기지 않는다.
    const what = differing.length > 0 ? differing : ["정의"];
    findings.push(
      finding(`격리 안과 이 머신에서 도구 '${name}' 의 ${what.join(", ")} 가 다릅니다`, [
        name,
        ...what,
      ]),
    );
  }
  return findings;
}
