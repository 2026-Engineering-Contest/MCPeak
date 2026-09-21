// @vitest-environment jsdom
//
// **`localStorage.clear()` 를 부르지 않는다.** jsdom 27 에서 그 한 줄이 던지는 바람에
// `home.test.tsx` 를 비롯한 6 파일이 통째로 빨갛다. 부르지만 않으면 RTL 은 정상 동작한다.
// 대신 케이스마다 **다른 스위트 경로**를 써서 앞 케이스가 남긴 지난 실행값과 겹치지 않게 한다.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  FileEntry,
  RelayCase,
  RelayEvent,
  RelayEventInput,
  ServerCandidate,
  ServerMeta,
} from "../../src/api-types.js";
import { StepRelay } from "../src/home/steps/StepRelay.js";
import { Home } from "../src/screens/Home.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CASES: readonly RelayCase[] = [
  { id: "get-weather-success", tag: "c1", tool: "get_weather", input: { city: "서울" } },
  { id: "add-missing-a", tag: "c2", tool: "add", input: { b: 2 } },
];

const withIds = (inputs: readonly RelayEventInput[]): readonly RelayEvent[] =>
  inputs.map((event, index) => ({ ...event, id: index + 1 }) as RelayEvent);

describe("4 단계 실제 응답", () => {
  it("케이스마다 칸이 하나씩 뜬다", () => {
    render(<StepRelay cases={CASES} events={[]} error={null} skipped={null} />);
    expect(screen.getByText("get-weather-success")).toBeDefined();
    expect(screen.getByText("add-missing-a")).toBeDefined();
  });

  it("AI 가 툴을 안 불렀으면 「호출 없음」 칸이 뜬다", () => {
    render(
      <StepRelay
        cases={CASES}
        events={withIds([{ kind: "aiDone", case: "get-weather-success", ok: true }])}
        error={null}
        skipped={null}
      />,
    );
    expect(screen.getByText("AI 가 이 케이스에서 툴을 부르지 않았습니다.")).toBeDefined();
  });

  it("성공한 칸은 바이트·시간과 사람이 읽는 본문을 보인다", () => {
    render(
      <StepRelay
        cases={CASES}
        events={withIds([
          {
            kind: "call",
            case: "c1",
            method: "tools/call",
            tool: "get_weather",
            args: { city: "서울" },
          },
          {
            kind: "result",
            case: "c1",
            tool: "get_weather",
            ok: true,
            bytes: 97,
            ms: 20,
            body: { content: [{ type: "text", text: '{"temp":21}' }] },
          },
        ])}
        error={null}
        skipped={null}
      />,
    );
    expect(screen.getByText(/97바이트/)).toBeDefined();
    expect(screen.getByText(/0\.0초/)).toBeDefined();
    expect(screen.getByText('{"temp":21}')).toBeDefined();
  });

  it("프로토콜 오류는 서버가 준 코드와 문장을 그대로 보인다", () => {
    render(
      <StepRelay
        cases={CASES}
        events={withIds([
          { kind: "call", case: "c2", method: "tools/call", tool: "add" },
          {
            kind: "result",
            case: "c2",
            ok: false,
            code: -32602,
            message: "필수 인자 a 가 없습니다",
          },
        ])}
        error={null}
        skipped={null}
      />,
    );
    expect(screen.getByText(/-32602/)).toBeDefined();
    expect(screen.getByText(/필수 인자 a 가 없습니다/)).toBeDefined();
  });

  it("건너뛴 케이스가 있으면 그 안내를 보인다", () => {
    render(
      <StepRelay
        cases={CASES}
        events={[]}
        error={null}
        skipped="→ 툴을 부르지 않는 케이스 1 건은 띄우지 않았습니다: only-list"
      />,
    );
    expect(screen.getByText(/only-list/)).toBeDefined();
  });

  it("중계기를 못 띄웠으면 그 사유 전문을 보인다", () => {
    render(
      <StepRelay
        cases={[]}
        events={[]}
        error={"→ 중계기가 기동 줄을 내지 않았습니다."}
        skipped={null}
      />,
    );
    expect(screen.getByText(/중계기가 기동 줄을 내지 않았습니다/)).toBeDefined();
  });
});

const META: ServerMeta = { root: "/tmp/proj" };
const WEATHER: ServerCandidate = {
  id: "mcp-config:.mcp.json:weather",
  name: "weather",
  command: "node",
  args: ["examples/weather-server/server.mjs"],
  source: "mcp-config",
  path: ".mcp.json",
  envNames: ["API_KEY"],
};

/** 중계기가 돌려주는 케이스. 4 단계에 들어섰는지 화면으로 확인하는 표식이다. */
const RELAY_CASES: readonly RelayCase[] = [
  { id: "get-weather-success", tag: "c1", tool: "get_weather", input: { city: "서울" } },
];

