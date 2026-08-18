import type { RunEvent, RunStatus, RunSummary, StartRunRequest } from "../api-types.js";
import { ansiToHtml } from "./ansi.js";
import { WebReviewIO } from "./review-bridge.js";

export interface RunHandle {
  readonly runId: string;
  readonly summary: RunSummary;
  /** 지금까지의 전체 이벤트. SSE 늦은 구독자 재전송용. */
  readonly events: readonly RunEvent[];
  subscribe(listener: (event: RunEvent) => void): () => void;
  readonly reviewIO: WebReviewIO;
}

/** execute에 주입되는 IO 묶음 */
export interface RunIo {
  readonly writeStdout: (text: string) => void; // ansiToHtml 거쳐 stdout 이벤트
  readonly writeStderr: (text: string) => void;
  readonly reviewIO: WebReviewIO;
}

type Flow = StartRunRequest["flow"];

/**
 * 진행 중·끝난 run을 메모리에 들고 있는 레지스트리. 영속화는 비범위다.
 * 프로세스가 죽으면 같이 사라지고, 그것이 이 대시보드의 수명 계약이다.
 */
export class RunRegistry {
  private readonly runs = new Map<string, RunRecord>();

  /**
   * 즉시 `RunHandle`을 돌려주고 `execute`는 await하지 않은 채 굴린다.
   * HTTP 핸들러가 runId를 바로 응답해야 하므로 완료를 기다릴 수 없다.
   */
  start(flow: Flow, execute: (io: RunIo) => Promise<number>): RunHandle {
    const record = new RunRecord(flow);
    this.runs.set(record.runId, record);
    record.begin(execute);
    return record;
  }

  get(runId: string): RunHandle | undefined {
    return this.runs.get(runId);
  }

  list(): readonly RunSummary[] {
    return [...this.runs.values()].map((record) => record.summary);
  }
}

class RunRecord implements RunHandle {
  readonly runId = crypto.randomUUID(); // UI 식별 전용. 산출물에 안 들어간다.
  readonly reviewIO: WebReviewIO;
  private readonly accumulated: RunEvent[] = [];
  private readonly listeners = new Set<(event: RunEvent) => void>();
  private finished: { readonly status: RunStatus; readonly exitCode: number } | null = null;

  constructor(private readonly flow: Flow) {
    this.reviewIO = new WebReviewIO((event) => {
      this.emit(event);
    });
  }

  get events(): readonly RunEvent[] {
    return this.accumulated;
  }

  get summary(): RunSummary {
    return {
      runId: this.runId,
      flow: this.flow,
      status: this.status,
      exitCode: this.finished?.exitCode ?? null,
    };
  }

  /**
   * 늦은 구독자에게 과거 이벤트를 다시 보내는 것은 호출부 몫이다(`events`를 읽어 쓴다).
   * 여기서 자동 재전송하지 않는 이유는, 재전송 시점과 라이브 시작 시점 사이에
   * 이벤트가 끼어들면 중복이나 누락이 생기기 때문이다. 호출부가 동기 구간에서
   * `events`를 읽고 이어서 구독하면 그 틈이 없다.
   */
  subscribe(listener: (event: RunEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  begin(execute: (io: RunIo) => Promise<number>): void {
    const io: RunIo = {
      writeStdout: (text) => {
        this.emit({ kind: "stdout", html: ansiToHtml(text) });
      },
      writeStderr: (text) => {
        this.emit({ kind: "stderr", html: ansiToHtml(text) });
      },
      reviewIO: this.reviewIO,
    };
    // await하지 않는다. 그래서 execute가 동기 구간에서 던져도 여기서 새는 일이 없게
    // Promise.resolve로 감싸 reject 경로로 모은다.
    void Promise.resolve()
      .then(() => execute(io))
      .then(
        (exitCode) => {
          this.finish(exitCode);
        },
        (error: unknown) => {
          this.emit({ kind: "stderr", html: ansiToHtml(`${messageOf(error)}\n`) });
          this.finish(1);
        },
      );
  }

  private get status(): RunStatus {
    if (this.finished !== null) return this.finished.status;
    return this.reviewIO.pendingQuestion === null ? "running" : "waiting-input";
  }

  private finish(exitCode: number): void {
    if (this.finished !== null) return;
    this.finished = { status: exitCode === 0 ? "done" : "failed", exitCode };
    this.emit({ kind: "done", exitCode });
  }

  private emit(event: RunEvent): void {
    this.accumulated.push(event);
    for (const listener of this.listeners) listener(event);
  }
}

/** 던져진 값이 Error가 아닐 수도 있다. 그 경우에도 사람이 읽을 한 줄은 남긴다. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
