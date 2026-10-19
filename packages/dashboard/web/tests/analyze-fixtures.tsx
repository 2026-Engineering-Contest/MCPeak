/**
 * Analyze 화면 테스트의 공용 helper. DOM 을 쓰는 helper, 합친 fetch fake, `FakeEventSource`, 진입 helper 가
 * 여기 있다. 데이터는 `analyze-fixture-data.ts` 에 있고 여기서 re-export 한다. include 글롭
 * `tests/**\/*.test.{ts,tsx}` 에 걸리지 않으므로 테스트로 수집되지 않는다.
 */
import type { RenderResult } from "@testing-library/react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, vi } from "vitest";
import type { RunEventInput, ServerCandidate } from "../../src/api-types.js";
import type { AnalyzePillar } from "../src/analyze/types.js";
import { AnalyzeView } from "../src/screens/AnalyzeView.js";
import {
  analyzeResponse,
  META,
  previewResponse,
  securityResponse,
  WEATHER,
} from "./analyze-fixture-data.js";

export * from "./analyze-fixture-data.js";

/** run-view.test 와 같은 방식의 EventSource fake. 네트워크·서버 없음. */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  #nextId = 1;

  emit(event: RunEventInput): void {
    const withId = { id: this.#nextId++, ...event };
    this.onmessage?.({ data: JSON.stringify(withId) } as MessageEvent<string>);
  }

  close(): void {
    this.closed = true;
  }
}

export function lastSource(): FakeEventSource {
  const source = FakeEventSource.instances.at(-1);
  if (source === undefined) {
    throw new Error("EventSource가 만들어지지 않았습니다.");
  }
  return source;
}

/**
 * `EventSource` 전역을 fake 로 바꾸고 인스턴스 목록을 비운다. 두 테스트 파일 모두 `beforeEach` 에서 부른다.
 * 분석하기가 보안 run 도 시작하므로 비용 테스트도 필요하다(jsdom 에는 `EventSource` 가 없다).
 */
export function installFakeEventSource(): void {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
}

/** 비교 `<pre>` 의 줄 하나에서 표시 글자(`aria-hidden`)를 뺀 원래 줄. */
export function lineText(line: Element): string {
  return [...line.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? "")
    .join("");
}

/** 비교 `<pre>` 를 줄 단위로 읽어 원래 문자열로 되돌린다. */
export function preText(pre: Element): string {
  return [...pre.querySelectorAll("[data-diff]")].map(lineText).join("\n");
}

/** `container` 안에서 글자 전체(자식 요소의 글자 포함)가 `text` 인 `<p>`. 한 줄이 여러 조각으로 나뉜 자리에 쓴다. */
export function lineOf(container: HTMLElement, text: string): HTMLElement {
  return within(container).getByText(
    (_, element) => element?.tagName === "P" && element.textContent === text,
  );
}

/** 규칙 id 가 `ruleId` 인 발견의 `<li>`. */
export function findingOf(ruleId: string): HTMLElement {
  const item = screen.getByText(ruleId).closest("li");
  if (item === null) {
    throw new Error(`발견이 <li> 안에 없다: ${ruleId}`);
  }
  return item;
}

/** 제목이 `name` 인 구획(`<section>`). */
export function sectionOf(name: string | RegExp): HTMLElement {
  const section = screen.getByRole("heading", { level: 3, name }).closest("section");
  if (section === null) {
    throw new Error(`구획을 찾지 못했습니다: ${String(name)}`);
  }
  return section;
}

export interface StubResponse {
  readonly status: number;
  readonly body: unknown;
  /** true 면 영원히 resolve 되지 않는 Promise 를 돌려준다. "같은 틱" 단언용. */
  readonly pending?: true;
}

export const PENDING: StubResponse = { status: 0, body: undefined, pending: true };

/**
 * home.test 의 stubFetch 와 같은 방식. 두 패널 테스트의 stubFetch 를 합친 것이라 옵션 이름은 그 둘의 것
 * 그대로다. 배열로 주면 요청 순서대로 하나씩 쓰고, 다 쓰면 마지막 것을 되풀이한다.
 */
