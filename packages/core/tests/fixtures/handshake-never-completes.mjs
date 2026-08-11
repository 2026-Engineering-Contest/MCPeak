import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

if (process.env.OHMYMCP_PID_FILE) writeFileSync(process.env.OHMYMCP_PID_FILE, String(process.pid));

const target = process.env.OHMYMCP_TARGET_MODULE;
if (target) {
  await import(pathToFileURL(target).href);
} else {
  process.stdin.resume();
}
