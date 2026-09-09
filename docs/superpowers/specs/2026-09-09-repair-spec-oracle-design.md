# repair 의 명세 오라클 판정 설계 (이슈 #385)

작성일: 2026-09-09. 담당: cli · generate. 검토 기준 커밋: `602257514eee21c8660c64655a724bb939adf32b`.
이슈: https://github.com/2026-Engineering-Contest/MCPeak/issues/385 (`pkg:cli` · `type:bug`).
참조: `docs/superpowers/specs/2026-08-16-server-repair-design.md` §5.4 · §5.6 · §6.1 · §6.5,
`docs/superpowers/specs/2026-08-14-approval-fingerprint-design.md`,
`docs/superpowers/specs/2026-08-15-dry-run-approval-gate-design.md` §7.1 · §8.5 · §9,
ADR-0089(시험 실행이 꺼지면 사전보완도 건너뛴다), `docs/2026-09-08-실전성-작업-순서.md` A-2.
통합 이슈 없음. 후속 이슈 #393 · #394 는 이 문서의 비범위다.

## 1. 배경

`repair` 는 진단 요청을 조립할 때 명세가 오라클 자격을 가지는지를 한 값으로 넘긴다.

```ts
// packages/cli/src/repair-command.ts:164
specApproved: bundle.spec.approval === "matched",
```

`bundle.spec.approval` 은 `checkSpecApproval`(`packages/cli/src/spec-approval.ts:18`)의 결과다.
저장된 `approval.fingerprint` 와 현재 명세로 계산한 지문을 대조한 값일 뿐이고, **그 명세가 실제
서버에서 실행된 적이 있는지는 보지 않는다.**

실행 이력은 다른 자리에 있다. `generate` 는 시험 실행을 마치고 사람이 분류를 끝냈을 때만
`approval.cases` 를 쓴다(`packages/cli/src/dry-run-review.ts:123-154`). 저장 함수의 주석이 그
구분을 명시한다.

```ts
// packages/cli/src/generate-command.ts:544-546
// 빈 배열이면 키를 넣지 않는다. `[]` 는 "시험 실행을 했는데 케이스가 0개" 와 "시험 실행을
// 하지 않았다" 를 구분하지 못한다. 키가 없는 것이 후자의 표현이다.
approval: cases.length === 0 ? { fingerprint } : { fingerprint, cases },
```

`--baseline-only`(`generate-command.ts:2223-2231`)와 `--no-dry-run`(`generate-command.ts:1395`,
`1399-1406`)은 둘 다 `approvals` 가 빈 채로 저장한다. 그래서 지문은 있고 실행 기록은 없는 파일이
나온다. 저장소에 실제로 그런 파일이 있다. `examples/weather-server/server.suite_show.json` 의
`approval` 은 `fingerprint` 하나뿐이다.

이 파일로 만든 번들은 `approval: "matched"` 이므로 `specApproved: true` 가 되고, 두 곳이 그 값을
전제로 동작한다.

1. 프롬프트가 사실이 아닌 문장을 보낸다(`packages/generate/src/diagnosis-prompt.ts:11-12`).
   "테스트 명세는 승인 절차를 거쳤고 실제 서버에서 한 번 이상 통과가 확인된 것이다. 옳다고
   가정한다." 실행이 없었으므로 통과가 확인된 적이 없다.
2. 검증이 명세 쪽 원인을 버린다(`packages/generate/src/diagnosis-request.ts:280-293`).
   `specApproved && cause.target === "spec"` 이면 후보를 버리고 `discarded.specTarget` 에 센다.

결과가 이슈의 관측이다. 생성 시점 자리값 `city: "example"` 때문에 실패한 케이스에 AI 가
`target: "spec"` 으로 정확한 원인을 냈는데, 화면은 그 한 건을 버리고 이렇게 말한다.

```
AI 가 원인 후보 1건을 냈지만 전부 검증에서 제외했습니다.
제외 사유  승인된 명세를 고치라는 제안 1건
```

