export type Command = (argv: string[]) => Promise<number>;

/**
 * 알려진 서브커맨드 목록. 각 커맨드의 구현은 자기 패키지의 오너가 채운다
 * (의존 방향: cli → runner/generate/record/mock → core).
 */
export const COMMANDS = ["test", "generate", "record", "replay", "mock"] as const;

/**
 * CLI 진입점 — 얇은 디스패처.
 * 아직 구현되지 않음 — 각 오너가 자기 서브커맨드만 채운다 (CONTRIBUTING §2.1).
 */
export function run(argv: string[]): Promise<number> {
  throw new Error("not implemented");
}
