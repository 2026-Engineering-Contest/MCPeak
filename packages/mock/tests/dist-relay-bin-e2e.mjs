/**
 * 빌드 산출물 전용 E2E. **vitest 밖이다** — `pnpm test` 는 빌드를 앞세우지 않으므로
 * 존재 확인을 거기 넣으면 clean checkout 에서 이유 없이 빨개진다. CI 의 `build` 잡이
 * `pnpm build` 뒤에 부른다.
 *
 * 무엇을 고정하나: `relayBinPath()` 가 가리키는 파일이 **빌드 뒤에 실제로 있다**.
 * 매니페스트 합의는 vitest 쪽(`relay-bin-path.test.ts`)이 이미 보므로, 여기서만 할 수
 * 있는 것은 산출물이 정말 나왔는지다. `src/relay.ts` 가 tsdown entry 에서 빠지면
 * 여기서 걸린다.
 *
 * **두 포맷을 다 본다.** 발행본 소비자는 `import` 로도 `require` 로도 들어온다.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const pkgRoot = resolve(here, "..");
const expected = join(pkgRoot, "dist", "relay.mjs");

const esm = await import(join(pkgRoot, "dist", "index.mjs"));
const cjs = createRequire(import.meta.url)(join(pkgRoot, "dist", "index.cjs"));

for (const [label, mod] of [
  ["esm", esm],
  ["cjs", cjs],
]) {
  assert.equal(
    typeof mod.relayBinPath,
    "function",
    `→ ${label} 산출물이 relayBinPath 를 내보내지 않습니다.\n` +
      "→ src/index.ts 에서 export 했는지, tsdown 캐시가 낡지 않았는지 확인하세요.",
  );
  const actual = mod.relayBinPath();
  assert.equal(
    actual,
    expected,
    `→ ${label} 산출물의 relayBinPath() 가 다른 곳을 가리킵니다.\n` +
      `→ 받은 값: ${actual}\n→ 기대한 값: ${expected}`,
  );
  assert.ok(
    existsSync(actual),
    `→ ${label}: relayBinPath() 가 가리키는 파일이 없습니다: ${actual}\n` +
      "→ pnpm build 를 돌렸는지 확인하세요.\n" +
      "→ 빌드가 성공했는데도 없으면 turbo 캐시가 낡은 dist 를 복원한 것입니다 — " +
      "packages/mock 에서 npx tsdown --config-loader native 로 직접 빌드하세요.\n" +
      "→ package.json 의 bin.mcpeak-relay 가 tsdown entry(src/relay.ts)와 맞는지도 보세요.",
  );
}

console.log(`✔ relayBinPath() → ${expected} (esm · cjs 양쪽 확인)`);
