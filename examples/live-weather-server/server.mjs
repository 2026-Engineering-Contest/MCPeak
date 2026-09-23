#!/usr/bin/env node
/**
 * 예제 MCP 서버. mcpeak 의 전 과정을 한 서버로 보여주는 데모용 서버.
 *
 * `McpServer.registerTool` 에 zod 스키마를 넘겨 **SDK 가 JSON Schema 를 만들고 인자를 검증하게**
 * 한다. 타입·필수·범위·enum 위반은 핸들러에 닿기 전에 SDK 가 `-32602` 로 거절하므로, 핸들러는
 * 스키마로 못 적는 의미 검증(모르는 도시, 종류가 다른 단위, 해석 못 하는 식)만 맡는다.
 *
 * 툴 10개가 각자 다른 단계를 맡는다.
 *
 * | 툴 | 종류 | 보여주는 것 |
 * |---|---|---|
 * | get_forecast · convert_currency · search_city | 외부 fetch | 녹화·재생. 호출마다 값이 바뀌는 비결정성을 재생이 고정한다 |
 * | list_recent_quakes | 외부 fetch | 최근 N건. 요청에 시각을 넣지 않아 재생이 맞는다(아래 5번) |
 * | add_note · list_notes | 로컬, 파일 상태 | `--determinism` 이 차이를 잡고 `--reset-cmd` 로 통과 |
 * | convert_units | 로컬 | **결함 A.** outputSchema 는 `converted` 인데 `result` 를 돌려준다 |
 * | summarize_text | 로컬 | 중첩 객체 baseline. 필수 `text` 누락은 zod 가 막는다 |
 * | lookup_country | 로컬 | enum 밖 코드는 zod 가 막는다 |
 * | evaluate_expression | 로컬 | baseline 자리값 `"example"` 이 실패하고 AI 사전보완이 값을 제안한다 |
 *
 * 결함 A 는 일부러 둔 것이다. `mcpeak test` 가 잡고 `mcpeak repair` 가 원인을 짚는 장면을
 * 위해서다. `// 결함 A` 표식이 있고 **한 줄만 고치면** 사라진다. 저수준 `Server` 시절에 있던
 * 결함 B(필수 필드 누락 미거절)·C(enum 밖 값에 정상 응답)는 zod 로 옮기면서 사라졌다. 스키마가
 * 곧 검증이라 그 두 종류의 결함은 만들 수 없다.
 *
 * 지킨 것:
 *
 * 1. **`globalThis.fetch` 만 쓴다.** `@mcpeak/record` 가 가로채는 경계가 그것 하나다(ADR-0057).
 *    `node:http`·axios 로 부르면 녹화되지 않고 재생 중 실제 네트워크로 나간다.
 * 2. **API 키가 필요 없다.** Open-Meteo · Frankfurter · USGS 는 무료·무인증이다.
 * 3. **실패 경로가 있다.** 모르는 도시, 모르는 통화, 해석 못 하는 식은 `isError: true` 로 이유를 말한다.
 * 4. **의존성은 SDK 와 zod 둘뿐이다.** `examples/zod-notes-server` 와 같은 조합이다.
 * 5. **요청에 현재 시각을 넣지 않는다.** 재생은 요청(메서드·URL·본문)의 해시로 응답을 찾는다.
 *    URL 에 `Date.now()` 가 들어가면 같은 입력이라도 매번 다른 요청이 되어 녹화본에서 못 찾는다.
 *    `list_recent_quakes` 가 예전에 그랬다(`starttime=` 에 현재 시각). 지금은 `limit` 으로 최근
 *    N건을 받아 요청이 입력만으로 정해진다.
 *
 * CI 도그푸딩 대상은 아니다(examples/README.md). 외부 API 에 기대는 서버는 CI 에서 결정론적이지
 * 않다.
 */
import { setDefaultResultOrder } from "node:dns";
import { readFileSync, writeFileSync } from "node:fs";
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

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
const QUAKES_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query";

/**
 * 메모 툴의 상태 파일. 프로세스가 새로 떠도 남는다. 그래서 `--determinism` 이 두 번째 실행에서
 * 다른 `id` 를 보고, `--reset-cmd "rm -f <이 경로>"` 를 주면 같아진다. 경로를 인자로 받지 않는
 * 것은 데모에서 경로를 맞추는 수고를 없애기 위해서다.
 *
 * `os.tmpdir()` 을 쓰지 않는다. SDK 가 자식에게 `TMPDIR` 을 넘기지 않아 서버는 `/tmp` 를 보고
 * 부모 셸은 `/var/folders/…` 를 보는 식으로 어긋난다. 그러면 초기화 명령이 엉뚱한 파일을 지운다.
 * `HOME` 은 SDK 허용 목록에 있어 양쪽이 같은 경로를 본다.
 */
