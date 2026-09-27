import type { ToolDef } from "@mcpeak/core";
import {
  DATA_KEYS,
  isJsonObject,
  isLosslessRemoval,
  type JsonObject,
  joinPath,
  NAME_MAP_KEYS,
} from "./normalize.js";
import { type OptimizedTool, OptimizeError } from "./types.js";

type Verb = "사라졌습니다" | "바뀌었습니다" | "생겼습니다";

interface Violation {
  readonly tool: string;
  readonly path: string;
  readonly key: string;
  readonly verb: Verb;
}

/** 계획서 §7.1: 위반 줄을 이만큼까지 보이고 나머지는 "그 외 N건" 한 줄로 접는다. */
const MAX_VIOLATION_LINES = 5;
const ISSUES_URL = "https://github.com/2026-Engineering-Contest/MCPeak/issues";

/**
 * `schema` 는 §4 의 허용 차이(메타 키 제거, description 내용)를 적용하는 비교,
 * `strict` 는 한 글자도 달라선 안 되는 비교다(outputSchema, default·enum·const 같은 데이터 값).
 */
type Mode = "schema" | "strict";

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => deepEqual(item, b[index]))
    );
  }
  if (isJsonObject(a) && isJsonObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]))
    );
  }
  return false;
}

class Walker {
  readonly violations: Violation[] = [];

  constructor(private readonly tool: string) {}

  report(path: string, key: string, verb: Verb): void {
    this.violations.push({ tool: this.tool, path, key, verb });
  }

  /** `parentPath` 의 `key` 자리 값 두 개를 비교한다. 다르면 가장 깊은 위치를 보고한다. */
  node(parentPath: string, key: string, original: unknown, optimized: unknown, mode: Mode): void {
    const path = joinPath(parentPath, key);
    if (isJsonObject(original) && isJsonObject(optimized)) {
      this.object(path, original, optimized, mode);
    } else if (
      Array.isArray(original) &&
      Array.isArray(optimized) &&
      original.length === optimized.length
    ) {
      original.forEach((item, index) => {
        this.node(path, String(index), item, optimized[index], mode);
      });
    } else if (!deepEqual(original, optimized)) {
      this.report(parentPath, key, "바뀌었습니다");
    }
  }

  private object(path: string, original: JsonObject, optimized: JsonObject, mode: Mode): void {
    for (const [key, value] of Object.entries(original)) {
      if (!Object.hasOwn(optimized, key)) {
        const allowed =
          mode === "schema" && (key === "description" || isLosslessRemoval(key, value, original));
        if (!allowed) this.report(path, key, "사라졌습니다");
        continue;
      }
      this.keyword(path, key, value, optimized[key], mode);
    }
    for (const key of Object.keys(optimized)) {
      if (!Object.hasOwn(original, key)) this.report(path, key, "생겼습니다");
    }
  }

  /** 스키마 객체 안의 키워드 하나. 키워드 종류에 따라 비교 방식이 다르다. */
  private keyword(path: string, key: string, original: unknown, optimized: unknown, mode: Mode) {
    if (mode === "strict") {
      this.node(path, key, original, optimized, mode);
    } else if (key === "description" && typeof optimized === "string") {
      // §4 허용 차이 4: description 은 검증 의미가 없으므로 내용을 비교하지 않는다.
    } else if (DATA_KEYS.has(key)) {
      this.node(path, key, original, optimized, "strict");
    } else if (NAME_MAP_KEYS.has(key) && isJsonObject(original) && isJsonObject(optimized)) {
      // 사전의 키는 속성·정의 이름이다. 하나라도 사라지거나 생기면 계약이 바뀐 것이다.
      const mapPath = joinPath(path, key);
      for (const [name, schema] of Object.entries(original)) {
        if (Object.hasOwn(optimized, name)) this.node(mapPath, name, schema, optimized[name], mode);
        else this.report(mapPath, name, "사라졌습니다");
      }
      for (const name of Object.keys(optimized)) {
        if (!Object.hasOwn(original, name)) this.report(mapPath, name, "생겼습니다");
      }
    } else {
      this.node(path, key, original, optimized, mode);
    }
  }
}

