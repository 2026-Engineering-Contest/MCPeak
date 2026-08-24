import { writeFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "pending-list-tools", version: "1.0.0" },
  { capabilities: { tools: {} } },
);
if (process.env.MCPEAK_PID_FILE) writeFileSync(process.env.MCPEAK_PID_FILE, String(process.pid));
server.setRequestHandler(ListToolsRequestSchema, () => new Promise(() => {}));
await server.connect(new StdioServerTransport());
