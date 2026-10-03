import {
  DATA_KEYS,
  isJsonObject,
  type JsonObject,
  joinPath,
  NAME_MAP_KEYS,
  type StagedTool,
} from "./normalize.js";
import type { ToolChange } from "./types.js";

/** 계획서 §3.2 B-1·B-2 의 1: URL. 괄호로 감싼 URL 은 괄호까지. */
const URL_RE = /\s*\(?\bhttps?:\/\/[^\s)]+\)?/g;
/** 계획서 §3.2 B-1 의 2: 도구 설명의 예시 블록. `e.g.` 는 인자 채우기에 쓰이므로 넣지 않는다. */
const TOOL_EXAMPLE_RE = /\s*(?:\bExamples?|\bExample usage)[:.][\s\S]*$/i;
/**
 * 계획서 §3.2 B-2 의 2: 파라미터 설명의 예시. 글자 그대로 옮겼다. `e.g.` 뒤에도 `[:.]` 가 붙어
 * 있어 `e.g.:` 는 걸리고 `e.g. foo` 는 걸리지 않는다.
 */
const PARAM_EXAMPLE_RE = /\s*(?:\bExamples?|\be\.g\.|\bFor example|\bExample usage)[:.][\s\S]*$/i;
/** 계획서 §3.2 B-2 의 4: 이름 되풀이로 볼 단어 수 상한. 4단어부터는 정보가 섞인다(실험값). */
const RESTATE_MAX_WORDS = 3;

/** 변환 B-1(계획서 §3.2). 도구 설명의 URL·예시 블록을 지우고 공백을 정리한다. */
export function cleanToolDescription(text: string): string {
  return text
    .replace(URL_RE, "")
    .replace(TOOL_EXAMPLE_RE, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const alnum = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

function restatesName(cleaned: string, propertyName: string): boolean {
  const words = cleaned
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(" ")
    .filter(Boolean);
  const name = alnum(propertyName);
  // 이름이 영숫자를 하나도 갖지 않으면(예: `_`) 빈 문자열이 모든 설명에 포함돼 전부 지워진다.
  return name !== "" && words.length <= RESTATE_MAX_WORDS && alnum(cleaned).includes(name);
}

type ParamOutcome =
  | { kind: "kept"; text: string }
  | { kind: "removed"; reason: "restates-name" | "empty" };

/**
 * 변환 B-2(계획서 §3.2). `propertyName` 은 `properties` 사전의 직속 항목일 때만 준다.
 * `$defs`·`items`·`anyOf` 안쪽은 이름을 알 수 없으므로 null 을 넘겨 4를 건너뛴다.
 */
function cleanParameterDescription(text: string, propertyName: string | null): ParamOutcome {
  const cleaned = text
    .replace(URL_RE, "")
    .replace(PARAM_EXAMPLE_RE, "")
    .replace(/\s+/g, " ")
    .trim();
  if (propertyName !== null && restatesName(cleaned, propertyName)) {
    return { kind: "removed", reason: "restates-name" };
  }
  if (cleaned === "") return { kind: "removed", reason: "empty" };
  return { kind: "kept", text: cleaned };
}

function stripNode(
  node: unknown,
  path: string,
  propertyName: string | null,
  changes: ToolChange[],
): unknown {
  if (Array.isArray(node)) {
    return node.map((item, index) => stripNode(item, joinPath(path, String(index)), null, changes));
  }
  if (!isJsonObject(node)) return node;
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    const keyPath = joinPath(path, key);
    if (key === "description" && typeof value === "string") {
      const outcome = cleanParameterDescription(value, propertyName);
      if (outcome.kind === "removed") {
        changes.push({
          kind: "description-removed",
          path: keyPath,
          before: value,
          reason: outcome.reason,
        });
        continue;
      }
      if (outcome.text !== value) {
        changes.push({
          kind: "description-cleaned",
          path: keyPath,
          before: value,
          after: outcome.text,
        });
      }
      out[key] = outcome.text;
    } else if (DATA_KEYS.has(key)) {
      out[key] = value;
    } else if (NAME_MAP_KEYS.has(key) && isJsonObject(value)) {
      const map: JsonObject = {};
      for (const [name, schema] of Object.entries(value)) {
        map[name] = stripNode(
          schema,
          joinPath(keyPath, name),
          key === "properties" ? name : null,
          changes,
        );
      }
      out[key] = map;
    } else {
      out[key] = stripNode(value, keyPath, null, changes);
    }
  }
  return out;
}

/** 변환 B(계획서 §3.2)를 도구 하나에 적용한다. 순수 함수. */
export function stripNoise(tool: StagedTool): StagedTool {
  const changes: ToolChange[] = [];
  let description = tool.description;
  if (typeof description === "string") {
    const before = description;
    const after = cleanToolDescription(before);
    if (after === "") {
      changes.push({ kind: "description-removed", path: "description", before, reason: "empty" });
      description = undefined;
    } else if (after !== before) {
      changes.push({ kind: "description-cleaned", path: "description", before, after });
      description = after;
    }
  }
  const inputSchema = stripNode(tool.inputSchema, "inputSchema", null, changes);
  const { description: _dropped, ...rest } = tool;
  return {
    ...rest,
    ...(description === undefined ? {} : { description }),
    inputSchema,
    changes: [...tool.changes, ...changes],
  };
}
