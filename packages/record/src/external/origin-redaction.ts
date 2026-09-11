import {
  LATEST_SENSITIVE_KEYS_VERSION,
  sensitiveKeyIn,
  sensitiveKeysOf,
} from "../shared/sensitive-keys.mjs";
import type { SessionOrigin } from "./session-store.js";

/** `runtime.mjs` 의 `REDACTED` 와 같은 문자열. 웹(`session-origin.ts`)이 다시 적는다. */
export const REDACTED_ARG = "[redacted]";

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FLAG_PATTERN = /^--?([A-Za-z][A-Za-z0-9_-]*)(=([\s\S]*))?$/;

/**
 * 이름 없는 자리의 보루. **접두 + 최소 길이**로 본다. 접두만 보면 `sk-` 같은 짧은 것이 일반
 * 단어에 걸린다. 목록 밖 비밀은 못 잡는다. 그래서 이것은 `--env` 의 대체가 아니라 안전망이다.
 *
 * 순서는 무관하다. 하나라도 맞으면 가린다.
 */
const SECRET_PREFIXES: readonly string[] = [
  "sbp_", // Supabase personal access token
  "sk-", // OpenAI · Anthropic(`sk-ant-`) 등
  "sk_live_",
  "sk_test_",
  "rk_live_",
  "rk_test_", // Stripe secret · restricted
  "ghp_",
  "gho_",
  "ghu_",
  "ghs_",
  "ghr_",
  "github_pat_", // GitHub
  "glpat-", // GitLab
  "xoxb-",
  "xoxp-",
  "xoxa-",
  "xoxr-", // Slack
  "AIza", // Google API key
  "AKIA", // AWS access key id
  "npm_", // npm
  "ntn_",
  "secret_", // Notion
  "hf_", // Hugging Face
  "tvly-", // Tavily
  "pypi-", // PyPI
  "dop_v1_", // DigitalOcean
  "gsk_", // Groq
  "xai-", // xAI
  "SG.", // SendGrid
];
const MIN_SECRET_LENGTH = 20;
/** header.payload.signature. 서명은 비어 있을 수 있다(alg=none). */
const JWT_PATTERN = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

const keys = sensitiveKeysOf(LATEST_SENSITIVE_KEYS_VERSION);

const looksLikeSecretValue = (value: string): boolean =>
  JWT_PATTERN.test(value) ||
  (value.length >= MIN_SECRET_LENGTH && SECRET_PREFIXES.some((prefix) => value.startsWith(prefix)));

/**
 * argv 한 줄에서 비밀 모양을 가린다. 규칙 넷(R1~R4)은 설계 §4.4 에 있다.
 *
 * **이름이 있으면 이름으로, 없으면 모양으로.** 이름 판정은 HTTP 헤더·JSON 키와 같은 민감 키
 * 목록과 같은 매칭이다. 목록이 늘면 여기도 같이 넓어지고, 따로 맞출 것이 없다.
 *
 * matchKey 와 무관하다. 출처는 재생의 재료일 뿐 매칭 입력이 아니므로, 여기서 무엇을 가려도
 * 이미 저장된 세션의 재생은 달라지지 않는다.
 */
export function redactOriginArgs(args: readonly string[]): readonly string[] {
  const out: string[] = [];
  let maskNext = false;
  for (const arg of args) {
    if (maskNext) {
      // R2. 스위치 다음 토큰은 `-` 로 시작해도 가린다. 놓치면 토큰이 저장소에 들어가고,
      // 과하게 가리면 원클릭 재생 대신 입력 폼이 열린다. 비대칭이 크다.
      out.push(REDACTED_ARG);
      maskNext = false;
      continue;
    }
    const flag = FLAG_PATTERN.exec(arg);
    if (flag !== null) {
      // 그룹 1 은 패턴상 필수지만 `noUncheckedIndexedAccess` 가 선택으로 본다.
      const name = flag[1];
      const withValue = flag[2];
      if (name !== undefined && sensitiveKeyIn(keys, name)) {
        if (withValue !== undefined) {
          out.push(`${arg.slice(0, arg.indexOf("="))}=${REDACTED_ARG}`); // R1
        } else {
          out.push(arg);
          maskNext = true; // R2
        }
        continue;
      }
      out.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq > 0) {
      const name = arg.slice(0, eq);
      if (ENV_NAME_PATTERN.test(name) && sensitiveKeyIn(keys, name)) {
        out.push(`${name}=${REDACTED_ARG}`); // R3
        continue;
      }
    }
    out.push(looksLikeSecretValue(arg) ? REDACTED_ARG : arg); // R4
  }
  return Object.freeze(out);
}

export function redactOrigin(origin: SessionOrigin): SessionOrigin {
  return Object.freeze({ ...origin, args: redactOriginArgs(origin.args) });
}
