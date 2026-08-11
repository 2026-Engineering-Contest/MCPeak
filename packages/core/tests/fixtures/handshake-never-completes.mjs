import { writeFileSync } from "node:fs";

if (process.env.OHMYMCP_PID_FILE) writeFileSync(process.env.OHMYMCP_PID_FILE, String(process.pid));
process.stdin.resume();
