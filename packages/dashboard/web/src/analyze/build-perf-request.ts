/**
 * 성능 상세 → `POST /api/analyze/perf` 의 본문 계약과 화면 문장(ADR-0119). 이 파일이 사양이고 테스트가 전량
 * 단언한다. 버튼 비활성 판정과 제출이 같은 함수를 부른다.
 */

import type { AnalyzePerfRequest } from "../../../src/api-types.js";
import type { Transport } from "../build-test-argv.js";

export interface PerfForm {
  readonly suitePath: string;
  /** 입력창 글자 그대로. 숫자 검사는 buildPerfRequest 가 한다. */
  readonly repeat: string;
  readonly tools: readonly string[];
}

export const INITIAL_PERF_FORM: PerfForm = { suitePath: "", repeat: "5", tools: [] };

/** 원격 대상이면 시작할 수 없는 사유. 아니면 null. perf-command.ts 의 원격 거절 문장과 뜻이 같다. */
export function performanceUnavailable(transport: Transport): string | null {
  return transport === "http"
    ? "원격(HTTP) 서버는 측정할 수 없습니다. 성능 측정은 서버 프로세스 안에 관측 코드를 실어야 해서, 대시보드가 직접 띄우는 stdio 서버만 됩니다."
    : null;
}

/** 시작 버튼 위의 고지. `approved` 는 고른 명세 JSON 에 `approval` 키가 있는지다(runner reporter 와 같은 기준). */
export function perfStartNotice(repeat: number, approved: boolean): readonly string[] {
  return [
    `명세의 성공 케이스를 케이스마다 ${repeat}번 실제로 호출합니다. 쓰기 도구도 포함됩니다.`,
    "격리 없이 이 컴퓨터에서 서버를 띄웁니다.",
    ...(approved
      ? []
      : ["이 명세는 아직 승인되지 않았습니다(approval 없음). 케이스 내용을 확인한 뒤 측정하세요."]),
  ];
}

/** 위반 시 한국어 메시지로 throw. */
export function buildPerfRequest(
  argv: readonly string[],
  serverId: string | undefined,
  transport: Transport,
  form: PerfForm,
): AnalyzePerfRequest {
  const unavailable = performanceUnavailable(transport);
  if (unavailable !== null) throw new Error(unavailable);
  const suitePath = form.suitePath.trim();
  if (suitePath === "") throw new Error("측정할 명세를 고르세요.");
  if (!suitePath.endsWith(".json")) throw new Error("명세 경로는 .json 으로 끝나야 합니다.");
  const repeatText = form.repeat.trim();
  const repeat = Number(repeatText);
  if (!/^\d+$/.test(repeatText) || repeat < 1 || repeat > 100)
    throw new Error("반복 횟수는 1 이상 100 이하의 정수여야 합니다.");
  const tools = form.tools.map((tool) => tool.trim()).filter((tool) => tool !== "");
  return {
    argv,
    ...(serverId === undefined ? {} : { serverId }),
    suitePath,
    repeat,
    ...(tools.length === 0 ? {} : { tools }),
  };
}
