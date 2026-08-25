/**
 * 대시보드 등 외부 진입점을 위한 재export 면. 로직 없음.
 * 여기 있는 이름만이 `@mcpeak/cli/commands` 공개 계약이다.
 */

export {
  type GenerateCommandDependencies,
  type GenerateCommandInput,
  nodeGenerateDependencies,
  nodeReviewIO,
  REVIEW_BACK_VALUE,
  type ReviewIO,
  runGenerateCommand,
} from "./generate-command.js";
export {
  parseRepairCommand,
  type RepairCommandDependencies,
  type RepairCommandInput,
  runRepairCommand,
} from "./repair-command.js";
export {
  type CliErrorCode,
  type CliFailure,
  parseTestCommand,
  runCli,
  type TestCommandDependencies,
  type TestCommandInput,
} from "./test-command.js";
