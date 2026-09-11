import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { startExternalCoordinator } from "../../src/external/coordinator.js";
import { createMemorySessionStore } from "../../src/external/session-store.js";

/**
 * 관측 보고 디렉터리의 환경변수 이름은 **부모와 자식 두 자리에 따로 적혀 있다.**
 * `coordinator.ts` 가 넘기고 `child/bootstrap.mjs` 가 읽는다.
 *
 * **어긋나면 관측이 조용히 꺼진다.** 자식은 값을 못 찾아 사이드카를 설치하지 않고, 부모는
 * 보고 파일이 하나도 없으니 `undefined`(못 셌음)로 읽는다. 그 상태는 실패처럼 보이지
 * 않는다 — ADR-0068 이 1급으로 다루는 정상 갈래와 똑같다. 그래서 이름 자체를 단언한다.
 */
const ENV_OBSERVER_DIR = "MCPEAK_EXTERNAL_OBSERVER_DIR";

const handles: Array<Awaited<ReturnType<typeof startExternalCoordinator>>> = [];

afterEach(async () => {
  await Promise.allSettled(handles.splice(0).map((handle) => handle.finish("failed")));
});

describe("관측 보고 디렉터리 환경변수 계약 (ADR-0096)", () => {
  it("부모가 그 이름으로 존재하는 디렉터리를 넘긴다", async () => {
    const store = createMemorySessionStore();
    store.createSession("default");
    store.finish("default", "completed");
    const handle = await startExternalCoordinator({
      mode: "replay",
      sourceSessionId: "default",
      store,
    });
    handles.push(handle);

    const dir = handle.childEnvironment[ENV_OBSERVER_DIR];

    expect(dir).toBeDefined();
    // 파일이 아니라 디렉터리다. 프로세스마다 자기 파일을 이 안에 쓴다.
    expect(statSync(dir ?? "").isDirectory()).toBe(true);
  });

  /**
   * 소스를 문자열로 읽어 단언하는 이유는 이 계약이 **프로세스 경계를 넘기** 때문이다.
   * `bootstrap.mjs` 는 자식 안에서 번들 없이 로드되므로 여기서 import 해 상수를 비교할 수
   * 없고, import 해 봐야 그 파일은 로드되는 순간 어댑터를 설치하려 든다.
   */
  it("자식도 같은 이름을 읽는다", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../src/external/child/bootstrap.mjs", import.meta.url)),
      "utf8",
    );

    expect(source).toContain(ENV_OBSERVER_DIR);
    // 옛 이름이 남아 있으면 두 자리가 다른 값을 말한다.
    expect(source).not.toContain("MCPEAK_EXTERNAL_OBSERVER_PATH");
  });
});
