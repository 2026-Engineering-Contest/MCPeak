#!/usr/bin/env node
/**
 * 통제 **변이** 서버. `server.mjs` 에서 zod 제약 세 곳만 느슨하게 한 것이다.
 *
 *   title:    z.string().min(1).max(80)            → z.string()
 *   priority: z.enum(PRIORITIES)                   → z.string()
 *   limit:    z.number().int().min(1).max(50)      → z.number()
 *
 * 정상 서버에서 만든 명세를 이 서버에 돌리면 정확히 4건이 실패해야 한다
 * (create-note-enum-priority · create-note-range-title · list-notes-type-limit ·
 * list-notes-range-limit). 그 4건이 통과하면 우리 도구가 그 축의 검출력을 잃은 것이다.
 *
 * **실제 서버로 쓰지 마라.** `server.mjs` 가 이 예제의 정상 구현이다.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const PRIORITIES = ["low", "mid", "high"];
const TAGS = ["home", "work", "idea"];

/**
 * 정상 케이스가 조회할 id. `get_note` 의 스키마에 `examples` 로 선언한다. 생성기는 선언된
 * 예시값을 그대로 쓰므로(ADR-0004) 정상 케이스가 실재하는 노트를 맞춘다. 생성기의 대표 UUID 를
 * 시드에 넣는 방향은 택하지 않았다. 예제가 생성기 내부 상수에 묶이기 때문이다.
 */
const EXAMPLE_ID = "11111111-1111-4111-8111-111111111111";

/** 고정 데이터. 외부 API 를 부르지 않으므로 언제 돌려도 결과가 같다. */
const NOTES = {
  [EXAMPLE_ID]: {
    title: "장보기",
    body: "우유, 달걀, 식빵",
    tags: ["home"],
    priority: "low",
    dueAt: "2026-01-02T03:04:05Z",
    parentId: null,
  },
  "22222222-2222-4222-8222-222222222222": {
    title: "회의 준비",
    body: "",
    tags: ["work", "idea"],
    priority: "high",
    dueAt: null,
    parentId: EXAMPLE_ID,
  },
};

const text = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

/** 실패 메시지가 곧 제품이다. 무엇이 왜 안 됐고 무엇을 쓸 수 있는지 알려준다. */
const fail = (message) => ({ content: [{ type: "text", text: message }], isError: true });

const server = new McpServer({ name: "example-zod-notes-server", version: "0.1.0" });

// `.strict()` 를 건 ZodObject 를 그대로 넘긴다. SDK 는 루트에 additionalProperties: false 를 내고,
// runner 는 그것을 UNDECLARED_FIELD 축으로 읽는다. 이 툴만 그렇게 해서 raw shape 경로(아래 둘)와
// ZodObject 경로를 한 서버에서 모두 밟는다.
server.registerTool(
  "get_note",
  {
    description: "id 로 노트 하나를 조회한다.",
    inputSchema: z
      .object({
        id: z
          .string()
          .uuid()
          .meta({ examples: [EXAMPLE_ID] })
          .describe("노트 id (UUID)"),
      })
      .strict(),
  },
  async ({ id }) => {
    if (!Object.hasOwn(NOTES, id)) {
      return fail(
        `→ id '${id}' 인 노트가 없습니다. 있는 노트: ${Object.keys(NOTES).join(", ")}\n` +
          "→ 이 예제 서버는 고정 데이터만 가지고 있습니다.",
      );
    }
    return text({ id, ...NOTES[id] });
  },
);

server.registerTool(
  "create_note",
  {
    description: "노트를 만든다. 저장하지 않고 받은 값을 그대로 돌려준다.",
    inputSchema: {
      title: z.string().describe("제목"),
      body: z.string().optional().describe("본문"),
      tags: z.array(z.enum(TAGS)).max(5).optional().describe("태그"),
      priority: z.string().describe("우선순위"),
      dueAt: z.string().datetime().nullable().describe("마감 시각. 없으면 null"),
      parentId: z.string().uuid().optional().describe("상위 노트 id"),
      author: z.object({
        name: z.string().min(1).describe("작성자 이름"),
        email: z.string().email().optional().describe("작성자 이메일"),
      }),
    },
  },
  async (input) => {
    if (input.parentId !== undefined && !Object.hasOwn(NOTES, input.parentId)) {
      return fail(
        `→ 상위 노트 '${input.parentId}' 가 없습니다. 있는 노트: ${Object.keys(NOTES).join(", ")}`,
      );
    }
    // 저장하지 않는다. 저장하면 케이스 실행 순서에 따라 응답이 달라진다(결정론성).
    return text({ id: "33333333-3333-4333-8333-333333333333", ...input });
  },
);

server.registerTool(
  "list_notes",
  {
    description: "노트 id 목록을 돌려준다. filter 로 태그·우선순위를 거른다.",
    inputSchema: {
      filter: z
        .object({
          tag: z.enum(TAGS).optional().describe("이 태그가 붙은 노트만"),
          priority: z.enum(PRIORITIES).nullable().describe("이 우선순위만. null 이면 전부"),
        })
        .optional(),
      limit: z.number().default(10).describe("최대 개수"),
    },
  },
  async ({ filter, limit }) => {
    const ids = Object.keys(NOTES)
      .filter((id) => filter?.tag === undefined || NOTES[id].tags.includes(filter.tag))
      .filter((id) => filter?.priority == null || NOTES[id].priority === filter.priority)
      .sort()
      .slice(0, limit);
    return text({ ids });
  },
);

await server.connect(new StdioServerTransport());