export const NOTES_FILE = join(homedir(), ".live-weather-notes.json");

/**
 * 단위 표. **순서가 사양이다.** `mcpeak generate` 의 정상 분기(#401)는 enum 의 첫 값·두 번째
 * 값·마지막 값을 밟는데, 그때 상대 필드는 기준값(첫 값)에 고정된다. 첫·두 번째·마지막이 서로
 * 다른 종류면 `f → km` 같은 케이스가 생겨 서버가 옳게 거절해도 "정상 응답 기대" 로 영원히
 * 실패한다. 길이를 셋(km · m · mi) 두고 처음 둘과 마지막에 놓아 그 자리를 피한다. mi 가 맨 뒤인 이유다.
 * 도구가 enum 값 사이의 관계를 모른다는 한계는 예제 README 에 적었다.
 *
 * `factor` 는 기준 단위(길이 m · 질량 kg)로 가는 배율이다. 온도는 원점이 달라 표로 못 적고
 * `convertUnits` 가 따로 계산한다.
 */
const UNIT_KINDS = {
  km: "length",
  m: "length",
  kg: "mass",
  lb: "mass",
  c: "temp",
  f: "temp",
  mi: "length",
};
const UNITS = Object.keys(UNIT_KINDS);
const UNIT_FACTORS = { km: 1000, m: 1, mi: 1609.344, kg: 1, lb: 0.45359237 };

const COUNTRY_CODES = ["KR", "US", "JP", "DE", "FR", "GB", "BR", "IN"];
const COUNTRIES = {
  KR: { name: "대한민국", capital: "서울", currency: "KRW", callingCode: "+82" },
  US: { name: "미국", capital: "워싱턴 D.C.", currency: "USD", callingCode: "+1" },
  JP: { name: "일본", capital: "도쿄", currency: "JPY", callingCode: "+81" },
  DE: { name: "독일", capital: "베를린", currency: "EUR", callingCode: "+49" },
  FR: { name: "프랑스", capital: "파리", currency: "EUR", callingCode: "+33" },
  GB: { name: "영국", capital: "런던", currency: "GBP", callingCode: "+44" },
  BR: { name: "브라질", capital: "브라질리아", currency: "BRL", callingCode: "+55" },
  IN: { name: "인도", capital: "뉴델리", currency: "INR", callingCode: "+91" },
};
const COUNTRY_FIELDS = ["name", "capital", "currency", "callingCode"];

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

/** outputSchema 를 선언한 툴은 같은 값을 `structuredContent` 에도 싣는다. SDK 와 runner 가 대조하는 자리다. */
const structured = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  structuredContent: value,
});

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

/**
 * 외부 호출 툴의 핸들러를 감싼다. 네트워크 단절·DNS 실패가 여기로 온다. 재생 중이라면 이
 * 갈래에 닿지 않아야 정상이다. 로컬 툴은 던질 것이 없어 감싸지 않는다.
 */
const external = (handler) => async (args) => {
  try {
    return await handler(args);
  } catch (error) {
    return fail(
      `→ 외부 API 호출에 실패했습니다: ${error instanceof Error ? error.message : String(error)}\n` +
        "→ 네트워크 연결을 확인하거나, 녹화해 둔 세션이 있으면 --session 으로 재생하세요.",
    );
  }
};

const server = new McpServer({ name: "example-live-weather-server", version: "0.3.0" });

// ---------------------------------------------------------------------------
// 외부 호출 툴 넷
// ---------------------------------------------------------------------------

