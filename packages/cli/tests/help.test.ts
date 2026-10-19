import { describe, expect, it } from "vitest";
import {
  commandDiscovery,
  commandHelp,
  GENERATE_USAGE,
  GENERATE_USAGE_HINT,
  GLOBAL_HELP,
  PERF_USAGE,
  TEST_USAGE,
} from "../src/help.js";

/** 도움말은 옵션의 유일한 설명이다. */
describe("generate 도움말", () => {
  const help = commandHelp("generate");

  it.each([["--no-dry-run"], ["--reset-cmd <command>"], ["--no-repair"]])(
    "%s 가 사용법 줄에 나온다",
    (option) => {
      expect(GENERATE_USAGE).toContain(`[${option}]`);
    },
  );

  it("GENERATE_USAGE 에 [--force] 가 있다", () => {
    expect(GENERATE_USAGE).toContain("[--force]");
  });

  it("설명 블록에 --force 줄이 있다", () => {
    expect(help).toContain(
      "--force               `--out` 경로에 파일이 있으면 지우고 새로 씁니다. 기본은 저장을",
    );
    expect(help).toContain("멈추는 것입니다");
  });

  it("--diagnose-rejections 가 사용법 줄에 나온다", () => {
    expect(GENERATE_USAGE).toContain("[--diagnose-rejections]");
  });

  it("--diagnose-rejections 설명이 도움말에 있다", () => {
    expect(help).toContain("--diagnose-rejections");
    expect(help).toContain("통과한 거절 케이스의 응답을 나열하고");
    // 기본값을 안 적으면 사용자가 이미 켜져 있다고 읽는다.
    expect(help).toContain("기본은 끕니다");
  });

  it("--no-repair 설명이 도움말에 있다", () => {
    expect(help).toContain(
      "--no-repair           시험 실행이 실패해도 입력값을 고쳐 다시 시도하지 않습니다.",
    );
    expect(help).toContain("실패가 곧바로 분류 화면으로 갑니다");
  });

  it("시험 실행 옵션의 설명이 도움말에 있다", () => {
    expect(help).toContain("--no-dry-run          승인 전 시험 실행을 건너뜁니다.");
    expect(help).toContain("않은 채 저장되고, 실행이 필요한 AI 사전보완도 건너뜁니다");
    expect(help).toContain("--reset-cmd <command> 시험 실행 전에 이 명령을 한 번 실행합니다.");
  });

  it("--fixtures 가 사용법 줄에 나온다", () => {
    expect(GENERATE_USAGE).toContain("[--fixtures <path>]");
  });

  it("--fixtures 설명과 기본 경로가 도움말에 있다", () => {
    expect(help).toContain(
      "--fixtures <path>     실재하는 자원을 가리키는 값을 도구·필드별로 적은 JSON 파일입니다.",
    );
    // 기본 경로를 안 적으면 사용자가 옵션 없이는 아무 파일도 안 읽는 줄 안다.
    expect(help).toContain("`mcpeak.fixtures.json` 을 찾고, 없으면 그냥 진행합니다");
  });

  /**
   * 픽스처 값은 생성된 명세에 리터럴로 들어가고 그 명세는 커밋된다(설계 §3). 경고가 도움말에
   * 없으면 사용자는 토큰을 적는다. `.gitignore` 를 권하지 않는 것도 함께 못 박는다. 픽스처는
   * 팀이 공유해야 재현되기 때문이다.
   */
  it("--fixtures 설명이 비밀값을 적지 말라고 말한다", () => {
    expect(help).toContain("토큰·비밀번호·API 키를 적지 마세요");
    expect(help).toContain("생성된 명세에 그대로");
    expect(help).toContain("환경변수로 자격을 넘기고");
    expect(help).toContain("자원 식별자만 적으세요");
    expect(help).not.toContain(".gitignore");
  });

  it("제거된 Tool 카세트 옵션은 도움말에 없다", () => {
    expect(help).not.toContain("--cassette");
    expect(help).not.toContain("--record");
  });

  it("위험을 알리는 문장이 함께 있다", () => {
    // 이 둘이 빠지면 옵션 이름만 남는다. 각각 미검증 저장·오해를 막는 문장이다.
    expect(help).toContain("실제 서버에서 확인되지");
    expect(help).toContain("셸을 거치지 않으므로");
  });

  it("사용 오류 힌트는 사용법 한 줄만 담는다", () => {
    // 힌트는 stderr 한 줄이다. 여기에 옵션 설명 블록이 섞이면 오류 메시지가 화면을 덮는다.
    expect(GENERATE_USAGE_HINT).toContain(GENERATE_USAGE);
    expect(GENERATE_USAGE_HINT).not.toContain("\n");
  });
});

