import { readFile } from "node:fs/promises";
import { connectStdio } from "@ohmymcp/core";
import { finalizeRunnerExecution, runSuite, validateMcpSuite } from "@ohmymcp/runner";
import { runCli } from "./test-command.js";

export type Command = (argv: string[]) => Promise<number>;
export const COMMANDS = ["test", "generate", "record", "replay", "mock"] as const;

export function run(argv: string[]): Promise<number> {
  return runCli(argv, {
    readFile,
    validateSuite: validateMcpSuite,
    connect: connectStdio,
    startRunner: runSuite,
    finalize: finalizeRunnerExecution,
    writeStdout: (text) => process.stdout.write(text),
    writeStderr: (text) => process.stderr.write(text),
  });
}
