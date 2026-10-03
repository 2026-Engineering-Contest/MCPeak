import { probeArguments } from "../probe-args.js";
import type { PlannedCall, RawTool } from "../types.js";

interface Payload {
  readonly name: string;
  readonly value: string;
}

/**
 * §3.3 의 페이로드 표. 가리키는 대상은 전부 **격리 안에만 있는 것**이다. 경로는 격리 홈(§3.5)이고, 주소는
 * `--internal` 네트워크라 어디에도 닿지 않으며, `id` 는 읽기 전용 컨테이너 안에서 사용자 번호를 출력할
 * 뿐이다. 호스트나 외부를 향하는 페이로드는 두지 않는다. 늘릴 때도 이 조건을 지킨다.
 */
const PATH_PAYLOADS: readonly Payload[] = [
  // 허용 디렉터리 밖으로 나가 격리 홈의 파일을 여는가.
  { name: "traversal", value: "../../../../../../../../home/node/.aws/credentials" },
  // 절대 경로를 그대로 여는가.
  { name: "absolute", value: "/home/node/.ssh/id_ed25519" },
];
const URL_PAYLOADS: readonly Payload[] = [
  // 링크 로컬 주소로 접속을 시도하는가.
  { name: "metadata", value: "http://169.254.169.254/latest/meta-data/" },
  // 루프백으로 접속을 시도하는가.
  { name: "loopback", value: "http://127.0.0.1:8080/" },
  // URL 인자로 파일을 여는가.
  { name: "file-scheme", value: "file:///home/node/.git-credentials" },
];
const COMMAND_PAYLOADS: readonly Payload[] = [
  // 인자가 셸로 넘어가 둘째 명령이 실행되는가.
  { name: "separator", value: "mcpeak; id" },
  // 인자가 옵션으로 해석돼 쓰기를 시도하는가(CVE-2025-68144 의 모양).
  { name: "option", value: "--output=/home/node/mcpeak-probe" },
];

const PATH_TOKENS = new Set(["path", "file", "filename", "filepath", "dir", "directory", "folder"]);
const URL_TOKENS = new Set(["url", "uri", "endpoint", "link", "href", "webhook"]);
const URL_FORMATS = new Set(["uri", "url"]);
const COMMAND_TOKENS = new Set([
  "command",
  "cmd",
  "exec",
  "script",
  "shell",
  "args",
  "argv",
  "options",
  "flags",
]);

/** 도구 하나의 페이로드 호출 상한. 호출 하나의 제한이 10초라 자리값 포함 9회면 도구당 최악 90초다. */
const MAX_PAYLOAD_CALLS = 8;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 속성 이름을 `_`·`-`·대소문자 경계로 나눈 마지막 토큰(소문자). `filePath` → `path`. */
function lastToken(name: string): string {
  const tokens = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[_-]+/)
    .filter((token) => token !== "");
  return tokens[tokens.length - 1] ?? "";
}

function isStringType(schema: Record<string, unknown>): boolean {
  const type = schema.type;
  return type === "string" || (Array.isArray(type) && type.includes("string"));
}

/** 속성 하나에 보낼 페이로드. 분류에 걸리지 않으면 []. `format` 이 이름보다 먼저다. */
function payloadsFor(name: string, schema: unknown): readonly Payload[] {
  if (!isObject(schema) || !isStringType(schema)) return [];
  // 서버가 값을 좁혀 선언했고 SDK 가 호출 전에 거절한다.
  if ("enum" in schema || "const" in schema) return [];
  if (typeof schema.format === "string" && URL_FORMATS.has(schema.format)) return URL_PAYLOADS;
  const token = lastToken(name);
  if (PATH_TOKENS.has(token)) return PATH_PAYLOADS;
  if (URL_TOKENS.has(token)) return URL_PAYLOADS;
  if (COMMAND_TOKENS.has(token)) return COMMAND_PAYLOADS;
  return [];
}

/**
 * 격리 안에서 도구 하나에 보낼 호출 열(§3.3). 입력 스키마만으로 정해지므로 같은 스키마에는 언제나 같은
 * 호출 열이 나온다. 첫 호출의 callId 는 "placeholder" 이고 args 는 probeArguments 결과다. 인자를 만들 수
 * 없으면 calls 는 [] 이고 skipped 에 probeArguments 의 reason 이 온다. 그 뒤는 최상위 문자열 속성을 선언
 * 순서로 돌며 표의 페이로드를 하나씩 보낸다. 한 호출은 속성 하나만 바꾼다. 중첩 객체와 배열 안은 보지
 * 않는다. 페이로드 호출이 상한(8)을 넘으면 calls 는 앞 9개(자리값 포함)이고 skipped 가 상한 문장이다.
 */
export function planCalls(tool: RawTool): {
  readonly calls: readonly PlannedCall[];
  readonly skipped?: string;
} {
  const probe = probeArguments(tool.inputSchema);
  if (!probe.ok) return { calls: [], skipped: probe.reason };

  const schema = tool.inputSchema;
  const properties = isObject(schema) && isObject(schema.properties) ? schema.properties : {};
  const payloadCalls: PlannedCall[] = [];
  for (const [name, property] of Object.entries(properties)) {
    for (const payload of payloadsFor(name, property)) {
      payloadCalls.push({
        callId: `${name}:${payload.name}`,
        args: { ...probe.args, [name]: payload.value },
      });
    }
  }

  const calls = [
    { callId: "placeholder", args: probe.args },
    ...payloadCalls.slice(0, MAX_PAYLOAD_CALLS),
  ];
  const dropped = payloadCalls.length - MAX_PAYLOAD_CALLS;
  if (dropped <= 0) return { calls };
  return {
    calls,
    skipped: `도구 '${tool.name}' 의 페이로드 호출 ${dropped}개를 상한(${MAX_PAYLOAD_CALLS}개) 때문에 보내지 않았습니다.`,
  };
}
