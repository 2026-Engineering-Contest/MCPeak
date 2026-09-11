import { randomUUID } from "node:crypto";
import { installFetchAdapter } from "./fetch-adapter.mjs";
import { installOutOfScopeObserver } from "./out-of-scope-observer.mjs";

const ENV_KEYS = {
  mode: "MCPEAK_EXTERNAL_MODE",
  url: "MCPEAK_EXTERNAL_COORDINATOR_URL",
  token: "MCPEAK_EXTERNAL_COORDINATOR_TOKEN",
  adapters: "MCPEAK_EXTERNAL_ADAPTERS",
  schemaVersion: "MCPEAK_EXTERNAL_SCHEMA_VERSION",
  timeoutMs: "MCPEAK_EXTERNAL_TIMEOUT_MS",
};

/**
 * 재생에서만 오는 선택 키라 `ENV_KEYS` 와 나눠 둔다. 위 목록은 "하나라도 빠지면 설정이 깨진
 * 것" 이라는 전부-아니면-전무 검사를 받는데, 여기 섞으면 녹화 실행이 그 검사에 걸린다.
 */
const ENV_OBSERVER_PATH = "MCPEAK_EXTERNAL_OBSERVER_PATH";

const values = Object.fromEntries(
  Object.entries(ENV_KEYS).map(([name, key]) => [name, process.env[key]]),
);
const observerPath = process.env[ENV_OBSERVER_PATH];

/**
 * **관측 경로만 지금 지운다.** 관측 사이드카는 파일 하나를 덮어쓰므로 여럿이 쓰면 마지막에
 * 끝난 프로세스의 숫자만 남는다. 이 경로의 런처 환경 정확도는 이번 변경의 범위가 아니라
 * (설계 §3), 지금 동작을 그대로 둔다.
 */
delete process.env[ENV_OBSERVER_PATH];

/**
 * **설정은 지금 지우지 않는다.** 지우면 중간에 낀 Node 런처(`npx`)가 설정을 삼켜 진짜 서버가
 * 빈손으로 뜬다. `NODE_OPTIONS` 는 손자까지 살아서 가므로 서버도 이 파일을 로드하지만,
 * 설정이 없으면 `configured` 가 false 라 조용히 아무것도 하지 않는다. 그것이 녹화 0건의
 * 원인이다(실측 문서 §2, ADR-0095).
 *
 * 대신 어댑터가 **실제로 가로챈 첫 호출**에서 소비한다. 그 시점 뒤에 태어난 자식은 빈손이고,
 * 그 전에 태어난 형제는 Coordinator 의 단일 기록자 판정이 막는다.
 */
const consumeConfiguration = () => {
  for (const key of Object.values(ENV_KEYS)) delete process.env[key];
};

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
      // 프로세스마다 하나. 세션에 저장되지 않고 와이어에만 산다(설계 §4.2).
      writerId: randomUUID(),
      onFirstCall: consumeConfiguration,
    });
    // 재생에서만 센다. 녹화는 범위 밖 호출이 실제로 나가는 것이 정상이고(그래서 안 남는다는
    // 사실만 알리면 된다), 재생에서야 "나가면 안 되는데 나갔다" 가 된다.
    if (values.mode === "replay" && observerPath !== undefined) {
      installOutOfScopeObserver({
        coordinatorHostHeader: coordinatorUrl.host,
        reportPath: observerPath,
      });
    }
  } catch {
    process.stderr.write(
      "오류 [EXTERNAL_BOOTSTRAP_FAILED]: 외부 호출 Adapter를 설치하지 못했습니다.\n",
    );
    throw new Error("EXTERNAL_BOOTSTRAP_FAILED");
  }
}
