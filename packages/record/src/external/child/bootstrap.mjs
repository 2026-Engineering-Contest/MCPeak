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
const ENV_OBSERVER_DIR = "MCPEAK_EXTERNAL_OBSERVER_DIR";

const values = Object.fromEntries(
  Object.entries(ENV_KEYS).map(([name, key]) => [name, process.env[key]]),
);
/**
 * **관측 디렉터리는 지우지 않는다.** 체인의 Node 프로세스마다 관측이 설치되고 각자 자기
 * 파일에 쓴다 — 예전에는 파일 하나라 여럿이 덮어써서 마지막에 끝난 프로세스의 숫자만
 * 남았고, 그것이 런처 자신의 트래픽이었다(ADR-0100).
 *
 * 설정과 달리 **첫 가로챈 호출에서 소비하지도 않는다.** 관측은 그 호출보다 앞에서 나간
 * `node:http` 호출도 세야 하는데, 소비 시점까지 기다리면 서버 부팅 중 호출을 놓친다.
 * 런처의 것이 섞이는 문제는 부모가 `claimed` 로 거른다.
 */
const observerDir = process.env[ENV_OBSERVER_DIR];

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
    // 관측은 어댑터보다 **먼저** 설치해야 부팅 중에 나간 호출도 센다. 다만 기록자 자격은
    // 어댑터가 정하므로, 둘이 같은 상자를 본다.
    //
    // 재생에서만 센다. 녹화는 범위 밖 호출이 실제로 나가는 것이 정상이고(그래서 안 남는다는
    // 사실만 알리면 된다), 재생에서야 "나가면 안 되는데 나갔다" 가 된다.
    const claim = { won: false };
    if (values.mode === "replay" && observerDir !== undefined) {
      installOutOfScopeObserver({
        coordinatorHostHeader: coordinatorUrl.host,
        reportDir: observerDir,
        isClaimed: () => claim.won,
      });
    }
    installFetchAdapter({
      mode: values.mode,
      url: coordinatorUrl.href,
      token: values.token,
      schemaVersion: 1,
      timeoutMs,
      // 프로세스마다 하나. 세션에 저장되지 않고 와이어에만 산다(ADR-0095).
      writerId: randomUUID(),
      onFirstCall: consumeConfiguration,
      onClaim: () => {
        claim.won = true;
      },
    });
  } catch {
    process.stderr.write(
      "오류 [EXTERNAL_BOOTSTRAP_FAILED]: 외부 호출 Adapter를 설치하지 못했습니다.\n",
    );
    throw new Error("EXTERNAL_BOOTSTRAP_FAILED");
  }
}
