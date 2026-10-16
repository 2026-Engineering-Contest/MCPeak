**English** · [한국어](./README.ko.md)

# @mcpeak/record

Records and replays **the HTTP calls an MCP server makes outward** (External session), and removes **secrets that can be identified
by name** at the boundary where they leave the process. URL paths have no name to judge by, so those are
erased entirely just before saving ([details](#external-sessions-dont-store-the-url-path)).

- **Owner:** `@ddxng5` (② replay/record part)
- **Depends on:** nothing. Only Node built-ins (`node:sqlite`·`node:http`).
- **Decisions:** [ADR-0051](../../docs/adr/0051-external-record-replay와-tool-카세트-경계-분리.md),
  [ADR-0052](../../docs/adr/0052-coordinator가-engine과-session-store를-소유한다.md),
  [ADR-0053](../../docs/adr/0053-http-외부-요청-매칭과-반복-호출-정책.md),
  [ADR-0057](../../docs/adr/0057-external-어댑터는-global-fetch-까지만-가로챈다.md),
  [ADR-0059](../../docs/adr/0059-tool-카세트를-제거한다.md)
- **Masking decisions:** [ADR-0039](../../docs/adr/0039-민감-키-목록과-매칭-경계.md),
  [ADR-0041](../../docs/adr/0041-마스킹의-적용-경계.md),
  [ADR-0045](../../docs/adr/0045-민감-키-목록의-복수형과-key-합성어.md)

## The Tool cassette has been removed

This package once had a **Tool cassette.** It wrapped the MCP client and recorded *what we asked the
server* (`listTools`·`callTool`), so that replay **didn't start the server at all.**
[ADR-0059](../../docs/adr/0059-tool-카세트를-제거한다.md) removed it, and this package is now
External sessions only.

| What's gone | Instead |
|---|---|
| `cassetteClient` · `loadCassette` · `saveCassette` · `matchKey` · `redact` | `@mcpeak/record` now exports only the External API |
| `verifyCassette` · `mcpeak verify` | Nothing. It addressed drift that the cassette created, so it went away with the cassette |
| `mcpeak replay` | `mcpeak test <suite> --session <path>` |
| `generate --cassette` · `--record` | `generate` always calls the real server |

Where to move depends on what you wanted.

- **You want to stop the server's external API calls** → External sessions below. The server really starts, and only the calls
  it makes outward are stopped.
- **You want to test with deterministic responses without running the server at all** → `@mcpeak/mock`.
  The responses are specified by a person, so they don't go stale the way a recording does.

**External sessions don't replace the cassette one-for-one.** They capture only `globalThis.fetch`
(see the section below), so they don't cover a server that is itself nondeterministic or a server that isn't Node. This is listed as follow-up work
under "Consequences" in ADR-0059.

## Public API

```ts
import {
  createSqliteSessionStore,
  startExternalCoordinator,
  loadSession,
  ExternalRecordReplayError,
} from "@mcpeak/record";
```

The root (`@mcpeak/record`) and `@mcpeak/record/external` point to **the same thing.** With the cassette gone,
this package has only one API; the subpath is kept for consumers who
already import it. For usage, see [Using it as a library](#using-it-as-a-library).

## Masking

It judges by name. A key is split into words on `-`·`_` separators and camelCase boundaries, and only spots where
**a suffix combination joined from the end** exactly matches one of `authorization`, `apikey`, `accesstoken`, `refreshtoken`, `token`,
`secret`, `password`, `cookie`, `secretkey` are replaced with `"[redacted]"`.
Case is ignored. It's a suffix match, not a substring match, so
compounds with a different head noun such as `tokenCount`·`passwordPolicy` are not masked, while names that hit the list when
joined with a preceding word, such as `X-Api-Key`, are masked. For the rules and their limits, see
[ADR-0039](../../docs/adr/0039-민감-키-목록과-매칭-경계.md) ·
[ADR-0045](../../docs/adr/0045-민감-키-목록의-복수형과-key-합성어.md).

In an External session this judgment applies in four places.

| Place | Applied |
|---|---|
| Request/response JSON body | If a key name matches, its value becomes `[redacted]` |
| Header names | The same word matching. In addition, `authorization`·`cookie`·`set-cookie`·`proxy-authorization` are always masked regardless of name matching |
| URL query parameters | If a key name matches, its value becomes `[redacted]` |
| URL path | There's no name, so it can't be judged. It is erased entirely instead — [section below](#external-sessions-dont-store-the-url-path) |

**Places that can't be judged by name are not masked.** Values carried as URL strings inside a JSON body, and tokens
mixed into free text, are examples. The same reason is why the `message`·`stack`·`cause` of an error thrown by `fetch` are
not stored at all (ADR-0053) — free text has no keys, so masking can't work, and
network error messages often contain the failed URL in full. Only closed
enumerations (`failureKind`·`name`·`code`) are stored.

## External sessions

Records and replays **the HTTP calls a server makes outward.** It targets servers that call paid APIs or endpoints with side effects,
and even during replay **the server itself really starts** — what stops is not the server but
the calls it makes outward.

### The only thing it captures is `globalThis.fetch`

The first adapter is named `node.fetch.v1`, and the `fetch` in that name is its scope. The following are **out of scope**
and are neither recorded nor replayed.

- Direct calls to `node:http` · `node:https`
- axios · got · node-fetch, which sit on top of those
- Servers that aren't Node (Python · Go, etc.) — the injection is Node's `--import` hook, so it never reaches them in the first place

**Out-of-scope calls never reach the Coordinator.** So even during replay they go out to the real network, and
can't be stopped. Instead, the CLI flags that possibility with an end-of-run summary such as zero recorded · zero replayed · partial replay.
For why the scope was set this way and a comparison of alternatives, see
[ADR-0057](../../docs/adr/0057-external-어댑터는-global-fetch-까지만-가로챈다.md).

### Using it from the CLI

**In the CLI,** one session file is one session — `sessionId` is the fixed value `"default"`. The Store
itself distinguishes sessions by `sessionId`, so one SQLite file can hold several sessions (see the library
example below). For a round-trip example, see the [root README](../../README.md#외부-api-를-부르는-서버).

```bash
mcpeak test suite.json --command node --arg ./server.js --record-session weather.session.db
mcpeak test suite.json --command node --arg ./server.js --session weather.session.db
```

### Using it as a library

`@mcpeak/record/external` exposes two things: the Store and the Coordinator. The Coordinator builds the environment variables
to hand to the child, and the `fetch` of a child started with those environment variables is recorded and replayed.

```ts
import { createSqliteSessionStore, startExternalCoordinator } from "@mcpeak/record/external";

const store = createSqliteSessionStore({ path: "weather.session.db" });
const handle = await startExternalCoordinator({
  mode: "record",
  sessionId: "default",
  store,
});

let status: "completed" | "failed" = "completed";
try {
  // handle.childEnvironment 를 그대로 자식 프로세스의 env 에 실어 띄운다.
  await runServerWith(handle.childEnvironment);
} catch (error) {
  status = "failed";
  throw error;
} finally {
  try {
    const summary = await handle.finish(status);
    console.log(summary.interactionCount);
  } finally {
    store.close();
  }
}
```

> Comment: start the child process with `handle.childEnvironment` passed through as its env.

Replay is opened with `{ mode: "replay", sourceSessionId, store }`, and **that store is opened with
`createSqliteSessionStore({ path, readOnly: true })`.** Replay is a read, so there's no reason to create the file or
modify it — if it isn't opened read-only, the schema DDL always runs, so a read-only
(chmod 444) session won't replay, and passing a 0-byte file lets a failed run overwrite that file with an empty session
DB.

Replay is opened with `{ mode: "replay", sourceSessionId, store }`. Call `finish()` **on both the success and the failure
path,** and call `store.close()` after it — if you don't, the SQLite file handle stays open and the recording session
stays `running`, so the next run can't continue writing to it. The returned summary's `interactionCount` ·
`consumedCount` · `unusedCount` are what the CLI's end-of-run notice is based on.

### The `node:sqlite` experimental warning

External sessions are stored with `node:sqlite`. Node still marks this module as experimental, so
depending on the runtime, one line of warning is printed to stderr.

```
(node:2845) ExperimentalWarning: SQLite is an experimental feature and might change at any time
```

It appears **once, the moment the process first loads `node:sqlite`.** Not once per session, nor once per
call — a module loads only once per process, so even if one process opens several sessions,
there's one line. One `mcpeak test` run is one process, so it's at most one line per run.

Two versions were measured.

| Runtime | |
|---|---|
| Node 22.18.0 | The warning appears |
| Node 24.16.0 | It doesn't appear |

Versions in between weren't measured. We don't know which patch dropped the warning, so we don't generalize it as "22.x shows it and 24.x
doesn't."

This warning is about **Node's API surface,** not about the saved recording. The file is standard SQLite with the header
`SQLite format 3`, so other tools can open it, and it stays readable even if Node changes the binding.
For why the warning isn't suppressed and how its scope was narrowed, see
[ADR-0056](../../docs/adr/0056-node-sqlite-실험-경고를-external-사용자에게만-보인다.md).

### External sessions don't store the URL path

Masking judges by **name.** URL path segments have no name to judge by, so name-based
masking can't tell what is secret. So **after** computing the matchKey, the pathname is erased entirely just before
saving.

```
https://hooks.example.com/services/T000/B111/XXXXsecret?token=abc
        ↓ 저장되는 값
https://hooks.example.com/<redacted>?token=[redacted]
```

> `↓ 저장되는 값` = ↓ the value that is stored

The same rule applies to **four standard URL fields.** `location`·`content-location` are not rejected even when they're relative references (RFC
9110, `Location: /hooks/SECRET`); they are resolved to an absolute URL against the response URL and then erased by
the same rule. `link` (RFC 8288)·`refresh`, which carry a URL **inside** their value, are parsed, and only the URL
part is erased by the same rule while the rest of the structure is kept — pagination diagnostics (`rel="next"`) need to
survive.

| Place | Applied |
|---|---|
| Request `display.url` | pathname → `<redacted>` |
| Stored outcome `url` | Same as above |
| `location` header | Resolved to an absolute URL, then pathname → `<redacted>` |
| `content-location` header | Same as above |
| `link` header | Each `<URI>` is erased as above. Parameters are kept only when `rel` is a registered value (`next`·`prev`·`first`·`last`·`self`, etc.); other `rel` values and other parameters (`title`·`type`·`anchor`·extension parameters) become `param=[redacted]`, name included |
| `refresh` header | The delay seconds are kept, and the URL in `url=` is erased as above. If there's no `url=` after the separator, it's treated as a parse failure |

If a `link`·`refresh` value doesn't parse according to its grammar, the whole value becomes `[redacted]` — a value where we don't know what to erase
isn't left as the original. `link` parameter values are arbitrary strings by grammar (`title="sk_…"`
is grammatically valid), so tokens can't be picked out by name, and no value other than a registered `rel` value is left
as the original. Parameter **names** are also arbitrary tokens set by the outside (`sk_live_…=1`), so they're erased as well.

```
Link: </services/T00/B00/XXXXSECRET?cursor=2>; rel="next"
        ↓ 저장되는 값
Link: <https://hooks.example.com/<redacted>?cursor=2>; rel="next"
```

> `↓ 저장되는 값` = ↓ the value that is stored

The exact pathname used to compute the matchKey (the matching material) **never leaves the child process** —
it isn't sent to the Coordinator or put in the Store. `/hooks/AAA` and `/hooks/BBB` still
produce different matchKeys. That's why matching accuracy doesn't change even without the pathname.

**This isn't everything.** URL strings inside a JSON body (pagination `next`, HATEOAS links) keep
their path as is. These are places that can't be judged by the value's name, so ADR-0053 also leaves them outside its
guarantees. **Wherever a credential leaks out, the cleanup procedure below applies the same way.**

Even if you record an endpoint whose **path itself is a credential,** like a Slack·Discord webhook, that value doesn't remain in the URL
fields·headers above. But if that endpoint returns its own URL in a JSON body, it still leaks
through that spot.

### URLs in the body are counted, not erased

**They aren't erased because the stored copy is the replay input.** `restoreHttpOutcome` returns the stored
body to the server as is, so erasing the path here would make a server that follows `next` request a
nonexistent path and break replay — the very server that needs protecting, one with URLs in its body, would break.
For the rationale and the alternatives that were dropped, see [ADR-0062](../../docs/adr/0062-세션-본문의-url-은-지우지-않고-알린다.md).

Instead, **once recording ends, it counts what remains.** There are two kinds.

| Kind | Meaning |
|---|---|
| Echoed path | A URL in the body **contains that request's path as is.** The child judges with the exact path in hand, so there's no guessing — it means a value ADR-0053 erased from the standard places came back through the body |
| Other URLs | Strings that parse as URLs but aren't an echoed path. A weak signal |

What's counted is **the number of distinct URLs within the session.** **The original URLs remain as is in the session file's
body** — not erasing them is the decision. The places the values don't go are **the Coordinator wire and the end-of-run
summary.** The child sends the parent only SHA-256 fingerprints and only counts go to the screen, so
the counting itself doesn't create a new leak path.

If there are more than 512 URLs, some fingerprints are dropped and it reports "at least N." Sending them all would exceed the Coordinator
payload limit and fail the whole recording.

**If either kind is caught in a session, check its contents before committing.**

- **Echoed path** — the path ADR-0053 meant to erase came back through the body and is stored as the original.
  If the endpoint's path was a credential, that value is in the file.
- **Other URLs** — this doesn't mean they're safe either. A URL whose path is a credential, like a **different** webhook URL
  carried in the response, can land here. It just differs from the request path.

If a credential is in it, don't commit; follow the cleanup procedure below.

**The description that used to be above this section ("URL paths are stored as the original") applies to the version before ADR-0053's
implementation PR.** Session files made at that time still have the path as the original, so the cleanup procedure below is
still needed.

### When a credential got into a session file

Sessions recorded with an earlier version of this document (before path removal was implemented) contain the path as the original.
**Deleting the file doesn't end it.**

1. Delete the session file.
2. **Revoke and reissue** the exposed credential. If you committed it, it remains in git history even after
   the file is deleted, so treat the value as already exposed.
3. Record again with the new credential.

## Out of scope

The first version doesn't provide custom matching functions, custom masking rules, TTL, or partial matching.
If the need is confirmed, it will be extended through a separate ADR.

**Contract snapshots (`snapshotContract`) and removal of nondeterministic fields aren't provided either.** This package
doesn't hide nondeterminism by erasing it; it surfaces it by warning when a different response comes for the same key. Judging
differences between runs is the job of `runner`'s determinism check
([ADR-0038](../../docs/adr/0038-결정론성-확인의-비교-대상과-캡처-위치.md)). For the rationale, see
[ADR-0047](../../docs/adr/0047-계약-스냅샷-api-철회.md).
