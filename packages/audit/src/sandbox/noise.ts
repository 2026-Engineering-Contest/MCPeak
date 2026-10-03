import type { Observation, SyscallEvent } from "../types.js";

type Exec = Extract<SyscallEvent, { kind: "exec" }>;

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** 게이트웨이가 듣는 포트. 이 포트로 가는 접속은 게이트웨이가 요청 기록으로 따로 본다. */
const GATEWAY_PORTS: ReadonlySet<number> = new Set([53, 80, 443]);

/** Docker 의 내장 리졸버 주소. 사용자 정의 네트워크에서 `/etc/resolv.conf` 의 nameserver 가 이 값이다. */
const EMBEDDED_RESOLVER = "127.0.0.11";

/** 패키지 실행기(`npx`·`npm`)가 서버를 띄우면서 스스로 실행하는 것. */
const RUNNER_COMMANDS: ReadonlySet<string> = new Set(["npx", "npm"]);
const RUNNER_CHILDREN: ReadonlySet<string> = new Set(["node", "sh", "npm", "npx"]);
/** pnpm 이 만든 bin 셸 스크립트가 자기 위치를 구하느라 부르는 것. */
const BIN_SHIM_HELPERS: ReadonlySet<string> = new Set(["sed", "dirname", "uname"]);

/**
 * 실행기가 받은 패키지를 두는 자리. 명령이 npx·npm 일 때만 백엔드가 여기에 쓰기 가능한 tmpfs 를 얹는다
 * (ADR-0109). 끝의 `/` 까지가 접두다. `/home/node/.npmrc` 나 `/home/node/.npm-x` 는 여기에 들지 않는다.
 */
const NPM_CACHE_PREFIX = "/home/node/.npm/";

interface NoiseContext {
  readonly command: string;
  /** `start` 단계의 첫 `exec` 사건이 `events` 에서 놓인 자리. 없으면 -1. */
  readonly firstStartExecIndex: number;
}

interface NoiseRow {
  readonly name: string;
  /** 왜 서버의 행위가 아니라 런타임의 잡음인가. 채집한 기록의 어디에서 보았는지를 함께 적는다. */
  readonly reason: string;
  readonly matches: (event: SyscallEvent, context: NoiseContext, index: number) => boolean;
}

function isRunnerStartExec(event: SyscallEvent, context: NoiseContext): event is Exec {
  return (
    event.kind === "exec" &&
    event.phase.kind === "start" &&
    RUNNER_COMMANDS.has(basename(context.command))
  );
}

/**
 * 규칙이 보기 전에 빼는 것의 정본이다(§3.4). **좁게** 둔다. 경로 접두로 뭉뚱그려 빼면 서버가 같은 접두
 * 아래에서 하는 일도 함께 사라진다. 행을 더할 때는 실제 컨테이너에서 떠 온 기록
 * (`tests/fixtures/sandbox/trace-*.txt`)에 나온 것만 넣고 근거를 `reason` 에 적는다.
 *
 * 읽기 전용 열기는 표에 없다. `behavior` 규칙이 자격 증명 파일, `/tmp` 밖 쓰기, 프로세스 실행, 접속만
 * 보므로 Node 가 시작하면서 여는 라이브러리·모듈 파일은 애초에 어느 규칙에도 닿지 않는다.
 */