function compareTool(original: ToolDef, optimized: OptimizedTool): Violation[] {
  const walker = new Walker(original.name);
  if (optimized.description !== undefined && typeof optimized.description !== "string") {
    walker.report("", "description", "바뀌었습니다");
  }
  walker.node("", "inputSchema", original.inputSchema, optimized.inputSchema, "schema");
  const hadOutput = original.outputSchema !== undefined;
  const hasOutput = optimized.outputSchema !== undefined;
  if (hadOutput && !hasOutput) walker.report("", "outputSchema", "사라졌습니다");
  else if (!hadOutput && hasOutput) walker.report("", "outputSchema", "생겼습니다");
  else walker.node("", "outputSchema", original.outputSchema, optimized.outputSchema, "strict");
  return walker.violations;
}

function collectViolations(
  original: readonly ToolDef[],
  optimized: readonly OptimizedTool[],
): Violation[] {
  const violations: Violation[] = [];
  const originalNames = new Set(original.map((t) => t.name));
  const optimizedNames = new Set(optimized.map((t) => t.name));
  const missing = original.filter((t) => !optimizedNames.has(t.name));
  const added = optimized.filter((t) => !originalNames.has(t.name));
  for (const tool of missing) {
    violations.push({ tool: tool.name, path: "tools", key: tool.name, verb: "사라졌습니다" });
  }
  for (const tool of added) {
    violations.push({ tool: tool.name, path: "tools", key: tool.name, verb: "생겼습니다" });
  }
  // 이름 집합이 같은데 자리가 다르면 순서가 바뀐 것이다(중복 이름으로 개수만 다른 경우도 여기 걸린다).
  if (missing.length === 0 && added.length === 0) {
    const length = Math.max(original.length, optimized.length);
    for (let index = 0; index < length; index += 1) {
      const before = original[index];
      if (before !== undefined && before.name !== optimized[index]?.name) {
        violations.push({
          tool: before.name,
          path: `tools.${index}`,
          key: "name",
          verb: "바뀌었습니다",
        });
      }
    }
  }
  const byName = new Map<string, OptimizedTool>();
  for (const tool of optimized) if (!byName.has(tool.name)) byName.set(tool.name, tool);
  for (const tool of original) {
    const counterpart = byName.get(tool.name);
    if (counterpart !== undefined) violations.push(...compareTool(tool, counterpart));
  }
  return violations;
}

function renderViolation(v: Violation): string {
  const where = v.path === "" ? v.key : v.path;
  return `→ 도구 '${v.tool}' 의 ${where} 에서 '${v.key}' 가 ${v.verb}.`;
}

/** 계획서 §7.1 문장. 테스트가 글자 단위로 고정한다. */
function renderMessage(violations: readonly Violation[]): string {
  const lines = [
    "→ 압축 결과가 원본과 다른 입력을 받게 됩니다. 이것은 mcpeak optimize 의 결함입니다.",
  ];
  lines.push(...violations.slice(0, MAX_VIOLATION_LINES).map(renderViolation));
  if (violations.length > MAX_VIOLATION_LINES) {
    lines.push(`→ 그 외 ${violations.length - MAX_VIOLATION_LINES}건`);
  }
  lines.push(
    `해결: 오버레이를 쓰지 마세요. 이 메시지와 서버 이름을 이슈로 알려 주세요: ${ISSUES_URL}`,
  );
  return lines.join("\n");
}

/** 게이트 A(계획서 §4). 통과하면 반환값 없음, 실패하면 OptimizeError(LOSSLESS_VIOLATION). */
export function assertLossless(
  original: readonly ToolDef[],
  optimized: readonly OptimizedTool[],
): void {
  const violations = collectViolations(original, optimized);
  if (violations.length > 0) {
    throw new OptimizeError("LOSSLESS_VIOLATION", renderMessage(violations));
  }
}
