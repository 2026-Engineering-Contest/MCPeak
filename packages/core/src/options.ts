export interface StdioConnectOptions {
  command: string;
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
  cwd?: string;
  connectTimeoutMs?: number;
  maxMessageBytes?: number;
  maxStderrBytes?: number;
}

export interface HttpConnectOptions {
  url: string;
  headers?: Readonly<Record<string, string>>;
  connectTimeoutMs?: number;
}

export type ConnectOptions = StdioConnectOptions | HttpConnectOptions;

export interface ResolvedConnectOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly connectTimeoutMs: number;
  readonly maxMessageBytes: number;
  readonly maxStderrBytes: number;
}

export interface ResolvedHttpConnectOptions {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly connectTimeoutMs: number;
}

const OPTION_KEYS = new Set([
  "command",
  "args",
  "env",
  "cwd",
  "connectTimeoutMs",
  "maxMessageBytes",
  "maxStderrBytes",
]);

const HTTP_OPTION_KEYS = new Set(["url", "headers", "connectTimeoutMs"]);

/** RFC 9110 의 field-name token. 헤더 키는 이 문자 집합만 허용한다. */
const HTTP_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** 헤더 값에 들어오면 요청을 쪼갤 수 있는 제어문자. */
const HEADER_CONTROL_PATTERN = /[\r\n\0]/;

const NUMERIC_OPTIONS = {
  connectTimeoutMs: { defaultValue: 10_000, maximum: 60_000 },
  maxMessageBytes: { defaultValue: 10 * 1024 * 1024, maximum: 64 * 1024 * 1024 },
  maxStderrBytes: { defaultValue: 64 * 1024, maximum: 1024 * 1024 },
} as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) throw new TypeError(`${path} must be a plain object`);
}

function assertString(value: unknown, path: string, allowEmpty = false): asserts value is string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
}

function resolveNumber(value: unknown, key: keyof typeof NUMERIC_OPTIONS): number {
  const { defaultValue, maximum } = NUMERIC_OPTIONS[key];
  if (value === undefined) return defaultValue;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    throw new RangeError(`${key} must be a finite integer between 1 and ${maximum}`);
  }
  return value;
}

/** url 이 있으면 Streamable HTTP 연결로 판정한다. command 와의 배타성은 resolve 단계에서 본다. */
export function isHttpConnectOptions(input: ConnectOptions): input is HttpConnectOptions {
  return isPlainObject(input) && "url" in input;
}

/**
 * transport 를 고를 수 없는 입력을 거절한다.
 * 조용히 한쪽을 고르면 사용자가 의도하지 않은 서버에 붙는다.
 */
function assertExactlyOneTransport(input: Record<string, unknown>): void {
  const hasCommand = "command" in input;
  const hasUrl = "url" in input;
  if (hasCommand === hasUrl) {
    throw new TypeError("options must set exactly one of command or url");
  }
}

/** 실행 전 입력을 검증하고 외부 변경과 분리된 불변 옵션을 만든다. */
export function resolveConnectOptions(
  input: StdioConnectOptions,
  platform = process.platform,
): ResolvedConnectOptions {
  assertPlainObject(input, "options");
  assertExactlyOneTransport(input);
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !OPTION_KEYS.has(key)) {
      throw new TypeError(`options.${String(key)} is not supported`);
    }
  }

  assertString(input.command, "command");
  if (platform === "win32" && /\.(cmd|bat)$/i.test(input.command)) {
    throw new TypeError("command must not use a .cmd or .bat executable on win32");
  }

  const args = input.args ?? [];
  if (!Array.isArray(args)) throw new TypeError("args must be an array of strings");
  const copiedArgs = args.map((value, index) => {
    assertString(value, `args[${index}]`, true);
    return value;
  });

  if (input.cwd !== undefined) assertString(input.cwd, "cwd");
  const env = input.env ?? {};
  assertPlainObject(env, "env");
  const copiedEnv: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, value] of Object.entries(env)) {
    assertString(value, `env.${key}`, true);
    copiedEnv[key] = value;
  }

  return Object.freeze({
    command: input.command,
    args: Object.freeze(copiedArgs),
    env: Object.freeze(copiedEnv),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    connectTimeoutMs: resolveNumber(input.connectTimeoutMs, "connectTimeoutMs"),
    maxMessageBytes: resolveNumber(input.maxMessageBytes, "maxMessageBytes"),
    maxStderrBytes: resolveNumber(input.maxStderrBytes, "maxStderrBytes"),
  });
}

/** 자격증명과 fragment 를 거절하고 정규화된 절대 URL 문자열을 만든다. */
function resolveUrl(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("url must be an absolute http or https URL");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("url must be an absolute http or https URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("url must be an absolute http or https URL");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new TypeError("url must not embed credentials; use the headers option");
  }
  if (parsed.hash !== "") {
    throw new TypeError("url must not contain a fragment");
  }
  // "http://host/mcp#" 처럼 hash 가 비었는데 href 에 "#" 만 남는 입력을 정리한다.
  parsed.hash = "";
  return parsed.href;
}

/**
 * 헤더 키를 소문자로 정규화해 복사한다.
 * 값은 어떤 오류 메시지에도 싣지 않는다. Authorization 이 그대로 흘러나오면 안 된다.
 */
function resolveHeaders(value: unknown): Record<string, string> {
  const copied: Record<string, string> = Object.create(null) as Record<string, string>;
  if (value === undefined) return copied;
  assertPlainObject(value, "headers");

  for (const [key, headerValue] of Object.entries(value)) {
    if (!HTTP_TOKEN_PATTERN.test(key)) {
      throw new TypeError(`headers key ${key} is not a valid HTTP token`);
    }
    const normalizedKey = key.toLowerCase();
    if (normalizedKey in copied) {
      throw new TypeError(`headers has a duplicate key: ${normalizedKey}`);
    }
    if (typeof headerValue !== "string") {
      throw new TypeError(`headers.${key} must be a string`);
    }
    if (HEADER_CONTROL_PATTERN.test(headerValue)) {
      throw new TypeError(`headers.${key} must not contain control characters`);
    }
    copied[normalizedKey] = headerValue;
  }
  return copied;
}

/** 소켓을 열기 전에 HTTP 입력을 검증하고 불변 옵션을 만든다. */
export function resolveHttpConnectOptions(input: HttpConnectOptions): ResolvedHttpConnectOptions {
  assertPlainObject(input, "options");
  assertExactlyOneTransport(input);
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !HTTP_OPTION_KEYS.has(key)) {
      throw new TypeError(`options.${String(key)} is not supported`);
    }
  }

  return Object.freeze({
    url: resolveUrl(input.url),
    headers: Object.freeze(resolveHeaders(input.headers)),
    connectTimeoutMs: resolveNumber(input.connectTimeoutMs, "connectTimeoutMs"),
  });
}
