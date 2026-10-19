import type {
  AnalyzeSecurityRequest,
  AnalyzeTokensRequest,
  ServerCandidate,
} from "../../../src/api-types.js";
import { describeRun } from "../run-target.js";
import { buildSecurityRequest, type SecurityForm } from "./build-security-request.js";
import type { AnalyzeTarget } from "./use-analyze-target.js";

/**
 * 한 번에 분석의 두 요청. 버튼 비활성 판정·사유·제출이 같은 함수를 쓴다(기존 두 패널의 규율).
 * 대상 오류가 먼저다. 그 다음 buildSecurityRequest 가 던지는 문장이다. 토큰 요청은 던지지 않는다.
 */
export function buildAnalyzeRequests(
  target: AnalyzeTarget,
  form: SecurityForm,
):
  | { readonly tokens: AnalyzeTokensRequest; readonly security: AnalyzeSecurityRequest }
  | { readonly error: string } {
  if (!("argv" in target.argv)) {
    return { error: target.argv.error };
  }
  const { argv } = target.argv;
  const { serverId } = target;
  // 후보 갈래면 id 를 함께 보낸다. 서버가 그 후보의 env 값을 채운다(Home 과 같다).
  const tokens: AnalyzeTokensRequest = {
    argv,
    ...(serverId === undefined ? {} : { serverId }),
  };
  try {
    return {
      tokens,
      security: buildSecurityRequest(argv, serverId, target.state.transport, form),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 카드의 "분석한 대상: <이름>". 성공한 요청에서 구한다(설계 §3.2). serverId 가 후보에 있으면 그 name,
 * 아니면 describeRun("audit", argv).server, 그것도 없으면 빈 문자열. 폼과 비교하지 않는다. 비교하면 같은
 * 결과를 두 번 그릴 때 글자가 달라진다.
 */
export function describeTarget(
  candidates: readonly ServerCandidate[],
  request: { readonly argv: readonly string[]; readonly serverId?: string },
): string {
  const candidate =
    request.serverId === undefined
      ? undefined
      : candidates.find((item) => item.id === request.serverId);
  return candidate?.name ?? describeRun("audit", request.argv).server ?? "";
}
