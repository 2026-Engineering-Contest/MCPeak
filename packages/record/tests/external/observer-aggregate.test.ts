import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startExternalCoordinator } from "../../src/external/coordinator.js";
import { createMemorySessionStore } from "../../src/external/session-store.js";

/**
 * ADR-0100 의 집계 규칙을 고정한다.
 *
 * 보고는 이제 프로세스마다 한 파일이다. 중간에 낀 Node 런처(`npx`)도 같은 디렉터리를 물려받아
 * 자기 `node:http` 트래픽을 보고하는데 그것은 서버가 한 일이 아니다. 그래서 **기록자의 보고가
 * 있으면 그것만** 세고, **하나도 없으면 전부** 센다. 둘째 줄이 요점이다 — `node:http` 만 쓰는
 * 서버는 어댑터를 한 번도 지나지 않아 아무도 기록자가 되지 않는데, 그 경우가 바로 이 기능이
 * 만들어진 이유다(ADR-0068).
 *
 * 사이드카는 export 되지 않으므로 Coordinator 를 재생으로 띄워 `childEnvironment` 가 가리키는
 * 디렉터리에 보고를 손으로 넣고 `finish()` 로 판정한다. 자식 프로세스는 띄우지 않는다.
 */
const ENV_OBSERVER_DIR = "MCPEAK_EXTERNAL_OBSERVER_DIR";

const handles: Array<Awaited<ReturnType<typeof startExternalCoordinator>>> = [];

afterEach(async () => {
  await Promise.allSettled(handles.splice(0).map((handle) => handle.finish("failed")));
});

/**
 * 케이스마다 새로 띄운다. `read()` 는 판정이 끝나면 디렉터리를 지우므로 하나를 돌려 쓰면
 * 두 번째 케이스가 "디렉터리 없음" 갈래로 떨어진다.
 */
const startReplay = async () => {
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
  if (dir === undefined) throw new Error("관측 디렉터리가 없다");
  return { handle, dir };
};

/** 자식이 종료 훅에서 쓰는 것과 같은 모양의 파일 하나. 이름은 관측기처럼 프로세스별이다. */
const writeReport = (dir: string, name: string, body: string): void => {
  writeFileSync(join(dir, `${name}.json`), body);
};

/** `finish()` 가 실은 `outOfScope`. 없으면 "못 셌음" 이다. */
const outOfScopeOf = async (handle: Awaited<ReturnType<typeof startExternalCoordinator>>) => {
  const summary = await handle.finish("completed");
  // `outOfScope` 는 재생 요약에만 있다. 유니온을 손으로 복제하지 않고 여기서 한 번 좁힌다.
  if (summary.mode !== "replay") throw new Error("replay 요약이어야 한다");
  return summary.outOfScope;
};

const report = (outOfScope: number, claimed?: boolean) =>
  JSON.stringify(claimed === undefined ? { outOfScope } : { outOfScope, claimed });

describe("범위 밖 관측 집계 (ADR-0100)", () => {
  it("보고가 하나도 없으면 못 셌음이다", async () => {
    const { handle } = await startReplay();

    expect(await outOfScopeOf(handle)).toBeUndefined();
  });

  it("디렉터리 자체가 없어도 못 셌음이다", async () => {
    const { handle, dir } = await startReplay();
    rmSync(dir, { recursive: true, force: true });

    expect(await outOfScopeOf(handle)).toBeUndefined();
  });

  it("기록자 보고 하나면 그 수다", async () => {
    const { handle, dir } = await startReplay();
    writeReport(dir, "a", report(3, true));

    expect(await outOfScopeOf(handle)).toBe(3);
  });

  it("기록자 보고가 있으면 기록자가 아닌 보고는 버린다 — 런처 트래픽이 이 갈래다", async () => {
    const { handle, dir } = await startReplay();
    writeReport(dir, "server", report(3, true));
    writeReport(dir, "launcher", report(5, false));

    expect(await outOfScopeOf(handle)).toBe(3);
  });

  it("기록자가 하나도 없으면 전부 센다 — node:http 전용 서버를 버리지 않는다", async () => {
    const { handle, dir } = await startReplay();
    writeReport(dir, "a", report(3, false));
    writeReport(dir, "b", report(5, false));

    expect(await outOfScopeOf(handle)).toBe(8);
  });

  it("기록자 보고가 여럿이면 그것들을 합친다", async () => {
    const { handle, dir } = await startReplay();
    writeReport(dir, "a", report(3, true));
    writeReport(dir, "b", report(5, true));

    expect(await outOfScopeOf(handle)).toBe(8);
  });

  it("한 파일이 깨져도 나머지를 버리지 않는다", async () => {
    const { handle, dir } = await startReplay();
    writeReport(dir, "broken", "{not json");
    writeReport(dir, "good", report(3, true));

    expect(await outOfScopeOf(handle)).toBe(3);
  });

  it("깨진 파일뿐이면 못 셌음이다 — 0 이 아니다", async () => {
    const { handle, dir } = await startReplay();
    writeReport(dir, "broken", "{not json");

    expect(await outOfScopeOf(handle)).toBeUndefined();
  });

  it("값의 형태가 틀린 보고뿐이면 못 셌음이다", async () => {
    const { handle, dir } = await startReplay();
    writeReport(dir, "negative", report(-1));

    expect(await outOfScopeOf(handle)).toBeUndefined();
  });

  it("claimed 가 없으면 기록자가 아닌 것으로 본다", async () => {
    const { handle, dir } = await startReplay();
    writeReport(dir, "legacy", report(3));

    // 기록자 보고가 하나도 없는 셈이라 폴백으로 전부 센다. 값은 같지만 갈래가 다르다.
    expect(await outOfScopeOf(handle)).toBe(3);
  });

  it("판정이 끝나면 디렉터리를 지운다", async () => {
    const { handle, dir } = await startReplay();
    writeReport(dir, "a", report(1, true));

    await handle.finish("completed");

    expect(existsSync(dir)).toBe(false);
  });
});
