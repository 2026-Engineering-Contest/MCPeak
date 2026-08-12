import { writeFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "pending-call-tool", version: "1.0.0" },
  { capabilities: { tools: {} } },
);
if (process.env.OHMYMCP_PID_FILE) writeFileSync(process.env.OHMYMCP_PID_FILE, String(process.pid));
server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [{ name: "wait", inputSchema: { type: "object" } }],
}));
server.setRequestHandler(CallToolRequestSchema, () => new Promise(() => {}));
await server.connect(new StdioServerTransport());
