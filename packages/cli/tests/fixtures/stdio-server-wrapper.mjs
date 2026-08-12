import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const [pidFile, targetModule] = process.argv.slice(2);
if (pidFile === undefined || targetModule === undefined)
  throw new Error("pid file과 target module 경로가 필요합니다.");
await writeFile(pidFile, String(process.pid), "utf8");
await import(pathToFileURL(targetModule).href);