interface Traffic {
  /** `"POST /api/relay"` 모양. **순서가 이 화면의 계약이라** 배열로 남긴다. */
  readonly calls: string[];
}

/**
 * `EventSource` 는 jsdom 에 없다. `useRelayEvents` 가 4 단계에서 바로 만들므로 스텁이 없으면
 * 화면이 아니라 생성자에서 죽는다 — 닫기 순서를 보기도 전에.
 */
function stubEventSource(): void {
  class FakeEventSource {
    onmessage: ((message: MessageEvent<string>) => void) | null = null;
    close(): void {
      // 구독 해제만 한다. 이 파일은 이벤트가 아니라 닫기 순서를 본다.
    }
  }
  vi.stubGlobal("EventSource", FakeEventSource);
}

/**
 * `deleteStatus` 로 "닫기가 실패했다" 를 만든다 — 그때 판정 실행이 시작되면 안 된다.
 *
 * `gate` 는 **닫기를 붙잡아 둔다.** 이것 없이 호출 순서만 보면 `Promise.all` 로 둘을 동시에
 * 띄워도 통과한다(실측). 막으려는 것은 호출이 찍히는 순서가 아니라 **닫힌 것을 확인하기 전에
 * 판정 실행이 시작되는 것**이므로, 닫기를 붙잡아 둔 채로 봐야 한다.
 */
function stubHomeFetch(
  suitePath: string,
  options: {
    readonly deleteStatus?: number;
    readonly gate?: Promise<void>;
    /** `POST /api/relay` 를 붙잡아 둔다. "여는 중" 상태를 만드는 유일한 방법이다. */
    readonly relayGate?: Promise<void>;
  } = {},
): Traffic {
  const calls: string[] = [];
  // 중계기마다 **다른 id** 를 준다. 같은 id 를 돌려주면 두 번째가 열렸는지 DELETE 경로만
  // 보고는 알 수 없다 — 첫 번째를 닫은 것과 구분이 안 된다.
  let relayCount = 0;
  const suites: readonly FileEntry[] = [{ path: suitePath }];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (method === "DELETE") {
        await options.gate;
        const status = options.deleteStatus ?? 204;
        return status === 204
          ? new Response(null, { status: 204 })
          : new Response(JSON.stringify({ error: "중계기를 닫지 못했습니다." }), { status });
      }
      if (url === "/api/relay") {
        await options.relayGate;
        relayCount += 1;
        return new Response(
          JSON.stringify({ relayId: `relay-${relayCount}`, cases: RELAY_CASES }),
          {
            status: 200,
          },
        );
      }
      if (method === "POST") {
        return new Response(JSON.stringify({ runId: "run-new" }), { status: 200 });
      }
      if (url === "/api/suites") {
        return new Response(JSON.stringify(suites), { status: 200 });
      }
      if (url === "/api/servers") {
        return new Response(JSON.stringify([WEATHER]), { status: 200 });
      }
      if (url === "/api/meta") {
        return new Response(JSON.stringify(META), { status: 200 });
      }
      return new Response("[]", { status: 200 });
    }),
  );
  return { calls };
}

const next = (): void => {
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
};

/** 1 단계 → 2 단계 → 스위트 선택 → 3 단계. 체크박스는 3 단계에 있다. */
async function goToOptions(suitePath: string): Promise<void> {
  await screen.findByRole("radio", { name: /^weather/ });
  next();
  fireEvent.click(await screen.findByRole("radio", { name: suitePath }));
  next();
}

/** 3 단계에서 체크박스를 켜고 4 단계로 들어선다. 중계기가 뜬 것을 케이스 칸으로 확인한다. */
async function goToRelay(suitePath: string): Promise<void> {
  await goToOptions(suitePath);
  fireEvent.click(screen.getByLabelText(/판정 전에 서버의 실제 응답을 본다/));
  next();
  await screen.findByText("get-weather-success");
}

