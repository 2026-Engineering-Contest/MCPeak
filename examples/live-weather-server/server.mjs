#!/usr/bin/env node
/**
 * 예제 MCP 서버 — 실제 공개 API 를 부르는 날씨·환율 조회.
 *
 * `weather-server` 와 반대로 **일부러 외부에 의존한다.** External 세션(`mcpeak test --record-session`
 * / `--session`)이 무엇을 해결하는지 보여주는 대상이다. 같은 도시를 두 번 물으면 온도가 다를 수
 * 있고, 네트워크가 없으면 실패한다. 녹화해 두면 그 둘이 사라진다.
 *
 * 지킨 것:
 *
 * 1. **`globalThis.fetch` 만 쓴다.** `@mcpeak/record` 가 가로채는 경계가 그것 하나다(ADR-0057).
 *    `node:http`·axios 로 부르면 녹화되지 않고 재생 중 실제 네트워크로 나간다.
 * 2. **API 키가 필요 없다.** Open-Meteo 와 Frankfurter 는 무료·무인증이다.
 * 3. **실패 경로가 있다.** 모르는 도시, 모르는 통화 코드는 `isError: true` 로 이유를 말한다.
 *
 * CI 도그푸딩 대상은 아니다(examples/README.md). 외부 API 에 기대는 서버는 CI 에서 결정론적이지
 * 않다. 이 서버의 쓸모는 녹화·재생 데모다.
 */
import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// Open-Meteo 는 AAAA 레코드를 내놓는데, IPv6 가 라우팅되지 않는 망(카페 와이파이·일부 회사망)에서
// Node 는 v6 를 먼저 잡고 실패한다. 그리고 v4 로 넘어갈 때 쓰는 시도 타임아웃 기본값이 250ms 라
// 유럽 서버(왕복 240ms 안팎)에서는 v4 마저 ETIMEDOUT 으로 끝난다. curl 은 둘 다 되니까
// "브라우저는 되는데 서버만 실패" 로 보인다. 예제가 데모 장소를 가리면 안 되므로 v4 를 먼저
// 쓰고 시도 타임아웃을 넉넉히 준다.
setDefaultResultOrder("ipv4first");
setDefaultAutoSelectFamilyAttemptTimeout(3000);

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const RATES_URL = "https://api.frankfurter.dev/v1/latest";

const TOOLS = [
  {
    name: "get_forecast",
    description: "도시 이름으로 현재 기온과 날씨 코드를 조회한다 (Open-Meteo).",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string", description: "도시 이름. 예: 부산, Seoul" } },
      required: ["city"],
    },
  },
  {
    name: "convert_currency",
    description: "금액을 다른 통화로 환산한다 (Frankfurter, ECB 고시 환율).",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "환산할 금액" },
        from: { type: "string", description: "출발 통화 코드. 예: USD" },
        to: { type: "string", description: "도착 통화 코드. 예: KRW" },
      },
      required: ["amount", "from", "to"],
    },
  },
];

/** WMO 날씨 코드 중 자주 나오는 것만. 모르는 코드는 숫자 그대로 돌려준다. */
const WEATHER_CODES = {
  0: "맑음",
  1: "대체로 맑음",
  2: "구름 조금",
  3: "흐림",
  45: "안개",
  51: "이슬비",
  61: "비",
  63: "비",
  65: "강한 비",
  71: "눈",
  80: "소나기",
  95: "뇌우",
};

const text = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

/** 실패 메시지가 곧 제품이다. 무엇이 왜 안 됐고 무엇을 쓸 수 있는지 알려준다. */
const fail = (message) => ({ content: [{ type: "text", text: message }], isError: true });

/**
 * JSON 을 받는 GET 한 번. 외부 호출은 전부 이 함수를 지나고, 이 함수는 `globalThis.fetch`
 * 만 부른다. 그래야 External 세션이 빠짐없이 가로챈다.
 */
async function getJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function getForecast(args) {
  const city = args?.city;
  if (typeof city !== "string" || city.trim() === "") {
    return fail('→ \'city\' 는 비어 있지 않은 문자열이어야 합니다. 예: { "city": "부산" }');
  }

  const geo = new URL(GEOCODING_URL);
  geo.searchParams.set("name", city.trim());
  geo.searchParams.set("count", "1");
  geo.searchParams.set("language", "ko");
  const places = await getJson(geo);
  const place = places.results?.[0];
  if (place === undefined) {
    return fail(
      `→ '${city}' 에 해당하는 지역을 찾지 못했습니다.\n` +
        "→ 도시 이름을 한글이나 영문 정식 명칭으로 적어 보세요. 예: 부산, Seoul, Tokyo",
    );
  }

  const forecast = new URL(FORECAST_URL);
  forecast.searchParams.set("latitude", String(place.latitude));
  forecast.searchParams.set("longitude", String(place.longitude));
  forecast.searchParams.set("current", "temperature_2m,weather_code");
  forecast.searchParams.set("timezone", place.timezone ?? "UTC");
  const data = await getJson(forecast);
  const code = data.current?.weather_code;

  return text({
    city: place.name,
    country: place.country,
    temp: data.current?.temperature_2m,
    condition: WEATHER_CODES[code] ?? `코드 ${code}`,
    observedAt: data.current?.time,
  });
}

async function convertCurrency(args) {
  const { amount, from, to } = args ?? {};
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    return fail("→ 'amount' 는 0 이상의 숫자여야 합니다.");
  }
  if (typeof from !== "string" || typeof to !== "string") {
    return fail(
      '→ \'from\' 과 \'to\' 는 통화 코드 문자열이어야 합니다. 예: { "from": "USD", "to": "KRW" }',
    );
  }
  const base = from.toUpperCase();
  const quote = to.toUpperCase();
  if (base === quote) {
    return text({ amount, from: base, to: quote, converted: amount, rate: 1 });
  }

  const url = new URL(RATES_URL);
  url.searchParams.set("base", base);
  url.searchParams.set("symbols", quote);
  let data;
  try {
    data = await getJson(url);
  } catch (error) {
    if (error?.status === 404 || error?.status === 422) {
      return fail(
        `→ '${base}' → '${quote}' 환율을 찾지 못했습니다.\n` +
          "→ ISO 4217 통화 코드인지 확인하세요. 예: USD, EUR, KRW, JPY",
      );
    }
    throw error;
  }
  const rate = data.rates?.[quote];
  if (typeof rate !== "number") {
    return fail(`→ 응답에 '${quote}' 환율이 없습니다. 지원하지 않는 통화일 수 있습니다.`);
  }
  return text({
    amount,
    from: base,
    to: quote,
    converted: Math.round(amount * rate * 100) / 100,
    rate,
    date: data.date,
  });
}

async function handleCall(name, args) {
  try {
    if (name === "get_forecast") return await getForecast(args);
    if (name === "convert_currency") return await convertCurrency(args);
    return fail(
      `→ 알 수 없는 툴 '${name}'. 사용 가능한 툴: ${TOOLS.map((t) => t.name).join(", ")}`,
    );
  } catch (error) {
    // 네트워크 단절·DNS 실패가 여기로 온다. 재생 중이라면 이 갈래에 닿지 않아야 정상이다.
    return fail(
      `→ 외부 API 호출에 실패했습니다: ${error instanceof Error ? error.message : String(error)}\n` +
        "→ 네트워크 연결을 확인하거나, 녹화해 둔 세션이 있으면 --session 으로 재생하세요.",
    );
  }
}

const server = new Server(
  { name: "example-live-weather-server", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) =>
  handleCall(req.params.name, req.params.arguments),
);

await server.connect(new StdioServerTransport());
