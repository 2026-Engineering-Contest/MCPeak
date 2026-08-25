import { describe, expect, it } from "vitest";
import { commandHelp, GENERATE_USAGE, GENERATE_USAGE_HINT, TEST_USAGE } from "../src/help.js";

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

  it("--no-repair 설명이 도움말에 있다", () => {
    expect(help).toContain(
      "--no-repair           시험 실행이 실패해도 입력값을 고쳐 다시 시도하지 않습니다.",
    );
    expect(help).toContain("실패가 곧바로 분류 화면으로 갑니다");
  });

  it("시험 실행 옵션의 설명이 도움말에 있다", () => {
    expect(help).toContain("--no-dry-run          승인 전 시험 실행을 건너뜁니다.");
    expect(help).toContain("--reset-cmd <command> 시험 실행 전에 이 명령을 한 번 실행합니다.");
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