server.registerTool(
  "get_forecast",
  {
    description: "도시 이름으로 현재 기온과 날씨 코드를 조회한다 (Open-Meteo).",
    inputSchema: {
      city: z
        .string()
        .meta({ examples: ["부산"] })
        .describe("도시 이름. 예: 부산, Seoul"),
    },
  },
  external(async ({ city }) => {
    if (city.trim() === "") {
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
  }),
);

server.registerTool(
  "convert_currency",
  {
    description: "금액을 다른 통화로 환산한다 (Frankfurter, ECB 고시 환율).",
    inputSchema: {
      amount: z
        .number()
        .meta({ examples: [100] })
        .describe("환산할 금액"),
      from: z
        .string()
        .meta({ examples: ["USD"] })
        .describe("출발 통화 코드. 예: USD"),
      to: z
        .string()
        .meta({ examples: ["KRW"] })
        .describe("도착 통화 코드. 예: KRW"),
    },
  },
  external(async ({ amount, from, to }) => {
    if (amount < 0) {
      return fail("→ 'amount' 는 0 이상의 숫자여야 합니다.");
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
  }),
);

server.registerTool(
  "search_city",
  {
    description: "이름으로 도시를 검색해 좌표와 시간대를 돌려준다 (Open-Meteo 지오코딩).",
    inputSchema: {
      query: z
        .string()
        .meta({ examples: ["Seoul"] })
        .describe("검색어. 예: Seoul, 부산"),
      count: z.number().int().min(1).max(10).default(5).describe("최대 결과 수"),
      language: z.enum(["ko", "en", "ja"]).default("ko").describe("결과 언어"),
    },
  },
  external(async ({ query, count, language }) => {
    if (query.trim() === "") {
      return fail('→ \'query\' 는 비어 있지 않은 문자열이어야 합니다. 예: { "query": "Seoul" }');
    }
    const url = new URL(GEOCODING_URL);
    url.searchParams.set("name", query.trim());
    url.searchParams.set("count", String(count));
    url.searchParams.set("language", language);
    const data = await getJson(url);
    const results = (data.results ?? []).map((place) => ({
      name: place.name,
      country: place.country,
      latitude: place.latitude,
      longitude: place.longitude,
      timezone: place.timezone,
    }));
    if (results.length === 0) {
      return fail(
        `→ '${query}' 에 해당하는 도시를 찾지 못했습니다. 영문 정식 명칭으로 적어 보세요.`,
      );
    }
    return text({ query, count: results.length, results });
  }),
);

server.registerTool(
  "list_recent_quakes",
  {
    description: "규모 M 이상의 지진을 최근 것부터 N건 돌려준다 (USGS).",
    inputSchema: {
      minMagnitude: z.number().min(0).max(10).default(5).describe("최소 규모"),
      limit: z.number().int().min(1).max(20).default(10).describe("최대 건수"),
    },
  },
  external(async ({ minMagnitude, limit }) => {
    // 요청에 시각을 넣지 않는다. `starttime=<현재 시각>` 을 넣으면 같은 입력이라도 실행마다
    // 요청이 달라져 재생이 녹화본에서 못 찾는다(파일 상단 5번).
    const url = new URL(QUAKES_URL);
    url.searchParams.set("format", "geojson");
    url.searchParams.set("minmagnitude", String(minMagnitude));
    url.searchParams.set("orderby", "time");
    url.searchParams.set("limit", String(limit));
    const data = await getJson(url);
    const quakes = (data.features ?? []).map((f) => ({
      place: f.properties?.place,
      magnitude: f.properties?.mag,
      time: new Date(f.properties?.time ?? 0).toISOString(),
    }));
    return text({ minMagnitude, limit, count: quakes.length, quakes });
  }),
);

// ---------------------------------------------------------------------------
// 파일 상태 툴 둘
// ---------------------------------------------------------------------------

function readNotes() {
  try {
    const parsed = JSON.parse(readFileSync(NOTES_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeNotes(notes) {
  writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2));
}

server.registerTool(
  "add_note",
  {
    description: "메모를 하나 추가한다. 파일에 저장되므로 서버를 다시 띄워도 남는다.",
    inputSchema: {
      title: z.string().min(1).describe("제목"),
      body: z.string().describe("본문"),
      tags: z.array(z.string()).default([]).describe("태그 목록"),
    },
  },
  async ({ title, body, tags }) => {
    if (title.trim() === "") {
      return fail("→ 'title' 은 비어 있지 않은 문자열이어야 합니다.");
    }
    const notes = readNotes();
    const note = { id: notes.length + 1, title: title.trim(), body, tags };
    notes.push(note);
    writeNotes(notes);
    return text({ id: note.id, title: note.title, count: notes.length, file: NOTES_FILE });
  },
);

server.registerTool(
  "list_notes",
  {
    description: "저장된 메모를 돌려준다. 태그로 거를 수 있다.",
    inputSchema: {
      tag: z.string().optional().describe("이 태그가 붙은 메모만"),
    },
  },
  async ({ tag }) => {
    const notes = readNotes().filter((note) => tag === undefined || note.tags.includes(tag));
    return text({ count: notes.length, notes });
  },
);

// ---------------------------------------------------------------------------
// 로컬 결정론 툴 넷 (결함 A 가 여기 있다)
// ---------------------------------------------------------------------------

server.registerTool(
  "convert_units",
  {
    description: "길이(km·m·mi)·질량(kg·lb)·온도(c·f) 단위를 환산한다. 같은 종류끼리만 된다.",
    inputSchema: {
      value: z.number().describe("환산할 값"),
      from: z.enum(UNITS).describe("출발 단위"),
      to: z.enum(UNITS).describe("도착 단위"),
    },
    outputSchema: {
      value: z.number(),
      from: z.string(),
      to: z.string(),
      converted: z.number(),
    },
  },
  async ({ value, from, to }) => {
    if (UNIT_KINDS[from] !== UNIT_KINDS[to]) {
      return fail(
        `→ '${from}'(${UNIT_KINDS[from]}) 을 '${to}'(${UNIT_KINDS[to]}) 로 환산할 수 없습니다. 같은 종류의 단위끼리만 됩니다.`,
      );
    }
    let converted = value;
    if (from !== to) {
      if (UNIT_KINDS[from] === "temp")
        converted = from === "c" ? value * 1.8 + 32 : (value - 32) / 1.8;
      else converted = (value * UNIT_FACTORS[from]) / UNIT_FACTORS[to];
    }
    converted = Math.round(converted * 1000) / 1000;
    // 결함 A: outputSchema 는 `converted` 를 선언하는데 여기서는 `result` 로 싣는다. 한 줄 수정: result → converted
    return structured({ value, from, to, result: converted });
  },
);

server.registerTool(
  "summarize_text",
  {
    description: "본문을 앞에서부터 N단어로 줄인다. 외부 호출 없이 결정론적으로 동작한다.",
    inputSchema: {
      text: z.string().describe("요약할 본문"),
      options: z
        .object({
          maxWords: z.number().int().min(1).max(200).default(20),
          style: z.enum(["plain", "bullets"]).default("plain"),
        })
        .optional(),
    },
  },
  async ({ text: body, options }) => {
    const { maxWords = 20, style = "plain" } = options ?? {};
    const words = body.split(/\s+/).filter((word) => word !== "");
    const kept = words.slice(0, maxWords);
    const summary =
      style === "bullets" ? kept.map((word) => `- ${word}`).join("\n") : kept.join(" ");
    return text({ summary, wordCount: kept.length, truncated: words.length > kept.length });
  },
);

server.registerTool(
  "lookup_country",
  {
    description: "ISO 3166-1 alpha-2 코드로 나라 정보를 돌려준다. 내장 표에서 읽는다.",
    inputSchema: {
      code: z.enum(COUNTRY_CODES).describe("나라 코드. 예: KR"),
      fields: z.array(z.enum(COUNTRY_FIELDS)).default(COUNTRY_FIELDS).describe("돌려줄 필드"),
    },
  },
  async ({ code, fields }) => {
    // enum 밖의 코드는 SDK 가 -32602 로 거절하므로 여기 오는 code 는 항상 표에 있다.
    const country = COUNTRIES[code];
    const picked = Object.fromEntries(fields.map((field) => [field, country[field]]));
    return text({ code, ...picked });
  },
);

/**
 * 사칙연산 계산기. `eval` 을 쓰지 않고 재귀 하강으로 푼다. 문법은
 * expr := term (('+'|'-') term)* / term := factor (('*'|'/') factor)* / factor := number | '(' expr ')' | '-' factor
 */
function evaluate(source) {
  const tokens = source.match(/\d+(?:\.\d+)?|[()+\-*/]/g) ?? [];
  const consumed = tokens.join("");
  if (consumed !== source.replace(/\s+/g, "")) {
    throw new Error("숫자 · + - * / · 괄호 외의 문자가 있습니다");
  }
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const factor = () => {
    const token = next();
    if (token === undefined) throw new Error("식이 갑자기 끝났습니다");
    if (token === "(") {
      const value = expr();
      if (next() !== ")") throw new Error("닫는 괄호가 없습니다");
      return value;
    }
    if (token === "-") return -factor();
    if (/^\d/.test(token)) return Number(token);
    throw new Error(`'${token}' 자리에 숫자나 괄호가 와야 합니다`);
  };
  const term = () => {
    let value = factor();
    while (peek() === "*" || peek() === "/") {
      const op = next();
      const rhs = factor();
      if (op === "/" && rhs === 0) throw new Error("0 으로 나눌 수 없습니다");
      value = op === "*" ? value * rhs : value / rhs;
    }
    return value;
  };
  const expr = () => {
    let value = term();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const rhs = term();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  };
  const value = expr();
  if (pos !== tokens.length) throw new Error(`'${tokens[pos]}' 뒤를 해석할 수 없습니다`);
  return value;
}

server.registerTool(
  "evaluate_expression",
  {
    description: "사칙연산과 괄호로 된 수식을 계산한다. 예: (2 + 3) * 4 / 5",
    inputSchema: {
      expression: z.string().min(1).describe("수식. 예: 2 + 2 * 3"),
    },
    outputSchema: {
      expression: z.string(),
      value: z.number(),
    },
  },
  async ({ expression }) => {
    if (expression.trim() === "") {
      return fail(
        '→ \'expression\' 은 비어 있지 않은 문자열이어야 합니다. 예: { "expression": "2 + 2 * 3" }',
      );
    }
    try {
      const value = evaluate(expression);
      return structured({ expression, value });
    } catch (error) {
      return fail(
        `→ 식을 해석할 수 없습니다: '${expression}' (${error.message})\n` +
          "→ 숫자, + - * /, 괄호만 쓸 수 있습니다. 예: (2 + 3) * 4 / 5",
      );
    }
  },
);

await server.connect(new StdioServerTransport());
