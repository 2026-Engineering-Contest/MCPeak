# External Sessions

After this page you can record a server's outbound HTTP calls once and replay them on later runs,
and you know what that recording catches and doesn't catch, and what ends up in the session file.

## What a mock can't replace

An HTTP call the server under test makes outward stays in place even if you swap the server for a
mock, and if you leave it, it goes out for real every time you run the test. A weather API, a
payment call, and a webhook are examples.

An external session records that call once and replays it on later runs. The server still runs
for real during replay. What stops isn't the server, it's what the server calls outward.

## Recording and replaying

```bash
# 1) 한 번은 진짜로 나간다. 그 응답이 세션 파일에 남는다.
mcpeak test weather.suite.json --record-session weather.session.db -- node ./server.mjs

# 2) 이후로는 세션 파일에서 재생한다. 외부 API 는 부르지 않는다.
mcpeak test weather.suite.json --session weather.session.db -- node ./server.mjs
```

The session file is a standard SQLite file. The two options can't be used together, or with
`--determinism`, because `--determinism` connects to the server twice while a session is tied to
a single connection.

`examples/live-weather-server` in the repository demonstrates this feature. It calls Open-Meteo
and Frankfurter through `fetch`, so the temperature and exchange rate change on every call, and
replay pins them down.

## The only thing it captures is `globalThis.fetch`

The following are out of scope and are neither recorded nor replayed.

- Direct calls to `node:http` or `node:https`
- axios, got, or node-fetch, which sit on top of those
- A server that isn't Node (Python, Go, etc.). The injection is Node's `--import` hook, so it
  never reaches these servers at all

An out-of-scope call still goes out over the real network even during replay, and the tool can't
stop it. Instead, when the tool sees signs of that, it warns at the end of the run: when zero
calls were recorded, or zero were replayed.

```
알림: 이 실행에서 외부 호출이 하나도 녹화되지 않았습니다.
→ 서버가 외부 API를 호출했다면 지원 범위를 벗어났는지 확인하세요.
→ MCPeak은 서버가 `globalThis.fetch`로 부른 것만 잡습니다.
```

Recording a mock server as a session yields zero recorded calls. A mock only returns the
responses in its definition file and has no code that reaches out.

## What ends up in the session file

The session file holds the external API's requests and responses as is. A secret value that can
be recognized by name is redacted before it's saved.

| Location | Applied |
|---|---|
| Request/response JSON body | If a key name is `token`, `apiKey`, `secret`, `password`, etc., its value becomes `[redacted]` |
| Headers | Same name matching. `authorization`, `cookie`, `set-cookie`, `proxy-authorization` always |
| URL query | If a key name matches, its value becomes `[redacted]` |
| URL path | There's no name to match against, so the whole path becomes `<redacted>` |

```
https://hooks.example.com/services/T000/B111/XXXXsecret?token=abc
        ↓ 저장되는 값
https://hooks.example.com/<redacted>?token=[redacted]
```

Name matching splits a key on `-`, `_`, and camelCase boundaries, then only catches a spot where
a suffix combination built up from the end matches an entry in the list exactly. `X-Api-Key` is
caught, but `tokenCount` is not.

A spot that can't be matched by name isn't redacted, such as a value carried as a URL string
inside a JSON body. Since the saved recording is also the replay input, erasing a URL in the body
would break a server that follows a `next` link during replay, so it's left alone; instead, the
tool counts how many such URLs remain once recording finishes. If you recorded an endpoint whose
path itself is a credential, such as a Slack or Discord webhook, check the file before
committing.

If you already committed a session file with a credential in it, deleting the file doesn't end it
there. It remains in git history, so treat the value as exposed: revoke it, reissue it, and
record again.

## The `node:sqlite` experimental warning

Depending on the runtime, a run that uses a session option prints one line to stderr.

```
(node:2845) ExperimentalWarning: SQLite is an experimental feature and might change at any time
```

It appears once, the first time `node:sqlite` loads, so it's one line per run. It appears on Node
22.18.0 and not on 24.16.0; versions in between weren't measured. It's a warning about Node's API
surface, not about the saved recording. The file is standard SQLite, so other tools can open it
too.

## Using it as a library

`@mcpeak/record` exposes two things: a Store and a Coordinator. The Coordinator builds the
environment variables to hand to the child process, and the `fetch` of a child started with those
variables is what gets recorded and replayed.

```ts
import { createSqliteSessionStore, startExternalCoordinator } from "@mcpeak/record";

const store = createSqliteSessionStore({ path: "weather.session.db" });
const handle = await startExternalCoordinator({ mode: "record", sessionId: "default", store });

let status: "completed" | "failed" = "completed";
try {
  await runServerWith(handle.childEnvironment);
} catch (error) {
  status = "failed";
  throw error;
} finally {
  try {
    await handle.finish(status);
  } finally {
    store.close();
  }
}
```

Open replay with `{ mode: "replay", sourceSessionId, store }`, and open the store with
`createSqliteSessionStore({ path, readOnly: true })`. Call `finish()` on both the success and the
failure path. If you don't, the recording session stays `running` and the next run can't continue
writing to it.
