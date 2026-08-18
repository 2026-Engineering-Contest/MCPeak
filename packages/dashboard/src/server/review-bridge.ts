import type { ReviewIO } from "ohmymcp/commands";
import type { PendingQuestion, RunEvent } from "../api-types.js";
import { ansiToHtml } from "./ansi.js";

/**
 * ReviewIO의 웹 구현. CLI 오케스트레이션은 질문마다 await하므로
 * pending 질문은 항상 0개 또는 1개다. 큐가 아니라 단일 슬롯으로 둔다.
 */
export class WebReviewIO implements ReviewIO {
  readonly interactive = true;
  private pending: {
    readonly question: PendingQuestion;
    readonly resolve: (value: string) => void;
  } | null = null;
  private counter = 0;

  constructor(private readonly emit: (event: RunEvent) => void) {}

  write(text: string): void {
    this.emit({ kind: "stdout", html: ansiToHtml(text) });
  }

  input(message: string): Promise<string> {
    return this.ask({ id: this.nextId(), kind: "input", message });
  }

  async choose(message: string, choices: readonly string[]): Promise<string> {
    const answer = await this.ask({
      id: this.nextId(),
      kind: "choose",
      message,
      choices: [...choices],
    });
    // CLI의 choose는 선택지 문자열을 그대로 돌려받는 계약이다. 검증은 서버가 한다:
    // 목록에 없는 값이면 다시 묻지 않고 그 값 그대로 넘긴다. CLI 쪽 검증 루프가
    // 잘못된 입력을 이미 처리하므로 여기서 이중 검증하지 않는다.
    return answer;
  }

  async confirm(message: string): Promise<boolean> {
    const answer = await this.ask({ id: this.nextId(), kind: "confirm", message });
    return answer === "y";
  }

  /** POST /answer 처리기가 호출한다. id 불일치·pending 없음이면 false. */
  answer(questionId: string, value: string): boolean {
    if (this.pending === null || this.pending.question.id !== questionId) return false;
    const { resolve } = this.pending;
    this.pending = null; // resolve 전에 비운다. resolve가 동기 후속 질문을 던질 수 있다.
    resolve(value);
    return true;
  }

  get pendingQuestion(): PendingQuestion | null {
    return this.pending?.question ?? null;
  }

  private ask(question: PendingQuestion): Promise<string> {
    if (this.pending !== null)
      throw new Error("이미 대기 중인 질문이 있습니다. CLI 플로우 계약 위반입니다.");
    this.emit({ kind: "question", question });
    return new Promise<string>((resolve) => {
      this.pending = { question, resolve };
    });
  }

  private nextId(): string {
    this.counter += 1;
    return `q${this.counter}`; // run 안에서만 유일하면 된다. 난수 불필요(결정론성).
  }
}
