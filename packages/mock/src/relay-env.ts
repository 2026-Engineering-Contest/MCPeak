/**
 * 중계기 `--env` 의 이름 파서와 값 해석기. **순수 함수만 둔다** — 시간·난수·I/O·전역
 * 상태가 없고, `process.env` 도 직접 읽지 않는다(읽기를 주입받는다).
 *
 * 이 파일이 따로 있는 이유는 두 가지다.
 *   1. 테스트가 자식 프로세스를 띄우지 않고 문안을 직접 본다 — 유닛 웨이브에 남는다.
 *   2. 의존 방향이 `cli → mock` 이라 cli 의 `parseEnvForwardOption` 을 가져올 수 없다.
 *      규약은 같지만 구현은 여기 따로 있다.
 *
 * SDK 가 자식에게 `HOME`·`LOGNAME`·`PATH`·`SHELL`·`TERM`·`USER` 여섯 개만 넘기고 나머지를
 * 버리기 때문에, `WEATHER_API_KEY` 를 읽는 서버는 중계기 뒤에서 조용히 실패한다. 그 여섯 개
 * 바깥을 사용자가 **이름으로** 지목하는 것이 이 옵션이다.
 *
 * cli 는 `NODE_OPTIONS` 와 `MCPEAK_*` 를 거절하지만 **중계기는 거절하지 않는다.** 그 거절의
 * 근거가 "녹화·재생 배선이 자식 환경에 직접 쓴다" 인데 중계기에는 그 배선이 없다. 이유가
 * 거짓인 거절 문안을 다는 것이, 문안이 곧 제품인 이 저장소에서는 더 나쁘다.
 */

export type EnvResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** cli 의 `ENV_NAME_PATTERN` 과 같은 패턴이다. 두 진입점의 규약이 갈리면 안 된다. */
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const ok = <T>(value: T): EnvResult<T> => ({ ok: true, value });
const err = (message: string): EnvResult<never> => ({ ok: false, message });

/**
 * 터미널 제어 문자를 무해한 토큰으로 바꾼다.
 *
 * `packages/cli/src/repair-render.ts:14` 의 같은 이름 함수의 **사본**이다. import 하지 않는
 * 근거는 두 가지다. 첫째로 의존 방향이 `cli → mock` 이라 여기서 cli 를 부르면 역방향이고
 * 순환이다(ADR-0091 은 하위 계층을 직접 의존하는 것만 허용한다). 둘째로 이 저장소는 이미
 * 같은 이유로 사본을 셋 두고 있다 — `test-command.ts` · `process-diagnostics.ts` ·
 * `repair-render.ts` 이고 근거는 ADR-0013 이다. 여기가 넷째다.
 *
 * TAB(0x09)도 이스케이프한다. 거절 문안에 실리는 것은 사용자가 친 **인자 한 토막**이라
 * 보존할 들여쓰기가 없고, 우리가 맞춰 둔 `     read -rs …` 들여쓰기를 TAB 이 흔들면
 * 화면이 어긋난다.
 */
const escapeTerminalText = (value: string): string =>
  Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    // 0x7f..0x9f 는 DEL 과 C1 제어 문자다. U+009B 를 8비트 CSI 로 해석하는 터미널이 있다.
    return codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
      ? `\\u${codePoint.toString(16).padStart(4, "0")}`
      : character;
  }).join("");

/** 되짚어 준 값 하나의 표시 상한. `connect-target.ts:102` 의 `MAX_ECHOED_CHARACTERS` 와 같다. */
const MAX_ECHOED_CHARACTERS = 200;

/**
 * 거절 문장에 되짚어 넣는 **사용자 입력**을 무해하게 만든다. `connect-target.ts:112` 의
 * `echoValue` 사본이고, 사본인 근거는 위 `escapeTerminalText` 와 같다.
 *
 * `mcpeak-relay --env $'\e[2J…'` 처럼 ANSI 를 실은 인자가 그대로 stderr 를 거쳐 터미널에
 * 닿는 것을 막는다. **값 단위로만 건다** — 문장 전체에 걸면 우리가 쓴 개행(`\n→ …`)까지
 * 이스케이프되어 안내가 한 줄로 뭉개진다. #289 가 정확히 그 결함이었다.
 */
function echoValue(value: string): string {
  const escaped = escapeTerminalText(value);
  return escaped.length <= MAX_ECHOED_CHARACTERS
    ? escaped
    : `${escaped.slice(0, MAX_ECHOED_CHARACTERS)}…`;
}

/**
 * `--env` 값 하나를 환경변수 이름으로 검증한다. **이름만** 받는다. 값을 여기 넣으면
 * `ps` 목록과 셸 히스토리에 그대로 남는다 — 그것이 이 옵션이 이름만 받는 이유고,
 * 거절 문장이 그 이유를 말해야 한다.
 *
 * 같은 이름이 두 번 왔는지는 여기서 보지 않는다. argv 를 도는 쪽의 몫이다.
 */
export function parseEnvName(raw: string): EnvResult<string> {
  const name = raw.trim();
  if (name === "") return err("→ `--env` 옵션 값이 필요합니다.");
  if (!ENV_NAME_PATTERN.test(name))
    return err(
      `→ \`--env\` 는 환경변수 **이름**만 받습니다: '${echoValue(raw)}'\n` +
        "→ 값을 명령줄에 쓰면 `ps` 목록과 셸 히스토리에 그대로 남기 때문입니다.\n" +
        "→ 값은 환경변수에 넣고 이름만 넘기세요:\n" +
        "     read -rs WEATHER_API_KEY; export WEATHER_API_KEY\n" +
        "     mcpeak-relay --port 7400 --env WEATHER_API_KEY -- node ./server.mjs",
    );
  return ok(name);
}

/**
 * 이름 목록을 값으로 바꾼다. 읽기를 주입받는 이유는 테스트가 `process.env` 를 건드리지
 * 않게 하기 위해서다 — 전역을 흔드는 테스트는 실행 순서에 따라 결과가 달라진다.
 *
 * **비어 있으면 이름만 말한다.** 값이 비었다는 사실을 알리려다 값을 화면에 찍으면 이
 * 옵션이 존재하는 이유가 없어진다(ADR-0070 §3).
 */
export function resolveEnv(
  names: readonly string[],
  readEnv: (name: string) => string | undefined,
): EnvResult<Record<string, string>> {
  // `__proto__` 는 위 이름 규칙을 통과한다. 평범한 객체 리터럴에 그냥 대입하면 키가 아니라
  // 프로토타입이 바뀌어 값이 조용히 사라진다. 널 프로토타입에서는 평범한 own 프로퍼티가 된다.
  const env: Record<string, string> = Object.create(null);
  for (const name of names) {
    const value = readEnv(name);
    if (value === undefined || value === "")
      return err(
        `→ 환경변수 \`${name}\` 가 비어 있습니다.\n` +
          "→ 값을 넣고 다시 실행하세요:\n" +
          `     read -rs ${name}; export ${name}`,
      );
    env[name] = value;
  }
  return ok(env);
}
