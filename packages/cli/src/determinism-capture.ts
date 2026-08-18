import type { McpClient } from "@ohmymcp/core";
import type { DeterminismCaseObservation, RunnerEvent } from "@ohmymcp/runner";

/**
 * McpClient 를 감싸 응답을 케이스에 귀속시켜 기록한다(설계 §5.1). cassetteClient 와 같은
 * 래퍼 패턴이라 runner 를 고치지 않는다.
 *
 * 귀속은 **호출 시점**의 현재 케이스 인덱스다. executor 는 케이스를 직렬로 돌리지만 응답
 * resolve 는 케이스 경계를 넘을 수 있다(타임아웃 뒤 늦게 도착). 호출 시점에 인덱스를 잡아
 * 두면 늦은 응답이 다음 케이스로 새지 않는다.
 *
 * **호출자에게 돌려주는 값은 언제나 원본이다.** 평문화한 사본은 관찰용으로만 저장한다.
 * executor 가 이 값으로 단언을 평가하므로 여기서 값을 바꾸면 판정이 달라진다.
 */
export interface DeterminismCapture {
  readonly client: McpClient;
  readonly onEvent: (event: RunnerEvent) => void;
  readonly observations: () => readonly DeterminismCaseObservation[];
}

interface Slot {
  caseId: string;
  caseName: string;
  toolName: string | null;
  status: DeterminismCaseObservation["status"];
  assertionStatuses: DeterminismCaseObservation["assertionStatuses"];
  response?: unknown;
  captured: boolean;
}

/**
 * 관찰용 평문 사본. `checkDeterminism` 은 `canonicalJson` 으로 비교하는데 그것은 undefined
 * 필드·비평문 인스턴스·순환 참조를 TypeError 로 거절한다. 캡처 시점에 한 번 통과시켜 두면
 * 비교 단계에서 터지지 않는다. executor 의 `clone` 과 같은 방식이다.
 *
 * 실패하면(순환 참조 등) null 을 돌려주고 호출 측이 캡처를 버린다. 여기서 던지면 부수적
 * 관찰 때문에 1회차 시험 실행이 죽는다.
 */
const plainCopy = (value: unknown): { readonly value: unknown } | null => {
  try {
    return { value: JSON.parse(JSON.stringify(value)) };
  } catch {
    return null;
  }
};

export function createDeterminismCapture(inner: McpClient): DeterminismCapture {
  const slots: Slot[] = [];
  let current = -1;

  const record = (index: number, response: unknown): void => {
    const slot = slots[index];
    if (slot === undefined || slot.captured) return; // 케이스당 호출은 1회. 중복은 버린다.
    const copied = plainCopy(response);
    if (copied === null) return; // 평문화 실패. 응답 없는 관찰이 된다.
    slot.captured = true;
    slot.response = copied.value;
  };

  const onEvent = (event: RunnerEvent): void => {
    if (event.type === "caseStarted") {
      current = event.caseIndex;
      slots[event.caseIndex] = {
        caseId: event.caseId,
        caseName: event.case.name,
        toolName: event.case.operation.type === "callTool" ? event.case.operation.tool : null,
        status: "notRun",
        assertionStatuses: [],
        captured: false,
      };
    } else if (event.type === "caseCompleted") {
      const slot = slots[event.caseIndex];
      if (slot === undefined) return;
      slot.status = event.result.status;
      slot.assertionStatuses = event.result.assertions.map((assertion) => assertion.status);
    } else if (event.type === "suiteCompleted") {
      // 중단된 실행에서 안 돈 케이스는 caseStarted 를 받지 못한다(executor 가 보고서에서만
      // notRun 으로 채운다). 그대로 두면 관찰 수가 스위트 케이스 수보다 적어져, 한쪽만 중단된
      // 두 회차를 비교할 때 checkDeterminism 이 "케이스 수가 다릅니다" 로 던진다. 보고서로
      // 빈자리를 메워 관찰이 언제나 스위트 전체를 덮게 한다(설계 §4.1 의 notRun 제외 규칙).
      event.report.cases.forEach((result, index) => {
        if (slots[index] !== undefined) return;
        slots[index] = {
          caseId: result.spec.id,
          caseName: result.spec.name,
          toolName: result.spec.operation.type === "callTool" ? result.spec.operation.tool : null,
          status: result.status,
          assertionStatuses: result.assertions.map((assertion) => assertion.status),
          captured: false,
        };
      });
    }
  };

  const client: McpClient = {
    listTools: () => {
      const at = current;
      return inner.listTools().then((tools) => {
        record(at, tools);
        return tools;
      });
    },
    callTool: (name, args) => {
      const at = current;
      return inner.callTool(name, args).then((result) => {
        record(at, result);
        return result;
      });
    },
    close: () => inner.close(),
  };

  return {
    client,
    onEvent,
    observations: () =>
      slots.map((slot) => ({
        caseId: slot.caseId,
        caseName: slot.caseName,
        toolName: slot.toolName,
        status: slot.status,
        assertionStatuses: slot.assertionStatuses,
        // 키는 캡처했을 때만 만든다. undefined 로 넣으면 "응답 없음" 판정이 흐려진다.
        ...(slot.captured ? { response: slot.response } : {}),
      })),
  };
}
