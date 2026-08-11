export interface ConnectOptions {
  command: string;
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
  cwd?: string;
  connectTimeoutMs?: number;
  maxMessageBytes?: number;
  maxStderrBytes?: number;
}

export interface ResolvedConnectOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly connectTimeoutMs: number;
  readonly maxMessageBytes: number;
  readonly maxStderrBytes: number;
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

/** 실행 전 입력을 검증하고 외부 변경과 분리된 불변 옵션을 만든다. */
export function resolveConnectOptions(
  input: ConnectOptions,
  platform = process.platform,
): ResolvedConnectOptions {
  assertPlainObject(input, "options");
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
