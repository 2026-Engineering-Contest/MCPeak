import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

if (process.env.MCPEAK_PID_FILE) writeFileSync(process.env.MCPEAK_PID_FILE, String(process.pid));

const target = process.env.MCPEAK_TARGET_MODULE;
if (target) {
  await import(pathToFileURL(target).href);
} else {
  process.stdin.resume();
}
