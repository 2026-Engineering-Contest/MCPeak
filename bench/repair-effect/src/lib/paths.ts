import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// 이 파일은 <BENCH_ROOT>/src/lib/paths.ts 에 있다. BENCH_ROOT 는 여기서 두 단계 위다.
const HERE = dirname(fileURLToPath(import.meta.url));

/** bench/repair-effect 디렉터리 자체. */
export const BENCH_ROOT = join(HERE, "..", "..");

/** 저장소 최상위. BENCH_ROOT 에서 두 단계 위(bench/repair-effect -> bench -> repo root). */
const REPO_ROOT = join(BENCH_ROOT, "..", "..");

/** 원본 참조 서버 파일. */
export const SERVER_FILE = join(BENCH_ROOT, "server", "everything-server.ts");

/** 커밋되지 않는 작업 디렉터리(변형 서버, 원시 산출물 등). */
export const WORK_DIR = join(BENCH_ROOT, "work");

/** 커밋되는 결과 디렉터리(판정표 등). */
export const RESULTS_DIR = join(BENCH_ROOT, "results");

/** 참조 서버가 뜨는 포트. */
export const PORT = 3931;

/** repair 진단에 쓰는 모델 이름. */
export const MODEL = "claude-sonnet-5";

/** 저장소 빌드 산출물인 mcpeak CLI. */
export const MCPEAK_CLI = join(REPO_ROOT, "packages", "cli", "dist", "cli.mjs");

/** conformance 채점기 실행 파일. */
export const CONFORMANCE_BIN = join(BENCH_ROOT, "node_modules", ".bin", "conformance");

/** tsx 실행 파일. */
export const TSX_BIN = join(BENCH_ROOT, "node_modules", ".bin", "tsx");
