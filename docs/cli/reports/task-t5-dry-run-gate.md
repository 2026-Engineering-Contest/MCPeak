# Task T5 보고서: 카세트 배선 (`cli`)

## 무엇을 했나

시험 실행에 카세트 클라이언트를 붙이는 얇은 층을 만들었다. 계획서 §4 T5 와 설계서 §5 를 따랐다.

- `packages/cli/src/cassette-wiring.ts` 신규. `CassetteWiring`·`WireCassetteOptions`·
  `wireCassette`
- `packages/cli/tests/cassette-wiring.test.ts` 신규. 12개

`record` 패키지는 한 글자도 고치지 않았다. `cassetteClient` 를 감싸기만 한다.

## 핵심: `close()` 를 부르지 않는다

`cassetteClient.close()` 는 `onFlush` 를 부른 뒤 `finally` 에서 `inner.close()` 까지 부른다
(`packages/record/src/index.ts:259`). 검토 도중 그것이 불리면 연결이 죽는다. 그래서 프록시의
`close()` 는 `recorder` 를 거치지 않고 `inner.close()` 만 부르고, 카세트 저장은 `flush()` 가
소유한다. 계획서 §4 T5 의 코드 형태 그대로다.

`flush()` 안에서 `recorder.close()` 를 부르므로 **`flush()` 는 연결을 닫아도 되는 시점에만
불러야 한다.** 이 제약을 파일 상단 주석에 적었다. T6 이 저장 직후에 부른다.

## 모드 결정

| 조건 | 모드 |
|---|---|
| `path` 없음 | 카세트 없음. `inner` 를 그대로 돌려준다 |
| 파일 없음 | `record` |
| 파일 있음 | `auto` |
| `forceRecord` | `record` (파일이 있어도) |

`replay` 는 쓰지 않는다. 새 케이스가 추가되는 것이 이 경로의 정상 흐름인데 `replay` 는 미스에서
실패한다(설계서 §5.2).

경고 문장은 `onWarning` 이 준 것을 그대로 담는다. 테스트는 같은 상황을 `cassetteClient` 로 직접
한 번 더 만들어 두 문장 배열이 같은지 비교한다. 우리가 문장을 다시 만들지 않았다는 증거다.

`load` 가 던지면 그대로 올린다. 삼키고 새로 녹화하면 사용자의 카세트를 말없이 버리는 것이 된다.

## 검증

```
$ pnpm test
 Test Files  53 passed (53)
      Tests  1107 passed | 1 skipped (1108)

$ pnpm typecheck --force
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total

$ pnpm lint
Checked 157 files in 33ms. No fixes applied.
```

결정론성은 `같은 입력으로 2회 돌린 저장 카세트가 바이트 동일하다` 로 고정했다. `stableStringify`
로 두 번의 저장본을 문자열 비교한다. 테스트는 `io` 를 주입해 파일시스템을 쓰지 않는다.

## 임의로 판단한 지점

1. **`warnings` 는 살아 있는 배열을 그대로 돌려준다.** `readonly string[]` 타입이지만 같은
   참조라서 시험 실행 도중 쌓인 경고가 호출 측에 그대로 보인다. 복사본을 돌려주면 호출 측이
   `wireCassette` 시점의 빈 배열만 보게 된다. 계약이 `flush()` 뒤에 읽는 것이라면 복사가
   맞지만, 설계서 §5.3 은 경고를 결과 표시 직후에 찍는다.
2. **`record` 모드에서도 읽은 카세트를 그대로 넘긴다.** `cassetteClient` 가 `record` 모드에서
   그것을 버리고 빈 카세트로 시작하므로 결과는 같다. 호출부에서 분기하지 않는 편이 모드 결정을
   한 곳(`resolveMode`)에만 두게 한다.
3. **`flush()` 는 녹화가 0건이어도 저장한다.** 계획서의 코드 형태가 `snapshot === undefined`
   일 때만 건너뛰는데, `--cassette` 를 준 이상 `recorder.close()` 뒤 `snapshot` 은 항상 있다.
   즉 빈 카세트 파일이 만들어질 수 있다. "경로를 줬다" 는 것 자체가 사용자의 의사 표시이므로
   그대로 뒀다.
4. 테스트의 `auto` 모드 확인에 "카세트에 없는 키는 `inner` 로 간다" 단언을 하나 더 넣었다.
   재생만 확인하면 새 케이스가 막히는 회귀를 못 잡는다.

## 남은 위험

- **`flush()` 가 연결을 닫는다는 것이 타입에 안 보인다.** 이름이 `flush` 라 T6 이 순서를 틀리면
  저장 직전에 연결이 죽는다. 주석과 이 보고서에만 적혀 있다. 계획서 §8 이 이미 알려진 위험으로
  올려 둔 항목이고, T6 의 테스트(`close` 호출 횟수)가 마지막 방어선이다.
- `client.close()` 와 `flush()` 를 둘 다 부르면 `inner.close()` 가 두 번 불린다. `McpClient` 의
  `close()` 가 멱등인지는 구현마다 다르다. T6 은 둘 중 하나만 부르는 경로를 만들어야 한다.
- 저장 실패(디스크 가득참 등)는 `flush()` 가 그대로 던진다. 그 시점은 명세가 이미 저장된
  뒤이므로, T6 이 카세트 저장 실패를 명세 저장 실패로 보이게 하지 않아야 한다.

## 커밋 메시지

```
feat(cli): 시험 실행에 카세트 클라이언트를 배선한다
```
