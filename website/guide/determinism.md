# Determinism Check

After this page you can run the same suite twice to check whether the results match, and you know what each of the three possible conclusions in the output means.

## Running it

```bash
mcpeak test weather.suite.json --determinism -- node ./server.mjs
```

This runs the suite twice and compares the per case results. It calls each tool twice, so use it in a sandbox for servers with side effects.

```
결정론성 확인
→ 2회 실행 결과가 같았습니다. (8/8)
→ 단, 실행 사이에 상태를 복원하지 않았으므로 결정론성 확인은 아닙니다.
  --reset-cmd 로 초기 상태 복원 명령을 지정하면 확인이 됩니다.
```

## Three conclusions

| `determinism.conclusion` in `--json` | Meaning |
|---|---|
| `consistentWithoutReset` | The two runs produced the same result. It is not called a check, though, because state was not reset between the runs |
| `deterministic` | The two runs started from the same initial state via `--reset-cmd` and produced the same result |
| `nondeterministic` | The runs differed. The output lists where they differed and the value from each run |

The distinction between "matched twice" and "is deterministic" exists because the second run sometimes runs on top of the state the first run left behind. For a server that stores notes, the first run might create `id: 1` and the second `id: 2`. That difference is not nondeterminism in the server, it comes from carried over state. Conversely, carried over state can also make two runs look the same by coincidence.

## Resetting initial state

```bash
mcpeak test notes.suite.json --determinism --reset-cmd "rm -f $HOME/.notes.json" -- node ./server.mjs
```

`--reset-cmd` runs once before each run. It does not go through a shell, so pipes and `&&` do not work. If the server keeps its state in a file under `HOME`, deleting it this way works, and for a database, point it at an initialization script.

## It does not block the verdict

This check is a non-blocking diagnostic. Even when it finds a difference, the exit code still reflects the per case verdict, and this alone does not turn it into 1. To block on it in CI, read the `determinism` key in `--json`.

```json
{
  "compared": 8,
  "skipped": 0,
  "differences": [],
  "conclusion": "consistentWithoutReset"
}
```

## Secret values at the point of difference

When a difference is found, the output shows the value from both runs. Fields named things like `token` or `apiKey` are masked, but if the server packs its result as a JSON string inside a single text block, the values inside it have no field name and are not masked. If a server issues a fresh secret on every run, check the output before letting it into CI logs.

## Cannot be combined with sessions

`--determinism` connects to the server twice, but an [External session](/guide/external-sessions) is bound to a single connection. If the second run reuses the same session, the sequence numbers of repeated calls get out of order, and if it uses a new session, the two runs no longer share a comparison baseline. For that reason the two options cannot be used together.