export function stubFetch(
  options: {
    readonly servers?: readonly ServerCandidate[];
    /** POST /api/analyze/tokens */
    readonly analyze?: StubResponse | readonly StubResponse[];
    /** POST /api/analyze/source-edits */
    readonly sourceEdits?: readonly StubResponse[];
    /** POST /api/analyze/security */
    readonly start?: StubResponse | readonly StubResponse[];
    /** GET /api/analyze/security/<id> */
    readonly result?: StubResponse | readonly StubResponse[];
    /** 주면 `GET /api/runs/<id>` 가 이것을 돌려준다. 없으면 도는 run 의 summary 다. */
    readonly summary?: StubResponse;
  } = {},
): ReturnType<typeof vi.fn> {
  const servers = options.servers ?? [WEATHER];
  const analyzeQueue: readonly StubResponse[] = [
    options.analyze ?? { status: 200, body: analyzeResponse() },
  ].flat();
  const sourceEditQueue = options.sourceEdits ?? [{ status: 200, body: previewResponse() }];
  const startQueue: readonly StubResponse[] = [
    options.start ?? { status: 200, body: { runId: "r1" } },
  ].flat();
  const resultQueue: readonly StubResponse[] = [
    options.result ?? { status: 200, body: securityResponse() },
  ].flat();
  let analyzeCount = 0;
  let sourceEditCount = 0;
  let startCount = 0;
  let resultCount = 0;
  const take = (queue: readonly StubResponse[], index: number): Promise<Response> => {
    const picked = queue[Math.min(index, queue.length - 1)];
    if (picked?.pending === true) {
      return new Promise(() => {});
    }
    return Promise.resolve(
      new Response(JSON.stringify(picked?.body), { status: picked?.status ?? 500 }),
    );
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST" && url === "/api/analyze/tokens") {
      analyzeCount += 1;
      return take(analyzeQueue, analyzeCount - 1);
    }
    if (init?.method === "POST" && url === "/api/analyze/source-edits") {
      sourceEditCount += 1;
      return take(sourceEditQueue, sourceEditCount - 1);
    }
    if (init?.method === "POST" && url === "/api/analyze/security") {
      startCount += 1;
      return take(startQueue, startCount - 1);
    }
    if (url.startsWith("/api/analyze/security/")) {
      resultCount += 1;
      return take(resultQueue, resultCount - 1);
    }
    // 훅이 마운트마다 run 의 summary 를 한 번 읽는다(#295).
    if (/^\/api\/runs\/[^/]+$/.test(url)) {
      if (options.summary !== undefined) {
        return take([options.summary], 0);
      }
      const runId = decodeURIComponent(url.slice("/api/runs/".length));
      return new Response(
        JSON.stringify({ runId, flow: "audit", status: "running", exitCode: null, argv: [] }),
        { status: 200 },
      );
    }
    if (url === "/api/servers") {
      return new Response(JSON.stringify(servers), { status: 200 });
    }
    if (url === "/api/meta") {
      return new Response(JSON.stringify(META), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** `url` 로 보낸 POST 본문을 보낸 순서대로. */
export function postedBodies(
  fetchMock: ReturnType<typeof vi.fn>,
  url: string,
): readonly Record<string, unknown>[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => String(input) === url && init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
}

export function sentBody(
  fetchMock: ReturnType<typeof vi.fn>,
  method: string,
): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === method);
  return JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>;
}

/** 결과를 읽은 요청의 주소를 보낸 순서대로. */
export function resultRequests(fetchMock: ReturnType<typeof vi.fn>): readonly string[] {
  return fetchMock.mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.startsWith("/api/analyze/security/"));
}

/** 첫 후보가 뜰 때까지 기다린 뒤 분석하기를 누른다. 응답은 기다리지 않는다. */
export async function runAll(): Promise<void> {
  await screen.findByRole("radio", { name: /^weather/ });
  fireEvent.click(screen.getByRole("button", { name: "분석하기" }));
}

/** 상세를 연다. 해시는 바꾸지 않는다(AnalyzeView 는 pillar prop 만 본다). */
export function showDetail(rerender: RenderResult["rerender"], pillar: AnalyzePillar | null): void {
  rerender(<AnalyzeView pillar={pillar} />);
}

/** 보안 카드 요소. 결과 단계에서만 있다. */
export function securityCard(): HTMLElement {
  return screen.getByRole("tab", { name: /^보안/ });
}

/** 비용 카드 요소. 결과 단계에서만 있다. */
export function costCard(): HTMLElement {
  return screen.getByRole("tab", { name: /^비용 최적화/ });
}

/** 펼친 상세(`tabpanel`). 이름은 카드에서 오므로 id 로 찾는다. 없으면 던진다. */
function detailPanel(pillar: AnalyzePillar): HTMLElement {
  const panel = document.getElementById(`panel-${pillar}`);
  if (panel === null) {
    throw new Error(`상세가 펼쳐져 있지 않습니다: ${pillar}`);
  }
  return panel;
}

/** 펼친 보안 상세. `showDetail(rerender, "security")` 뒤에 쓴다. */
export function securityDetail(): HTMLElement {
  return detailPanel("security");
}

/** 펼친 비용 최적화 상세. `showDetail(rerender, "tokens")` 뒤에 쓴다. */
export function costDetail(): HTMLElement {
  return detailPanel("tokens");
}

/** 비용 카드가 running 을 벗어날 때까지("분석 중…" 배지가 사라질 때까지) 기다린다. done 이든 failed 든. */
export async function waitTokensSettled(): Promise<void> {
  await waitFor(() => expect(within(costCard()).queryByText("분석 중…")).toBeNull());
}

/** 마지막 FakeEventSource 에 done 을 흘리고 보안 카드가 running 을 벗어날 때까지 기다린다. 그 source 를 돌려준다. */
export async function finishSecurityRun(exitCode = 2): Promise<FakeEventSource> {
  // 스트림은 시작 POST 가 resolve 된 뒤에 열린다.
  await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
  const source = lastSource();
  act(() => {
    source.emit({ kind: "done", exitCode });
  });
  await waitFor(() => expect(within(securityCard()).queryByText("점검 중…")).toBeNull());
  return source;
}
