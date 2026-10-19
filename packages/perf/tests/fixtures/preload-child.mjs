// preload-e2e 의 자식. 인자: 모드(fetch | http | env), 루프백 서버 origin.
// 프리로드가 응답 스트림을 건드리면 여기서 드러나야 하므로 일부러 단순하게 둔다.
import http from "node:http";

const [mode, origin] = process.argv.slice(2);

if (mode === "fetch") {
  const res = await fetch(`${origin}/slow`, {
    headers: { authorization: "Bearer t", accept: "application/json", "x-trace": "1" },
  });
  process.stdout.write(await res.text());
} else if (mode === "http") {
  http.get(`${origin}/slow`, (res) => {
    // 리스너를 20ms 늦게 단다. 프리로드가 스트림을 flowing 으로 바꾸면 첫 청크를 잃는다.
    setTimeout(() => {
      res.setEncoding("utf8");
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        process.stdout.write(body);
      });
    }, 20);
  });
} else if (mode === "env") {
  process.stdout.write(process.env.MCPEAK_PERF_TRACE_DIR ?? "");
} else {
  process.stderr.write(`unknown mode: ${mode}\n`);
  process.exitCode = 2;
}
