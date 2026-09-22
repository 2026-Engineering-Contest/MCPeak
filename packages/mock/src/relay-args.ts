/**
 * 중계기 argv 파싱. **순수 함수만 둔다** — 프로세스를 죽이지 않고 결과를 돌려준다.
 * 실패시키는 것은 부르는 쪽(`relay.ts` 의 `main`)의 몫이다.
 *
 * `relay.ts` 에서 떼어낸 이유는 그 파일이 **진입점**이기 때문이다. 모듈 최상단에
 * `main(process.argv.slice(2))` 가 있어서, 유닛 테스트가 `relay.ts` 를 import 하는
 * 것만으로 중계기가 한 번 돈다. 인자 오류 문안에 테스트를 붙이려고 시작한 일인데
 * 테스트가 진입점을 실행해야 한다면 반만 고친 것이다. `relay-log.ts`·`relay-env.ts`
 * 와 같은 배치다 — 문안과 규칙은 순수 모듈에, 부수효과는 진입점에.
 */
import { echoValue } from "./relay-echo.js";
import { parseEnvName } from "./relay-env.js";

export const usage = [
  "사용법: mcpeak-relay [--port <번호>] [--json] [--env <이름>]... -- <명령> [인자...]",
  "  --port 0 (기본) 이면 빈 포트를 자동으로 받습니다.",
  "  --json 을 주면 기록을 한 줄 JSON 으로 냅니다.",
  "  --env <이름> 은 그 환경변수를 중계 대상 서버에 물려줍니다. 값이 아니라 이름만 받습니다.",
  "  -- 뒤는 중계할 stdio MCP 서버의 실행 명령입니다.",
].join("\n");

export interface Parsed {
  port: number;
  json: boolean;
  /**
   * `--env` 로 받은 **이름들**. 값 해석은 여기서 하지 않는다 — `main` 이 `resolveEnv` 에
   * `process.env` 읽기를 넘겨 한다. 그래야 `parseArgs` 가 전역을 안 읽는 순수 함수로 남는다.
   */
  envNames: string[];
  command: string;
  args: string[];
}

/** `relay-env.ts` 의 `EnvResult` 와 같은 결이다. 두 파일의 실패가 같은 모양으로 올라간다. */
export type ArgsResult = { ok: true; value: Parsed } | { ok: false; message: string };

const ok = (value: Parsed): ArgsResult => ({ ok: true, value });
/** 인자 오류는 **전부** 사용법을 달고 나간다. 고칠 자리가 명령줄 그 자체이기 때문이다. */
const err = (message: string): ArgsResult => ({ ok: false, message: `${message}\n${usage}` });

const MAX_PORT = 65535;

export function parseArgs(argv: readonly string[]): ArgsResult {
  let port = 0;
  let json = false;
  const envNames: string[] = [];
  let index = 0;
  for (; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      index += 1;
      break;
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    // `noUncheckedIndexedAccess` 아래서 `token` 은 `string | undefined` 다. 위 `===` 비교들과
    // 달리 `startsWith` 는 좁히기가 필요하므로 여기서 한 번 건다.
    if (token === undefined) continue;
    if (token === "--port" || token.startsWith("--port=")) {
      // `--port=N` 은 붙은 값을, `--port N` 은 다음 토큰을 쓴다. `--env` 와 같은 형태다.
      //
      // 다음 토큰이 `--` 면 "값이 없다" 로 본다. 구분자를 값으로 삼키면
      // `mcpeak-relay --port -- node s.mjs` 가 "정수가 필요합니다. 받은 값: '--'" 라고
      // 답하는데, 빠뜨린 것은 값이지 값의 **형식**이 아니다. 고칠 자리를 잘못 가리킨다.
      const inline = token.startsWith("--port=");
      const next = argv[index + 1];
      const raw = inline ? token.slice("--port=".length) : next === "--" ? "" : (next ?? "");
      // `--port=` 처럼 값이 빈 것도 "없음" 이다. `Number("")` 는 `0` 이라, 이 가드가 없으면
      // 빈 값이 조용히 포트 0(자동 할당)으로 둔갑한다.
      if (raw.trim() === "") return err("→ `--port` 옵션 값이 필요합니다.");
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_PORT)
        return err(
          `→ \`--port\` 에는 0~${MAX_PORT} 의 정수가 필요합니다. 받은 값: '${echoValue(raw)}'`,
        );
      port = parsed;
      if (!inline) index += 1;
      continue;
    }
    if (token === "--env" || token.startsWith("--env=")) {
      // `--env=NAME` 은 붙은 값을, `--env NAME` 은 다음 토큰을 쓴다. 값이 아예 없으면
      // 빈 문자열을 넘긴다 — `parseEnvName` 이 "옵션 값이 필요합니다" 로 답하는 자리다.
      //
      // 다음 토큰이 `--` 면 그것도 "값이 없다" 로 본다. 구분자를 이름으로 집어삼키면
      // `mcpeak-relay --env -- node s.mjs` 가 "'--' 는 이름이 아닙니다" 라고 답하는데,
      // 사용자가 빠뜨린 것은 이름이지 이름 형식이 아니다. 그 문장은 고칠 곳을 잘못 가리킨다.
      const inline = token.startsWith("--env=");
      const next = argv[index + 1];
      const raw = inline ? token.slice("--env=".length) : next === "--" ? "" : (next ?? "");
      const parsed = parseEnvName(raw);
      // 문안을 다시 쓰지 않는다. 이름 규칙과 거절 문장은 `relay-env.ts` 한 곳에만 산다.
      // `--env` 거절에는 사용법을 붙이지 않는다 — 그 문안이 이미 올바른 호출 예시를 품고 있다.
      if (!parsed.ok) return { ok: false, message: parsed.message };
      // 중복은 파서가 보지 않는다(이름 하나만 보므로). argv 를 도는 여기가 그 자리다.
      if (envNames.includes(parsed.value))
        return {
          ok: false,
          message: `→ \`--env ${parsed.value}\` 이 두 번 있습니다. 한 번만 쓰세요.`,
        };
      envNames.push(parsed.value);
      if (!inline) index += 1;
      continue;
    }
    return err(`→ 모르는 인자입니다: '${echoValue(token)}'`);
  }
  // `--` 뒤는 그대로 넘긴다. 중계 대상 서버의 인자가 우리 옵션과 겹쳐도(`node s.mjs --port 9`)
  // 그것은 그 서버의 것이다.
  const rest = argv.slice(index);
  const command = rest[0];
  if (command === undefined)
    return err("→ 중계할 서버의 실행 명령이 필요합니다. -- 뒤에 적으세요.");
  return ok({ port, json, envNames, command, args: rest.slice(1) });
}
