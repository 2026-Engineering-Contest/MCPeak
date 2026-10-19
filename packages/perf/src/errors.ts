export type PerfErrorCode = "BASELINE_INVALID";

export class PerfError extends Error {
  constructor(
    readonly code: PerfErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PerfError";
  }
}
