import { installFetchAdapter } from "./fetch-adapter.mjs";

const ENV_KEYS = {
  mode: "MCPEAK_EXTERNAL_MODE",
  url: "MCPEAK_EXTERNAL_COORDINATOR_URL",
  token: "MCPEAK_EXTERNAL_COORDINATOR_TOKEN",
  adapters: "MCPEAK_EXTERNAL_ADAPTERS",
  schemaVersion: "MCPEAK_EXTERNAL_SCHEMA_VERSION",
  timeoutMs: "MCPEAK_EXTERNAL_TIMEOUT_MS",
};

const values = Object.fromEntries(
  Object.entries(ENV_KEYS).map(([name, key]) => [name, process.env[key]]),
);
for (const key of Object.values(ENV_KEYS)) delete process.env[key];

const configured = Object.values(values).some((value) => value !== undefined);
if (configured) {
  try {
    if (Object.values(values).some((value) => value === undefined))
      throw new Error("External Bootstrap 설정이 일부만 전달됐습니다.");
    if (values.mode !== "record" && values.mode !== "replay")
      throw new Error("External mode가 올바르지 않습니다.");
    if (values.adapters !== "node.fetch.v1")
      throw new Error("지원하지 않는 External adapter입니다.");
    if (values.schemaVersion !== "1")
      throw new Error("지원하지 않는 External protocol version입니다.");
    const coordinatorUrl = new URL(values.url);
    if (coordinatorUrl.protocol !== "http:" || coordinatorUrl.hostname !== "127.0.0.1")
      throw new Error("Coordinator는 IPv4 loopback HTTP 주소여야 합니다.");
    const timeoutMs = Number(values.timeoutMs);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
      throw new Error("Coordinator timeout이 올바르지 않습니다.");
    installFetchAdapter({
      mode: values.mode,
      url: coordinatorUrl.href,
      token: values.token,
      schemaVersion: 1,
      timeoutMs,
    });
  } catch {
    process.stderr.write(
      "오류 [EXTERNAL_BOOTSTRAP_FAILED]: 외부 호출 Adapter를 설치하지 못했습니다.\n",
    );
    throw new Error("EXTERNAL_BOOTSTRAP_FAILED");
  }
}
