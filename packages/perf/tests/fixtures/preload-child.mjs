// preload-e2e 의 자식. 인자: 모드(fetch | http | env | cancel | cancel-decoder | unread | worker), 루프백 서버 origin.
// worker 모드가 띄우는 worker 는 같은 파일을 workerData(origin) 로 다시 실행한다.
// 프리로드가 응답 스트림을 건드리면 여기서 드러나야 하므로 일부러 단순하게 둔다.
import http from "node:http";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

const [mode, origin] = isMainThread ? process.argv.slice(2) : ["worker-inner", workerData];

/** p 가 limitMs 안에 풀리면 걸린 ms, 아니면 "timeout". */
async function within(p, limitMs) {
  const t = performance.now();
  const outcome = await Promise.race([
    p.then(() => "resolved"),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), limitMs)),
  ]);
  return outcome === "resolved" ? `resolved ${Math.round(performance.now() - t)}ms` : outcome;
}

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
} else if (mode === "cancel") {
  // 끝없는 본문의 첫 청크를 받은 뒤 버린다. 복제본이 원천을 붙들면 cancel 이 풀리지 않는다.
  const res = await fetch(`${origin}/endless`);
  const reader = res.body.getReader();
  await reader.read();
  reader.releaseLock();
  process.stdout.write(await within(res.body.cancel(), 1000));
  process.exit(0);
} else if (mode === "cancel-decoder") {
  const res = await fetch(`${origin}/endless`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  await reader.read();
  process.stdout.write(await within(reader.cancel(), 1000));
  process.exit(0);
} else if (mode === "unread") {
  // 큰 본문을 받기만 하고 읽지 않는다. 관측이 본문을 대신 당기면 루프백이 전부 보낸다.
  const res = await fetch(`${origin}/big`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  process.stdout.write(String(res.status));
  process.exit(0);
} else if (mode === "worker") {
  // worker 와 메인이 같은 pid 로 fetch 를 하나씩 한다. seq 가 겹치면 병합에서 요청이 사라진다.
  const worker = new Worker(new URL(import.meta.url), { workerData: origin });
  const fromWorker = new Promise((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
  });
  const main = await (await fetch(`${origin}/slow`)).text();
  const inner = await fromWorker;
  await worker.terminate();
  process.stdout.write(`${main}|${inner}`);
} else if (mode === "worker-inner") {
  const text = await (await fetch(`${origin}/slow`)).text();
  parentPort?.postMessage(text);
} else {
  process.stderr.write(`unknown mode: ${mode}\n`);
  process.exitCode = 2;
}