같은 자리에 둘째 문제가 있다. `serverDefect` 로 승인된 케이스는 승인 시점에도 **실패한** 케이스다
(`dry-run-review.ts:145-153`, 승인 게이트 설계서 §9). 번들은 그 판정을 `approvedAs` 로 실어
보내지만(`repair-bundle.ts:128-131`), 프롬프트의 역할 문장은 여전히 "한 번 이상 통과가 확인된
것" 이라고 말한다. 요청 안의 두 값이 서로 어긋난다.

세 번째로, 지문 상태가 `matched` 가 아닐 때만 화면에 경고가 붙는다
(`repair-render.ts:66-73`). 지문은 맞고 실행 기록만 없는 경우는 경고가 없어서, 사용자는 명세가
검증된 것이라고 읽는다.

이슈 본문과 현재 코드는 일치한다. 기준 커밋 `c0a1934` 와 현재 HEAD 사이에 위 네 지점의 구조
변경은 없고 줄 번호만 밀렸다.

### 1.1 왜 데모 경로에서 터지는가

`docs/adoption.md` §1.4 의 실측에서 `"example"` 자리값이 정상 케이스를 실패시킨 건이 time 2건,
filesystem 8건이다. 서드파티 서버에는 유효값 선언이 없어서 생성 직후 명세는 대개 통과하지
않는다. 그 상태를 푸는 통로가 AI 사전보완(#397, 완료)과 `repair` 이고, `repair` 는 지금 그
경우에 정확히 필요한 답을 버린다.

## 2. 목표 / 비범위 / 완료 조건

### 목표

1. 지문 대조와 실행 기록을 **별개의 값**으로 다룬다. 오라클 판정은 둘의 합의로만 참이 된다.
2. 실행 기록이 없는 명세에는 서버와 명세 양쪽 원인을 허용한다.
3. 프롬프트가 승인 시점 케이스 판정(`approvedAs`)의 뜻을 정확히 설명한다. `serverDefect` 케이스를
   통과 이력이 있는 것으로 말하지 않는다.
4. 사용자가 화면에서 실행 기록 유무를 본다.

### 비범위

- **`test` 명령의 명세 상태 표시(`renderSpecApproval`) 변경.** 같은 오해가 그 화면에도 있지만
  (`matched` 를 "승인 시점과 동일" 로만 적는다) 이번 이슈의 재현 경로가 아니고, 그 문안을 바꾸면
  `spec-approval.test.ts` 와 보고서 스냅숏의 판정 범위가 함께 움직인다. #393 에서 다룬다.
- **케이스 단위 오라클 판정.** 실행 기록이 있는 명세 안에서 `approvedAs` 가 `passed` 인 케이스와
  `serverDefect` 인 케이스에 서로 다른 폐기 규칙을 적용하는 안. §3.4 에서 기각한다.
- **`generate` 가 실행 기록 없이 저장하는 것을 막는 것.** `--baseline-only` 와 `--no-dry-run` 은
  의도된 경로이고 사용자가 경고를 읽고 고른 것이다(`generate-command.ts:1399-1406`).
- **AI 답변 품질 개선, 재시도, 후속 질문.** #393 · #394.
- **`repair` 가 명세를 고치는 것.** 경계 문장(`REPAIR_BOUNDARY_LINES`)이 지금과 같이 유지된다.

### 완료 조건

구현 PR 의 통과 기준이다. 각 항목은 구현 계획의 태스크 하나 또는 통합 게이트에 대응한다.

1. `DiagnosisRequest` 가 `specApproved: boolean` 대신 `specTrust: { fingerprint: "matched" |
   "mismatched" | "absent"; runHistory: "present" | "absent" }` 를 싣는다. `specApproved` 라는
   이름은 `packages/generate/src` 어디에도 남지 않는다.
2. `specIsOracle(trust)` 가 `fingerprint === "matched" && runHistory === "present"` 일 때만 참이고,
   `generate` 안에서 프롬프트 선택과 `target: "spec"` 폐기 규칙이 **같은 이 함수**를 쓴다.
3. 프롬프트 역할 문장이 네 갈래다. `matched`+`present`, `matched`+`absent`, `mismatched`,
   `absent`. 문안은 §4.1 전량과 한 글자도 다르지 않다.
4. 모든 갈래의 프롬프트에 승인 시점 판정 읽는 법(§4.2)이 들어가고, 그 안에 "`serverDefect` 는
   한 번도 통과한 적이 없다" 가 있다. 어떤 갈래도 "실제 서버에서 한 번 이상 통과가 확인된 것" 을
   포함하지 않는다.
5. `runHistory: "absent"` 이면 `target: "spec"` 후보가 폐기되지 않고 화면에 나온다.
   `discarded.specTarget` 은 0 이다.
6. repair 번들이 `spec.runHistory` 를 싣고 `REPAIR_BUNDLE_VERSION` 이 2 다. `runHistory` 가 없거나
   값이 목록 밖인 번들은 `missingField` 로, `bundleVersion` 이 2 가 아닌 번들은 `versionMismatch`
   로 거절한다.
7. `buildRepairBundle` 이 `suite.approval.cases` 가 비어 있거나 없으면 `"absent"`, 항목이 하나라도
   있으면 `"present"` 를 쓴다.
8. `repair` 전송 확인 화면의 `명세 상태` 줄이 지문 상태와 실행 기록을 함께 적는다
   (예: `승인 지문 일치 · 실행 기록 없음`).
9. 지문이 `matched` 이고 실행 기록이 없으면 결과 위에 §4.4 의 경고 블록이 붙는다. 지문이
   `matched` 이고 실행 기록이 있으면 경고가 없다(현재와 같다).
10. `target: "spec"` 후보에 붙는 `분류       명세 쪽 원인으로 봄` 라벨의 조건이 오라클 판정과
    같다. 지문이 `matched` 이고 실행 기록이 없는 경로에서 그 라벨이 붙는다.
11. 네 경로가 각각 테스트로 판정된다. 미실행 명세 · 실제 통과 · 서버 결함 승인 · 지문 불일치.
12. ADR 초안(§6)이 `docs/adr/` 에 있고 색인에 올라 있다. `.changeset/` 에 `@mcpeak/generate` 와
    `@mcpeak/cli` 가 함께 있다.
13. `pnpm build --force` 뒤 `pnpm typecheck --force` 가 `Cached: 0 cached` 로 통과하고,
    `pnpm test` · `pnpm biome ci .` · `pnpm --filter @mcpeak/cli test:e2e` 가 통과한다.

## 3. 결정

### 3.1 오라클 자격은 두 축의 합의다

요청이 싣는 값을 불리언에서 두 축의 구조체로 바꾼다.

```ts
// packages/generate/src/diagnosis-schema.ts
/**
 * 명세가 오라클 자격을 가지는지 판정하는 두 축. 지문 대조와 실행 기록은 별개다(#385).
 * 지문이 맞아도 `--baseline-only`·`--no-dry-run` 으로 저장한 명세에는 실행 기록이 없다.
 */
export interface DiagnosisSpecTrust {
  /** 저장된 승인 지문과 현재 명세로 계산한 지문의 대조 결과. */
  readonly fingerprint: "matched" | "mismatched" | "absent";
  /** 승인 시점의 실제 서버 실행 기록(`approval.cases`)이 남아 있는가. */
  readonly runHistory: "present" | "absent";
}

/**
 * 명세를 오라클로 놓아도 되는가. 프롬프트 선택과 `target: "spec"` 폐기가 이 하나를 본다.
 * 두 곳이 각자 조건을 쓰면 한쪽만 고쳐졌을 때 화면과 프롬프트가 어긋난다.
 */
export function specIsOracle(trust: DiagnosisSpecTrust): boolean {
  return trust.fingerprint === "matched" && trust.runHistory === "present";
}
```

다르게 갈 수 있었다. `specApproved` 이름을 그대로 두고 `cli` 에서 계산만 고치는 안이다
(`bundle.spec.approval === "matched" && 실행기록있음`). 한 줄이면 끝나고 `generate` 를 안 건드린다.

기각한다. 그러면 요청에 실린 값이 "지문이 맞다" 인지 "오라클이다" 인지 읽는 쪽이 알 수 없고,
프롬프트가 네 갈래를 구분할 근거도 사라진다(완료 조건 3 · 4 를 만족할 수 없다). 이슈가 요구한
것이 정확히 "세 가지를 별도로 취급" 이다. 값의 이름과 모양이 그 구분을 표현해야 다음 사람이
같은 실수를 반복하지 않는다.

세 축 중 "사람의 명세 승인" 을 별도 필드로 두지 않는 이유는 저장 형식이 그것을 따로 적지 않기
때문이다. `approval.fingerprint` 의 존재가 곧 사람이 승인 절차를 거쳤다는 기록이고, 그것은
`fingerprint: "absent"` 와 나머지 둘의 구분으로 이미 표현된다. 없는 데이터를 위해 필드를 만들면
채울 값이 없다.

### 3.2 번들 형식 버전을 2 로 올린다

`repair` 는 명세 파일이 아니라 번들만 읽으므로 실행 기록 유무가 번들에 실려야 한다.

```ts
// packages/cli/src/repair-bundle.ts
readonly spec: {
  readonly suiteId: string;
  readonly suiteName: string;
  readonly approval: SpecApprovalState;
  /** 승인 시점 실행 기록(`approval.cases`)의 유무. 지문 일치와 별개다(#385). */
  readonly runHistory: "present" | "absent";
  readonly fingerprint: string;
  readonly approvedFingerprint?: string;
};
```

`REPAIR_BUNDLE_VERSION` 을 1 에서 2 로 올리고, 읽기 검증(`specShapeValid`)이 `runHistory` 를
필수로 본다.

다르게 갈 수 있었다. 선택 필드로 두고 없으면 `"absent"` 로 보는 안이다. 낡은 번들도 계속 읽히고
안전한 쪽(더 허용적인 프롬프트)으로 떨어진다.

기각한다. 이 파일에는 이미 반대 방향의 결정이 적혀 있다. "모르는 버전은 거절한다. 앞으로 호환을
흉내 내면 낡은 번들에서 키가 빠졌을 때 조용히 반쪽으로 돈다"(`repair-bundle.ts:222-225`). 선택
필드는 정확히 그 "조용히" 다. 사용자는 자기 번들이 낡아서 오라클 판정이 달라졌다는 사실을 볼
길이 없다. 번들은 `test` 가 직전에 만드는 일회성 산출물이라 다시 만드는 비용이 낮고, 거절
문장이 이미 무엇을 하라고 말한다("최신 `mcpeak test --repair-bundle` 로 다시 만드세요").
`packages/dashboard` 는 번들을 `.mcpeak/repair/` 에 모아 두기만 하고 형식을 해석하지 않으므로
(`packages/dashboard/src/server/files.ts:243-256`) 코드 변경이 없다. 낡은 번들을 고른 사용자는
같은 거절 문장을 본다. 이 결정은 ADR 대상이다(§6).

### 3.3 실행 기록의 판정 기준은 `approval.cases` 의 존재다

```ts
// packages/cli/src/spec-approval.ts
/**
 * 승인 시점에 실제 서버 실행 기록이 남았는가. `approval.cases` 의 존재가 기준이다.
 * `generate` 는 시험 실행을 마치고 사람이 분류를 끝냈을 때만 이 키를 쓴다
 * (`generate-command.ts` 의 `renderSuite`, `dry-run-review.ts` 의 `reviewDryRun`).
 * 빈 배열은 저장되지 않지만, 손으로 쓴 파일에는 있을 수 있으므로 길이로 본다.
 */
export function specRunHistory(suite: TestSuiteSpec): "present" | "absent" {
  return (suite.approval?.cases?.length ?? 0) > 0 ? "present" : "absent";
}
```

케이스별로 `approvedAs` 가 있는지를 실패마다 따로 보지 않는다. 번들에는 실패한 케이스만 담기고,
통과한 케이스의 `approvedAs` 는 애초에 실리지 않는다. 실패 목록만으로 "이 명세에 실행 기록이
있는가" 를 판정하려 하면 전부 `serverDefect` 인 번들과 실행 기록이 없는 번들을 구분할 수 없다.
판정은 명세를 손에 쥔 `test` 쪽에서 하고, 번들은 그 결과를 옮기기만 한다.

### 3.4 케이스 단위 폐기 규칙은 만들지 않는다

다르게 갈 수 있었다. 실행 기록이 있는 명세 안에서도 `approvedAs: "serverDefect"` 인 케이스는 그
케이스만 명세 쪽 원인을 허용하는 안이다. 그 케이스는 통과한 적이 없으니 자리값이 남아 있을 수
있다는 논리다.

기각한다. `serverDefect` 는 사람이 시험 실행 결과를 보고 **"명세가 맞고 서버가 틀렸다" 고 명시적으로
판정한** 표시다(승인 게이트 설계서 §9). 그 케이스야말로 사람이 명세 쪽을 검토하고 통과시킨
자리다. 여기서 명세 수정 제안을 다시 열면 사람의 판정을 AI 가 뒤집는 통로가 되고, 그것은 단계 3
게이트의 존재 이유를 무너뜨린다. 사실이 어긋났던 것은 폐기 규칙이 아니라 **프롬프트의 설명**이므로
§4.2 가 그것을 고친다.

### 3.5 프롬프트는 사실만 적고 판단은 남긴다

역할 문장 네 갈래(§4.1)와 승인 시점 판정 읽는 법(§4.2)은 전부 고정 문자열이다. 요청 내용에 따라
문장을 합성하지 않는다. 합성하면 같은 명세로 두 번 돌렸을 때 프롬프트가 달라질 여지가 생기고,
결정론성 계약(요청 지문 `sha256`)이 흔들린다. 갈래는 `specTrust` 두 축의 조합 넷으로만 갈린다.

## 4. 화면과 문안

### 4.1 프롬프트 역할 문장 (전량)

`packages/generate/src/diagnosis-prompt.ts` 의 상수 넷이다. 선택 규칙은
`fingerprint === "matched"` 일 때 `runHistory` 로 다시 갈리고, 아니면 `fingerprint` 로 갈린다.

**`matched` + `present` (오라클)**

```
역할: MCP 서버의 테스트 실패를 보고 서버 코드의 원인 후보를 제시한다.
테스트 명세는 승인 절차를 거쳤고 승인 시점에 실제 서버 실행 기록이 남아 있다. 옳다고 가정한다.
명세를 고치라고 제안하지 않는다. 테스트 케이스를 작성하거나 수정하지 않는다.
코드를 수정하지 않고 파일에 접근하지 않는다. 원인 후보와 확인할 위치만 반환한다.
근거가 부족하면 추측하지 말고 unsure 로 반환하고, 무엇이 더 있으면 판단할 수 있는지 적는다.
반드시 제공된 JSON Schema와 일치하는 결과만 반환한다.
```

기존 문장에서 "실제 서버에서 한 번 이상 통과가 확인된 것이다" 를 "승인 시점에 실제 서버 실행
기록이 남아 있다" 로 바꾼다. 실행 기록이 있어도 그 안에 `serverDefect` 케이스가 섞일 수 있어
"통과" 는 명세 전체에 대해 참이 아니다. 케이스별 사실은 §4.2 가 말한다.

**`matched` + `absent` (승인했으나 미실행)**

```
역할: MCP 서버의 테스트 실패를 보고 원인 후보를 제시한다.
이 테스트 명세는 승인 절차를 거쳤지만 실제 서버에서 한 번도 실행되지 않은 채 저장됐다. 명세가 옳다고 가정하지 않는다.
케이스의 입력값이 생성 시점의 자리값일 수 있다. 서버 코드와 명세 양쪽을 원인 후보로 보고 어느 쪽이 더 유력한지 판단해 함께 적는다.
코드나 명세 파일을 수정하지 않고 파일에 접근하지 않는다. 원인 후보와 확인할 위치만 반환한다.
근거가 부족하면 추측하지 말고 unsure 로 반환하고, 무엇이 더 있으면 판단할 수 있는지 적는다.
반드시 제공된 JSON Schema와 일치하는 결과만 반환한다.
```

"자리값" 을 한 줄 적는 이유는 이 경로의 실제 실패 원인 대부분이 그것이기 때문이다
(`docs/adoption.md` §1.4 의 time 2건 · filesystem 8건).

**`mismatched` (승인 후 수정됨)**

```
역할: MCP 서버의 테스트 실패를 보고 원인 후보를 제시한다.
이 테스트 명세는 승인 후 수정됐다. 저장된 승인 지문과 현재 명세의 지문이 다르다. 명세가 옳다고 가정하지 않는다.
서버 코드와 명세 양쪽을 원인 후보로 보고 어느 쪽이 더 유력한지 판단해 함께 적는다.
코드나 명세 파일을 수정하지 않고 파일에 접근하지 않는다. 원인 후보와 확인할 위치만 반환한다.
근거가 부족하면 추측하지 말고 unsure 로 반환하고, 무엇이 더 있으면 판단할 수 있는지 적는다.
반드시 제공된 JSON Schema와 일치하는 결과만 반환한다.
```

**`absent` (승인 지문 없음)**

```
역할: MCP 서버의 테스트 실패를 보고 원인 후보를 제시한다.
이 테스트 명세에는 승인 지문이 없다. 승인 절차를 거치지 않았다. 명세가 옳다고 가정하지 않는다.
서버 코드와 명세 양쪽을 원인 후보로 보고 어느 쪽이 더 유력한지 판단해 함께 적는다.
코드나 명세 파일을 수정하지 않고 파일에 접근하지 않는다. 원인 후보와 확인할 위치만 반환한다.
근거가 부족하면 추측하지 말고 unsure 로 반환하고, 무엇이 더 있으면 판단할 수 있는지 적는다.
반드시 제공된 JSON Schema와 일치하는 결과만 반환한다.
```

`mismatched` 는 `runHistory` 를 보지 않는다. 지문이 다르면 실행 기록이 어느 명세의 것인지 알 수
없기 때문이다. 같은 이유로 `absent` 도 보지 않는다.

### 4.2 승인 시점 판정 읽는 법 (모든 갈래 공통)

역할 문장 바로 뒤, 허용 caseId 목록 앞에 붙는 고정 블록이다.

```
승인 시점 케이스 판정(approvedAs) 읽는 법:
passed 는 승인 시점에 실제 서버에서 통과한 케이스다.
serverDefect 는 승인 시점에도 실패했고 사람이 "명세가 맞고 서버가 틀렸다" 고 판정한 케이스다. 한 번도 통과한 적이 없다.
표시가 없는 케이스는 승인 시점에 실행되지 않았다.
```

네 갈래 모두에 붙인다. 갈래마다 빼고 넣으면 `approvedAs` 가 실린 요청과 설명이 없는 요청이
생기고, 그 조합을 테스트로 다 덮어야 한다. 실행 기록이 없는 요청에서는 셋째 줄이 그 사실을
그대로 설명하므로 군더더기가 아니다.

### 4.3 전송 확인 화면

`명세 상태` 줄에 실행 기록을 더한다. 나머지 줄은 그대로다.

```
  명세 상태  승인 지문 일치 · 실행 기록 없음
```

라벨은 `실행 기록 있음` · `실행 기록 없음` 둘이다. 지문 라벨 셋(`승인 지문 일치` ·
`승인 지문 불일치` · `승인 지문 없음`)과 가운뎃점으로 잇는다.

### 4.4 결과 위 경고 블록

`renderApprovalNotice` 가 `(approval, runHistory)` 를 받는다. 지문이 `matched` 이고 실행 기록이
없을 때 다음을 낸다. 나머지 경우의 문안은 그대로다.

```
⚠ 이 명세는 승인 지문이 일치하지만 실제 서버 실행 기록이 없습니다.
  --baseline-only 나 --no-dry-run 으로 저장하면 케이스가 한 번도 실행되지 않은 채 승인됩니다.
  입력값이 생성 시점의 자리값일 수 있어, 아래 제안은 명세 쪽 원인도 함께 받았습니다.
```

`matched` + `present` 는 지금과 같이 빈 문자열이다.

### 4.5 원인 항목의 분류 라벨

`renderRepairResult` 는 `target: "spec"` 항목에 `분류       명세 쪽 원인으로 봄` 을 붙이고, 그
조건이 지금은 `options.bundle.spec.approval !== "matched"` 다(`repair-render.ts:266-268`).
이 조건을 오라클 판정으로 바꾼다. 즉 지문이 `matched` 이고 실행 기록이 있을 때만 라벨이 없다.

바꾸지 않으면 이번 수정의 핵심 경로에서 라벨이 사라진다. 지문 일치 + 실행 기록 없음은 명세 쪽
후보가 새로 통과하는 유일한 경로인데, 그 경로에서만 라벨이 안 붙어 사용자가 그 항목을 서버 쪽
원인과 구분하지 못한다. 판정 조건은 `generate` 의 `specIsOracle` 과 같은 뜻이지만 `cli` 는 그
함수를 부르지 않고 번들의 두 값으로 직접 판정한다. 화면 렌더러가 진단 통로를 로드하지 않는
현재 구조(`repair-render.ts` 는 `@mcpeak/generate` 를 import 하지 않는다)를 그대로 둔다.

## 5. 결정론성

새 값은 파일에서 읽은 열거형 둘이고, 프롬프트 갈래는 그 조합으로만 갈린다. 시각·랜덤값·실행
순서에 의존하는 것이 없다. 같은 번들이면 요청 바이트와 `sha256` 지문이 항상 같다. 번들 자체도
같은 명세와 같은 보고서에서 항상 같은 `runHistory` 를 얻는다.

## 6. ADR 초안

`docs/adr/0090-오라클-자격은-지문과-실행-기록의-합의다.md`. 배경은 §1, 선택지는
(a) 두 축 구조체 + 번들 버전 2 · (b) `cli` 에서 계산만 고치기 · (c) 번들에 선택 필드 추가,
결정은 (a), 이유는 §3.1 과 §3.2, 결과는 "낡은 번들은 `versionMismatch` 로 거절되고 `test` 를 다시
돌려야 한다" 와 "케이스 단위 폐기 규칙은 열지 않는다(§3.4)" 두 줄이다. 번호는 작성 시점에 색인의
최대값 + 1 로 다시 확인한다(ADR README 가 번호 충돌 위험을 적어 두었다).

## 7. 테스트

전부 인메모리다. `packages/generate/tests/diagnosis-*.test.ts` 는 주입 provider 를 쓰고,
`packages/cli/tests/repair-*.test.ts` 는 주입 `diagnosis` 를 쓴다. 실제 provider 프로세스를 띄우지
않는다. `repair-e2e.test.ts` 만 fixture 서버 프로세스를 띄우고, 그것은 직렬 웨이브에서 돌린다.
케이스 이름과 단언은 구현 계획 T1 · T2 에 전량 있다.

| 완료 조건 | 테스트 |
|---|---|
| 1 · 2 | `specIsOracle 은 지문 일치와 실행 기록이 모두 있어야 참이다` |
| 3 | `역할 문장이 네 갈래다` |
| 4 | `모든 갈래가 approvedAs 읽는 법을 담고 통과 이력을 주장하지 않는다` |
| 5 | `실행 기록이 없으면 target: "spec" 후보가 살아남는다` · `실행 기록이 있으면 버려진다` |
| 6 | `bundleVersion 이 1 이면 versionMismatch 다` · `runHistory 가 없으면 missingField 다` |
| 7 | `approval.cases 가 없으면 runHistory 가 absent 다` · `있으면 present 다` |
| 8 | `전송 확인 화면이 지문 상태와 실행 기록을 함께 적는다` |
| 9 | `지문이 맞고 실행 기록이 없으면 경고 블록이 붙는다` · `실행 기록이 있으면 경고가 없다` |
| 10 | `실행 기록이 없으면 spec 항목에 분류 라벨이 붙는다` |
| 11 | `네 경로가 각각 다른 화면과 다른 폐기 수를 낸다` (`repair-render.test.ts`) |