describe("3 단계 체크박스와 4 단계 연결", () => {
  it("체크박스를 켜면 3 단계의 버튼이 「실행 시작」에서 「다음」으로 바뀐다", async () => {
    stubEventSource();
    stubHomeFetch("examples/a/suite.json");
    render(<Home />);
    await goToOptions("examples/a/suite.json");

    // 켜기 전에는 3 단계가 마지막이다.
    expect(screen.getByRole("button", { name: "실행 시작" })).toBeDefined();
    fireEvent.click(screen.getByLabelText(/판정 전에 서버의 실제 응답을 본다/));
    // 켜면 4 단계가 붙으므로 여기는 더 이상 마지막이 아니다. `STEPS.length` 를 한 자리라도
    // 안 고치면 「실행 시작」이 남아 4 단계로 갈 수 없다.
    expect(screen.queryByRole("button", { name: "실행 시작" })).toBeNull();
    expect(screen.getByRole("button", { name: "다음" })).toBeDefined();
  });

  it("4 단계에 들어서면 중계기를 띄우고 케이스 칸을 그린다", async () => {
    stubEventSource();
    const traffic = stubHomeFetch("examples/b/suite.json");
    render(<Home />);
    await goToRelay("examples/b/suite.json");

    expect(traffic.calls).toContain("POST /api/relay");
    // 판정은 아직 하지 않는다 — 보는 단계다.
    expect(traffic.calls.some((call) => call === "POST /api/runs")).toBe(false);
  });

  it("중계기를 못 띄우면 서버가 준 사유 전문이 4 단계에 뜬다", async () => {
    stubEventSource();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/relay") {
          return new Response(JSON.stringify({ error: "→ 중계기가 기동 줄을 내지 않았습니다." }), {
            status: 500,
          });
        }
        if (init?.method === "POST") {
          return new Response(JSON.stringify({ runId: "run-new" }), { status: 200 });
        }
        if (url === "/api/suites") {
          return new Response(JSON.stringify([{ path: "examples/c/suite.json" }]), { status: 200 });
        }
        if (url === "/api/servers") {
          return new Response(JSON.stringify([WEATHER]), { status: 200 });
        }
        if (url === "/api/meta") {
          return new Response(JSON.stringify(META), { status: 200 });
        }
        return new Response("[]", { status: 200 });
      }),
    );
    render(<Home />);
    await goToOptions("examples/c/suite.json");
    fireEvent.click(screen.getByLabelText(/판정 전에 서버의 실제 응답을 본다/));
    next();

    expect(await screen.findByText(/중계기가 기동 줄을 내지 않았습니다/)).toBeDefined();
  });

  it("HTTP 대상에서는 체크박스가 꺼져 있다", async () => {
    stubEventSource();
    stubHomeFetch("examples/d/suite.json");
    render(<Home />);
    await screen.findByRole("radio", { name: /^weather/ });
    fireEvent.click(screen.getByRole("button", { name: "HTTP URL" }));
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://example.test/mcp" },
    });
    next();
    fireEvent.click(await screen.findByRole("radio", { name: "examples/d/suite.json" }));
    next();

    const checkbox = screen.getByLabelText(/판정 전에 서버의 실제 응답을 본다/);
    expect(checkbox).toHaveProperty("disabled", true);
    expect(screen.getByText(/원격 서버에는 중계기를 붙일 수 없습니다/)).toBeDefined();
  });
});

describe("떠날 때 중계기를 먼저 닫는다", () => {
  it("닫힌 것을 확인하기 전에는 판정 실행을 시작하지 않는다", async () => {
    stubEventSource();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const traffic = stubHomeFetch("examples/e/suite.json", { gate });
    render(<Home />);
    await goToRelay("examples/e/suite.json");

    fireEvent.click(screen.getByRole("button", { name: "실행 시작" }));
    await waitFor(() => expect(traffic.calls).toContain("DELETE /api/relay/relay-1"));

    // 닫기가 아직 안 끝났다. 여기서 판정 실행이 떠 있으면 같은 사용자 서버가 두 벌 뜬다.
    expect(traffic.calls).not.toContain("POST /api/runs");

    release();
    await waitFor(() => expect(traffic.calls).toContain("POST /api/runs"));
    expect(traffic.calls.indexOf("DELETE /api/relay/relay-1")).toBeLessThan(
      traffic.calls.indexOf("POST /api/runs"),
    );
  });

  it("닫기가 실패하면 판정 실행을 시작하지 않고 그 사유를 말한다", async () => {
    stubEventSource();
    const traffic = stubHomeFetch("examples/f/suite.json", { deleteStatus: 500 });
    render(<Home />);
    await goToRelay("examples/f/suite.json");

    fireEvent.click(screen.getByRole("button", { name: "실행 시작" }));
    expect(await screen.findByText(/같은 서버가 두 벌 뜨는 것을 막기 위해서입니다/)).toBeDefined();
    // 서버가 준 문장을 고쳐 쓰지 않는다.
    expect(screen.getByText(/중계기를 닫지 못했습니다/)).toBeDefined();
    expect(traffic.calls).not.toContain("POST /api/runs");
  });

  it("「이전」으로 물러날 때도 중계기를 닫는다", async () => {
    stubEventSource();
    const traffic = stubHomeFetch("examples/g/suite.json");
    render(<Home />);
    await goToRelay("examples/g/suite.json");

    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    await waitFor(() => expect(traffic.calls).toContain("DELETE /api/relay/relay-1"));
  });

  it("화면을 떠나면(언마운트) 중계기를 닫는다", async () => {
    stubEventSource();
    const traffic = stubHomeFetch("examples/h/suite.json");
    const view = render(<Home />);
    await goToRelay("examples/h/suite.json");

    view.unmount();
    await waitFor(() => expect(traffic.calls).toContain("DELETE /api/relay/relay-1"));
  });
});

