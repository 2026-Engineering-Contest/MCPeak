// mcp-package-version check_docker_tags 의 호출 구조를 그대로 재현해 직렬 vs 팬아웃을 잰다.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const axios = require("../servers/node_modules/axios");
const repo = "library/nginx", reg = "https://registry.hub.docker.com/v2", limit = 5;
const now = () => performance.now();
async function run(mode) {
  const t0 = now();
  const tok = (await axios.get(`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`)).data.token;
  const h = { Authorization: `Bearer ${tok}` };
  const tl = await axios.get(`${reg}/${repo}/tags/list`, { headers: h });
  const tags = tl.data.tags.slice(0, limit);
  const tPre = now() - t0;
  const man = (t) => axios.get(`${reg}/${repo}/manifests/${t}`, { headers: { ...h, Accept: "application/vnd.docker.distribution.manifest.v2+json" } });
  const det = (t) => axios.get(`https://hub.docker.com/v2/repositories/${repo}/tags/${t}`);
  let rl = null, statuses = [];
  const rec = (r) => { statuses.push(r.status); rl ??= r.headers["ratelimit-remaining"]; return r; };
  const err = (e) => { statuses.push(e.response?.status ?? "ERR"); };
  if (mode === "serial") { for (const t of tags) await man(t).then(rec, err); for (const t of tags) await det(t).then(rec, err); }
  else await Promise.all([...tags.map((t) => man(t).then(rec, err)), ...tags.map((t) => det(t).then(rec, err))]);
  return { mode, total: Math.round(now() - t0), preDependent: Math.round(tPre), statuses: statuses.join(","), rateRemaining: rl };
}
for (const m of ["serial", "parallel", "serial", "parallel"]) console.log(JSON.stringify(await run(m)));
