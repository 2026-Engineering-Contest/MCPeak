// JS 파일에서 주석을 벗겨 stdout 으로 낸다. 문자열·템플릿 리터럴 안의 // 와 /* 는 건드리지 않는다.
import { readFileSync } from "node:fs";

const src = readFileSync(process.argv[2], "utf8");
let out = "",
  i = 0;
while (i < src.length) {
  const c = src[i],
    n = src[i + 1];
  if (c === '"' || c === "'" || c === "`") {
    const q = c;
    out += c;
    i++;
    while (i < src.length && src[i] !== q) {
      if (src[i] === "\\") {
        out += src[i++];
      }
      out += src[i++];
    }
    out += src[i++] ?? "";
    continue;
  }
  if (c === "/" && n === "/") {
    while (i < src.length && src[i] !== "\n") i++;
    continue;
  }
  if (c === "/" && n === "*") {
    i += 2;
    while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
    i += 2;
    continue;
  }
  out += c;
  i++;
}
process.stdout.write(out.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n"));