/**
 * `POST /api/relay` 는 +1, `DELETE /api/relay/...` 는 -1. **동시에 살아 있는 중계기의
 * 최대치**가 이 화면의 진짜 계약이다 — 호출이 찍힌 순서만 세면 둘이 겹쳐 떠 있어도 통과한다.
 */
function maxLiveRelays(calls: readonly string[]): number {
  let live = 0;
  let peak = 0;
  for (const call of calls) {
    if (call === "POST /api/relay") {
      live += 1;
      peak = Math.max(peak, live);
    } else if (call.startsWith("DELETE /api/relay/")) {
      live -= 1;
    }
  }
  return peak;
}

const relayPosts = (calls: readonly string[]): number =>
  calls.filter((call) => call === "POST /api/relay").length;

/** 3 단계로 돌아온 것을 확인한다. 체크박스는 3 단계에만 있다. */
const atOptions = async (): Promise<void> => {
  await screen.findByLabelText(/판정 전에 서버의 실제 응답을 본다/);
};

describe("중계기는 한 번에 하나만 뜬다", () => {
  it("「이전」으로 닫은 뒤에야 「다음」이 새 중계기를 연다", async () => {
    stubEventSource();
    const traffic = stubHomeFetch("examples/i/suite.json");
    render(<Home />);
    await goToRelay("examples/i/suite.json");

    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    await waitFor(() => expect(traffic.calls).toContain("DELETE /api/relay/relay-1"));
    await atOptions();

    next();
    await waitFor(() => expect(relayPosts(traffic.calls)).toBe(2));
    // 두 번째는 첫 번째를 닫은 **뒤에** 나갔다. 겹쳐 뜬 적이 없다.
    expect(maxLiveRelays(traffic.calls)).toBe(1);
  });

  it("「이전」의 닫기가 실패했으면 「다음」이 두 번째를 열지 않는다", async () => {
    stubEventSource();
    const traffic = stubHomeFetch("examples/j/suite.json", { deleteStatus: 500 });
    render(<Home />);
    await goToRelay("examples/j/suite.json");

    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    await waitFor(() => expect(traffic.calls).toContain("DELETE /api/relay/relay-1"));
    await atOptions();

    // 닫히지 않은 중계기가 그대로 있다. 여기서 또 열면 앞 중계기의 id 를 잃어 아무도
    // 그것을 닫지 못한다 — 사용자 서버가 고아로 남는다.
    next();
    await screen.findByText("get-weather-success");
    await waitFor(() => expect(relayPosts(traffic.calls)).toBe(1));
    expect(maxLiveRelays(traffic.calls)).toBe(1);
  });

  it("여는 중에 「이전」을 눌러도 중계기가 둘이 되지 않는다", async () => {
    stubEventSource();
    let release = (): void => undefined;
    const relayGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const traffic = stubHomeFetch("examples/k/suite.json", { relayGate });
    render(<Home />);
    await goToOptions("examples/k/suite.json");
    fireEvent.click(screen.getByLabelText(/판정 전에 서버의 실제 응답을 본다/));
    next();
    await waitFor(() => expect(traffic.calls).toContain("POST /api/relay"));

    // POST 가 아직 안 풀렸다. 여기서 물러나면 닫기는 **기다렸다가** 닫아야 한다.
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    release();
    await atOptions();
    await waitFor(() => expect(traffic.calls).toContain("DELETE /api/relay/relay-1"));

    next();
    await screen.findByText("get-weather-success");
    expect(maxLiveRelays(traffic.calls)).toBe(1);
  });
});

describe("「이전」의 닫기 실패는 화면에 보인다", () => {
  it("서버가 준 문장과 남은 것이 무엇인지 함께 뜬다", async () => {
    stubEventSource();
    stubHomeFetch("examples/l/suite.json", { deleteStatus: 500 });
    render(<Home />);
    await goToRelay("examples/l/suite.json");

    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    // 서버가 준 문장을 고쳐 쓰지 않는다.
    expect(await screen.findByText(/중계기를 닫지 못했습니다/)).toBeDefined();
    expect(screen.getByText(/중계기가 아직 떠 있습니다/)).toBeDefined();
    expect(screen.getByText(/판정 실행이 같은 서버를 두 벌 띄웁니다/)).toBeDefined();
    // 뒤로 가는 것 자체는 막지 않는다.
    await atOptions();
  });
});