/** perf 는 설계 §8.4 의 옵션 표가 도움말 본문이다(계획 §8.2). */
describe("perf 도움말", () => {
  const help = commandHelp("perf");

  it("전체 도움말의 명령 목록에 audit 다음 줄로 perf 가 있다", () => {
    expect(GLOBAL_HELP).toContain(
      "  audit     MCP 서버를 쓰기 전에 도구 정의와 프로토콜의 보안 위험을 점검합니다.\n" +
        "  perf      도구 호출 지연을 외부 대기와 서버 안 시간으로 나누고 회귀를 잡습니다.\n",
    );
  });

  it("명령 발견 문장에 perf 가 있다", () => {
    expect(commandDiscovery).toBe(
      "사용 가능한 명령: test, generate, repair, optimize, audit, perf. 전체 도움말: mcpeak --help",
    );
  });

  it("머리 줄과 사용법 줄", () => {
    expect(
      help.startsWith(
        "perf — 도구 호출 지연을 외부 대기와 서버 안 시간으로 나누고 회귀를 잡습니다.\n\n" +
          `${PERF_USAGE}\n\n옵션:\n`,
      ),
    ).toBe(true);
  });

  it.each([
    ["--repeat <n>          케이스당 호출 수입니다. 기본값은 5 입니다. 1 이상 100 이하 정수"],
    ["--interval-ms <ms>    호출 사이 대기입니다. 기본값은 0 입니다. 0 이상 60000 이하 정수"],
    ["--tool <name>         그 도구의 케이스만 잽니다. 반복할 수 있습니다"],
    ["--baseline <path>     기준 파일입니다. 있으면 비교하고, --update-baseline 과 함께면"],
    ["--update-baseline     측정 결과로 기준 파일을 씁니다. 비교하지 않습니다"],
    ["--threshold-pct <n>   서버 안 p50 회귀의 비율 허용치입니다. 기본값은 50 입니다."],
    ["--threshold-ms <n>    서버 안 p50 회귀의 절대 허용치입니다. 기본값은 20 입니다."],
    ["--json                리포트 대신 결과 JSON 하나를 stdout 에 냅니다"],
  ])("옵션 줄 %s", (line) => {
    expect(help).toContain(`  ${line}`);
  });

  it("--env 는 받고 원격 옵션은 받지 않는다고 말한다", () => {
    expect(help).toContain("--env <NAME>");
    expect(help).not.toContain("--header-env <헤더이름>");
    expect(help).toContain("--url 과 --header-env 는 받지 않습니다");
  });

  it("종료 코드와 간격 기본값의 뜻을 말한다", () => {
    expect(help).toContain("종료 코드는 측정 완료 0, 기준선 회귀 2");
    expect(help).toContain("레이트리미터");
  });
});

/**
 * `--env` 가 값이 아니라 이름을 받는 이유가 도움말에 없으면 사용자는 `--arg KEY=값` 래퍼로
 * 우회하고, 그것이 우리가 막으려던 노출이다(설계 §4.1).
 */
describe("--env 도움말", () => {
  it.each([
    ["test", TEST_USAGE],
    ["generate", GENERATE_USAGE],
  ] as const)("%s 사용법 줄에 --env <NAME> 이 나온다", (_command, usage) => {
    expect(usage).toContain("[--env <NAME> ...]");
  });

  it.each(["test", "generate"] as const)("%s 옵션 설명에 --env 와 이유가 있다", (command) => {
    const help = commandHelp(command);
    expect(help).toContain("--env <NAME>");
    expect(help).toContain("`ps` 목록과 셸 히스토리");
    expect(help).toContain("read -rs");
    expect(help).toContain("MCPEAK_");
  });
});

describe("test External 세션 도움말", () => {
  const help = commandHelp("test");

  it("세션 옵션이 사용법 줄에 나온다", () => {
    expect(TEST_USAGE).toContain("[--session <path> | --record-session <path>]");
  });

  it("External 어댑터 범위를 globalThis.fetch 로 한정해 말한다", () => {
    expect(help).toContain("`globalThis.fetch` 로 밖에 부른 HTTP 호출만 녹화합니다");
    expect(help).toContain("`node:http`·`node:https` 같은 범위 밖 호출은");
    expect(help).toContain("잡히지 않아 실제 네트워크로 나갈 수 있습니다");
    expect(help).toContain("범위 밖 호출은 실제 네트워크로 나갈 수 있으며");
    expect(help).toContain(
      "범위 밖 호출이\n                        의심되는 경우 종료 때 알립니다",
    );
    expect(help).not.toContain("외부 API 는 부르지 않습니다");
  });

  /**
   * `--determinism` 은 비차단 진단이라 차이를 찾아도 종료 코드가 0 이다. 그 사실이 화면에도
   * 도움말에도 없어서 CI 초록을 통과로 읽는 자리가 있었다(#292). 같은 저장소가 이미
   * 종료 코드를 도움말에 적는 관례를 갖고 있다.
   */
  it("--determinism 항목이 종료 코드를 말한다", () => {
    expect(help).toContain("비차단 진단입니다");
    expect(help).toContain("종료 코드");
    expect(help).toContain("--json 의 determinism 키");
  });

  /**
   * 차이 지점의 양쪽 값은 이름으로 판정해 가리는데, 서버가 결과를 JSON 문자열로 만들어 text
   * 블록 하나에 싣는 형태에서는 비밀값이 문자열 안에 있어 그 판정이 닿지 않는다(#183,
   * ADR-0082). 설계 문서가 "redaction 이 적용된다" 고만 적어 안심하고 CI 로그에 남기던
   * 자리라, 그 한계를 화면에 적는다(ADR-0033 의 E3: 치환 대신 명시).
   */
  it("--determinism 항목이 표시값 마스킹의 한계를 말한다", () => {
    expect(help).toContain("차이 지점의 양쪽 값을 화면에 싣습니다");
    expect(help).toContain("text 블록");
    expect(help).toContain("가려지지 않습니다");
  });
});