export const NOISE_TABLE: readonly NoiseRow[] = [
  {
    name: "first-exec",
    reason:
      "strace 가 띄운 서버 명령 자체다. trace-weather-start.txt 의 첫 줄(execve node examples/weather-server/server.mjs)",
    matches: (_event, context, index) => index === context.firstStartExecIndex,
  },
  {
    name: "package-runner",
    reason:
      "명령이 npx·npm 일 때 실행기가 서버를 띄우는 과정이다. trace-npx-start.txt 에서 npx 가 node, sh -c, node 를 차례로 실행한다",
    matches: (event, context) =>
      isRunnerStartExec(event, context) && RUNNER_CHILDREN.has(basename(event.path)),
  },
  {
    name: "package-bin",
    reason:
      "명령이 npx·npm 일 때 실행기가 고른 패키지의 bin 이다. trace-npx-start.txt 의 execve /workspace/node_modules/.bin/tsc",
    matches: (event, context) =>
      isRunnerStartExec(event, context) && event.path.includes("/node_modules/.bin/"),
  },
  {
    name: "bin-shim-helper",
    reason:
      "pnpm 이 만든 bin 셸 스크립트가 자기 위치를 구하는 과정이다. trace-npx-start.txt 에서 tsc 스크립트가 sed, dirname, uname 을 실행한다",
    matches: (event, context) =>
      isRunnerStartExec(event, context) && BIN_SHIM_HELPERS.has(basename(event.path)),
  },
  {
    name: "npm-cache",
    reason:
      "명령이 npx·npm 일 때 실행기가 받은 패키지를 캐시에 채우는 과정이다. 서버가 호출 중에 그 자리에 쓰는 것은 빼지 않는다. trace-npx-registry-start.txt 에서 npx 가 /home/node/.npm/ 아래 _logs, _cacache, _npx 를 쓰기로 열고 _cacache/tmp 의 파일을 옮기고 지운다",
    matches: (event, context) =>
      (event.kind === "alter" || (event.kind === "open" && event.write)) &&
      event.phase.kind === "start" &&
      RUNNER_COMMANDS.has(basename(context.command)) &&
      event.path.startsWith(NPM_CACHE_PREFIX),
  },
  {
    name: "dev-null",
    reason:
      "출력을 버리는 리다이렉트다. 쓰는 내용이 어디에도 남지 않는다. trace-split.txt 에서 sh 가 /dev/null 을 O_WRONLY|O_CREAT|O_TRUNC 로 연다",
    matches: (event) => event.kind === "open" && event.write && event.path === "/dev/null",
  },
  {
    name: "unix-socket",
    reason:
      "컨테이너 안의 로컬 소켓이라 밖으로 나가지 않는다. trace-connect.txt·trace-exec.txt 에서 glibc 가 /var/run/nscd/socket 을 두드린다",
    matches: (event) => event.kind === "connect" && event.family === "unix",
  },
  {
    name: "embedded-resolver",
    reason:
      "Docker 가 사용자 정의 네트워크의 컨테이너에 넣어 주는 내장 리졸버(127.0.0.11:53)다. 이름 조회는 전부 여기로 connect 하고, 질의는 --dns 로 준 게이트웨이가 받아 따로 기록한다. trace-embedded-dns.txt",
    matches: (event) =>
      event.kind === "connect" &&
      event.family === "inet" &&
      event.address === EMBEDDED_RESOLVER &&
      event.port === 53,
  },
  {
    name: "gateway",
    reason:
      "게이트웨이가 요청 기록으로 따로 본다(§3.4 의 표). 게이트웨이는 다른 태스크가 만드는 중이라 채집한 기록에는 이 접속이 없다. 53·80·443 밖 포트가 남아야 한다는 것은 audit() 의 포트 문장과 맺은 계약이다",
    matches: (event) =>
      event.kind === "connect" && event.address === "<gateway>" && GATEWAY_PORTS.has(event.port),
  },
];

/** 런타임 잡음을 뺀 새 Observation 을 돌려준다. 무엇을 빼는지는 위 표 하나가 정본이다. */
export function filterNoise(
  observation: Observation,
  context: { readonly mountRoot: string; readonly command: string },
): Observation {
  const firstStartExecIndex = observation.events.findIndex(
    (event) => event.kind === "exec" && event.phase.kind === "start",
  );
  const noise: NoiseContext = { command: context.command, firstStartExecIndex };
  return {
    ...observation,
    events: observation.events.filter(
      (event, index) => !NOISE_TABLE.some((row) => row.matches(event, noise, index)),
    ),
  };
}
