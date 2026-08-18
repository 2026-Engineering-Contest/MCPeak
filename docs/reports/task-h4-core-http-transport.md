# Task H4 보고서 — 문서와 changeset

브랜치: `docs/core-http-transport` (base `11f7e9b`)
worktree: `.claude/worktrees/ohmymcp-h4-core-http`

## 변경 파일

| 파일 | 변경 |
|---|---|
| `docs/adr/0020-streamable-http-transport.md` | 머리 상태를 `초안` 에서 `제안` 으로 |
| `docs/adr/README.md` | 0020 행 상태 칸을 `초안` 에서 `제안` 으로 |
| `docs/architecture.md` | 2절 표의 `core` 입력 칸을 `ConnectOptions (command·args·env·cwd 또는 url·headers)` 로 |
| `packages/core/README.md` | 머리 문단 갱신, "Streamable HTTP로 연결하기" 절 신규, stdio 전용 서술 문장 정정 |
| `.changeset/core-streamable-http.md` | 신규. `@ohmymcp-hsu/core` minor, 한국어 한 문단 |

`git status --short`:

```
 M docs/adr/0020-streamable-http-transport.md
 M docs/adr/README.md
 M docs/architecture.md
 M packages/core/README.md
?? .changeset/core-streamable-http.md
```

## 검증

```
pnpm lint
> biome check .
Checked 134 files in 28ms. No fixes applied.
```

검사한 파일 수 134 로 0 이 아니다. 다만 biome 은 `.md` 를 검사 대상으로 잡지 않으므로 이번
변경분(전부 마크다운)은 이 명령으로 직접 검증되지 않는다. 회귀가 없다는 것만 확인한 셈이다.
아래 "남은 위험" 참조.

## 임의로 판단한 지점

1. **`packages/core/README.md` 의 stdio 전용 문장 두 곳을 함께 고쳤다.** 지시는 "`connect({ url })`
   사용 예제 절 추가" 였지만, 기존 본문에 새 절과 정면으로 모순되는 서술이 두 군데 있었다.
   - 머리 문단 "로컬 MCP 서버 프로세스를 stdio로 시작하고" → transport 두 가지를 소개하도록 고쳤다.
     stdio 경로가 프로세스·stderr·종료 수명주기를 소유한다는 서술은 그대로 남겼다.
   - "첫 공개 transport는 로컬 stdio뿐이다. Streamable HTTP, SSE, WebSocket, OAuth와 원격 MCP
     인증은 후속 설계와 ADR에서 별도로 결정한다." → 앞 문장을 지우고 "SSE, WebSocket, 원격 MCP
     인증은 후속 설계와 ADR에서 별도로 결정한다." 로 줄였다. OAuth 는 새 절에서 미지원을 명시하므로
     이 문장에서 뺐다.

   고치지 않으면 같은 파일이 HTTP 를 지원한다고도 하고 안 한다고도 말한다. 절 추가만으로는
   태스크의 목적이 달성되지 않는다고 판단했다.

2. **OAuth·재연결 미지원을 "한 줄" 대신 굵은 문장 + 근거 한 문장으로 적었다.** 지시는 한 줄
   명시였다. 두 항목을 한 문장에 묶되, 사용자가 대신 무엇을 해야 하는지(헤더 직접 지정)와
   실패가 어떻게 관측되는지(`HTTP_UNAUTHORIZED`, 즉시 실패)를 붙였다. 실패 메시지를 제품으로 보는
   프로젝트에서 "미지원" 만 적으면 독자가 다음 행동을 모른다.

3. **새 절에 설계서의 사실 몇 개를 더 실었다.** `HttpConnectOptions` 의 필드 세 개, `forceClose`
   부재, 진단 태그와 실리는 필드, 헤더 값 비노출이다. 전부 설계 §14 와 ADR-0020 결정 절에 있는
   내용이며 새로 만든 사실은 없다.

4. **changeset 본문을 한 문단으로 길게 썼다.** `.changeset/README.md` 가 "이 설명이 곧 릴리스
   노트이자 개인 기여 기록" 이라고 요구한다. 한 문단 제약은 지켰다.

5. **README 에서 ADR 로 거는 링크는 상대경로 `../../docs/adr/0020-streamable-http-transport.md`
   로 적었다.** 저장소 안에서 파일을 따라가면 맞는 경로다. npm 에 발행된 README 에서는 깨진다.
   패키지 README 에 저장소 문서를 거는 기존 관행이 이 파일에 없어서 임의로 정했다.

## 남은 위험

- **마크다운은 lint 로 검증되지 않는다.** biome 이 `.md` 를 안 본다. 표 정렬, 링크 유효성, 코드
  블록 언어 태그는 사람 눈으로만 확인했다.
- **README 의 코드 예제는 실행 검증되지 않았다.** 태스크가 문서 전용이라 `.ts` 파일을 열지
  않았고, `connectHttp` 구현 태스크가 아직 병합되지 않았다면 예제의 `connect({ url })` 은 현재
  코드에서 동작하지 않는다. 구현 태스크 병합 뒤 이 예제를 한 번 대조하는 것이 좋다.
- **`docs/architecture.md` 표 칸에 가운뎃점(·)을 쓴 표기는 설계 §14 의 지시 문자열 그대로다.**
  같은 문서 다른 행은 쉼표를 쓴다. 표기 일관성이 어긋나지만 지시된 문자열을 우선했다.
- ADR-0020 본문의 결정 내용은 손대지 않았다. 상태 한 칸만 바뀌었으므로 `제안` 승격에 필요한
  리뷰는 여전히 남아 있다.
