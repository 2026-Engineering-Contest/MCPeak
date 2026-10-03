/**
 * 폼 → `POST /api/analyze/security` 의 본문 계약(보안 탭 계획서 §5.5). `build-analyze-argv.ts` 와 같은
 * 자리다. 이 파일이 사양이고 테스트가 전량 단언한다. `argv` 는 대상 옵션과 그 값만 싣고, 점검 옵션은
 * 필드로 보낸다. 서버가 경로를 가둔 뒤 CLI argv 로 조립한다(api-types.ts `AnalyzeSecurityRequest`).
 */

import type { AnalyzeSecurityRequest } from "../../../src/api-types.js";
import type { Transport } from "../build-test-argv.js";

export type ProbeChoice = "auto" | "readonly" | "none" | "all";

export interface SecurityForm {
  readonly probe: ProbeChoice;
  readonly baselinePath: string;
  readonly updateBaseline: boolean;
  readonly sandbox: boolean;
  readonly compareHost: boolean;
  readonly allowHosts: readonly string[];
}

export const INITIAL_SECURITY_FORM: SecurityForm = {
  probe: "auto",
  baselinePath: "",
  updateBaseline: false,
  sandbox: false,
  compareHost: false,
  allowHosts: [],
};

/** CLI `audit-command.ts` 의 HOSTNAME 과 같은 식. 길이 상한 253 도 같다. */
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

/** 위반 시 한국어 메시지로 throw. 버튼 비활성 판정과 제출이 같은 함수를 부른다. */
export function buildSecurityRequest(
  argv: readonly string[],
  serverId: string | undefined,
  transport: Transport,
  form: SecurityForm,
): AnalyzeSecurityRequest {
  const baselinePath = form.baselinePath.trim();
  if (baselinePath !== "" && !baselinePath.endsWith(".json")) {
    throw new Error("기준 파일 경로는 .json 으로 끝나야 합니다.");
  }
  // 원격 대상은 격리할 수 없다. 체크가 남아 있어도 싣지 않는다(buildAnalyzeArgv 가 http 에서 args 를 버리는 것과 같다).
  const sandbox = form.sandbox && transport === "stdio";
  if (sandbox) {
    for (const host of form.allowHosts) {
      if (host.length > 253 || !HOSTNAME.test(host)) {
        throw new Error(`허용 호스트는 호스트 이름이어야 합니다(예: api.example.com): '${host}'`);
      }
    }
  }
  return {
    argv,
    ...(serverId === undefined ? {} : { serverId }),
    ...(form.probe === "auto" ? {} : { probe: form.probe }),
    ...(baselinePath === "" ? {} : { baselinePath }),
    // 경로가 없으면 갱신도 없다. CLI 가 거절하는 조합을 보내지 않는다.
    ...(baselinePath !== "" && form.updateBaseline ? { updateBaseline: true } : {}),
    ...(sandbox
      ? { sandbox: { compareHost: form.compareHost, allowHosts: [...form.allowHosts] } }
      : {}),
  };
}
