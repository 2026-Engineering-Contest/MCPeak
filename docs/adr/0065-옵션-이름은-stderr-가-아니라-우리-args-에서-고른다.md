# ADR-0065: 옵션 이름은 stderr 가 아니라 우리 args 에서 고른다

- 상태: 제안
- 날짜: 2026-08-23
- 담당: generate (화면 문장은 cli)
- 작성자: @endl24 (① MCP 서버 테스트 파트)
- 승인: 미승인. 아래 '승인' 절 참조
- 선행 결정: [ADR-0033](./0033-stderr-외부-전송-경계.md), [ADR-0034](./0034-provider-진단-통로-분리.md)
- 참조: [#285](https://github.com/2026-Engineering-Contest/MCPeak/issues/285)

## 배경

설치된 provider CLI 가 우리가 넘긴 옵션을 모르면 요청이 API 에 닿기도 전에 죽는다. #285 가 잡은
것은 Claude Code 2.1.148 에서 `--safe-mode` 가 그렇게 됐고, `generate` 도 `repair` 도 통째로 안
돌았다는 것이다.

```
stderr: error: unknown option '--safe-mode'
```

문제는 **화면이 다른 원인을 가리켰다는 것**이다. 이 실패는 HTTP 상태 코드를 남기지 않으므로
`AuthoringProviderFailureReason` 분류가 `undefined` 로 떨어지고, `exitMessage` 의 `default` 갈래가
`claude /status` 로 로그인을 확인하라고 안내했다. 로그인도 모델도 원인이 아니므로 사용자는 안내를
그대로 따라도 절대 풀지 못한다.

원인 문장이 사용자에게 닿을 길 자체가 없다. `AuthoringProviderError` 는 stderr 를
`{ captured, truncated }` boolean 두 개로만 들고 있고, 그것은 의도된 설계다 — stderr 에는 우리가 보낸
프롬프트가 그대로 echo 되고 그 안에는 사용자 서버가 준 untrusted 한 툴 설명이 들어 있다
(`provider-process.ts` 의 `stderrClassifyLimit` 주석).

> 참고로 이 저장소의 개발 머신에 설치된 claude 는 2.1.235 이고 `--safe-mode` 를 지원한다.
> 그 사이 추가된 플래그이며, 도입 버전은 확인하지 못했다.

## 선택지

- **A안**: 실패하면 stderr 를 그대로 화면에 찍는다.
- **B안**: 사유 enum 에 `unknownOption` 만 더하고 옵션 이름은 말하지 않는다.
- **C안**: `unknown option '<x>'` 를 읽되, `<x>` 가 **우리가 넘긴 args 에 있을 때만** 그 이름을 쓴다.
- **D안**: 호출 전에 `--help` 를 돌려 지원하는 옵션만 넘긴다.

## 결정

**C안을 채택한다.**

`AuthoringProviderFailureReason` 에 `unknownOption` 을 더한다. 분류 함수는 stderr 에서
`unknown option '<x>'` 를 찾은 뒤, `<x>` 를 **우리 args 배열에서 `find` 로 고른다.** 고르지 못하면
분류하지 않는다. 화면에 나가는 문자열은 provider 텍스트가 아니라 우리가 만든 배열의 원소다.

값이 아니라 **옵션 이름만** 대조한다. 그러려면 둘을 가를 수 있어야 하는데, **모양으로 가르지
않는다.** `--` 로 시작하면 옵션으로 세는 방법은 틀린다 — 사용자가 `--model --unsupported-model`
을 주면 그 *값*이 옵션 목록에 들어가고, CLI 가 그것을 거절했을 때 "모델 이름이 틀렸다" 가 아니라
"CLI 버전을 올려라" 라는 엉뚱한 안내가 나간다. 원인이 아예 다른데 같은 문장을 쓰게 된다.

그래서 인자를 평평한 문자열 배열이 아니라 `[이름, ...값]` **짝**으로 적고, 옵션 목록은 각 짝의
첫 자리에서만 뽑는다. 값이 옵션 자리로 새는 갈래가 구조에서 사라진다.

`publicProviderFailure` 는 `unknown` 을 받는 경계이므로 거기서 한 번 더 좁힌다. `reason` 이
`unknownOption` 일 때만, 그리고 옵션 모양(`--?[A-Za-z][\w-]{0,63}`)일 때만 싣는다.

**버전 분기(D안)는 넣지 않는다.**

## 이유

**A안은 ADR-0033 이 그은 선을 반대 방향으로 넘는다.** ADR-0033 은 stderr 에 redaction 을 적용하지
않기로 하면서 그 대가로 확인 화면·상한·옵트아웃 셋을 걸었다. 사용자가 보고 결정할 재료를 주는 것과
우리가 알아서 화면에 찍는 것은 다르다. 게다가 그 텍스트에는 우리 프롬프트가 echo 되어 있다.

**B안은 절반만 고친다.** "옵션 하나를 모릅니다" 까지만 말하면 사용자는 어느 옵션인지 찾으러 다시
stderr 를 뒤져야 한다. 이 저장소에서 실패 메시지는 제품이고, 이름을 말할 수 있는데 말하지 않을
이유가 없다.

**C안의 안전성은 구조에서 나온다.** `args.find()` 의 반환값은 우리 배열의 원소이거나 `undefined`
둘 중 하나다. 정규식이 무엇을 잡든 그 문자열이 화면으로 나가지 않는다. 악의적인 MCP 서버가 툴
설명에 `unknown option '--safe-mode'` 를 심어도 최악의 결과는 우리 안내 문구가 틀리는 것뿐이고,
이는 `CODEX_ERROR_LINE` 이 이미 받아들인 것과 같은 수준의 위험이다.

**D안은 우리가 한 번 걷어낸 장치다.** ADR-0007 결과 절에 기록이 있다 — `hasRequiredCapabilities` 의
`--help` 검사가 `codex exec --help` 에 없는 config key 를 요구해 codex 가 한 번도 실행되지 않았다.
호출마다 프로세스를 하나 더 띄우는 것은 새 실패 지점이고, 얻는 것은 C안이 이미 주는 정확한 안내보다
크지 않다. 최신 CLI 에는 문제의 플래그가 이미 있어 실효도 작다.

## 결과

- `AuthoringProviderFailureReason` 의 문서화된 불변이 바뀐다. 이제 **`unknownOption` 하나만** 숫자
  상태 코드가 아니라 stderr 문장에서 유도한다. 나머지는 그대로다. 타입 주석에 이 예외를 적었다.
- `classifyFailure` 의 반환형이 enum 에서 `ProviderFailureClassification` 객체로 바뀐다. 사유만으로는
  어느 옵션인지 말할 수 없기 때문이다. `generate` 의 공개 타입이므로 breaking 이다.
- 화면 문장이 갈린다. `generate` 는 `GENERATE_PROVIDER_OPTION`, `repair` 는 `REPAIR_PROVIDER_OPTION`
  이고 둘 다 "로그인·설치·인증이 원인이 아니다" 를 명시한다. `repair` 의 파일 불변 약속은 유지한다.
- **버전 분기는 여전히 없다.** 옵션을 모르는 CLI 로는 이 통로가 돌지 않는다. 달라진 것은 사용자가
  그 사실과 해결 방법(버전 올리기)을 안다는 것뿐이다. #285 의 기대 동작 (a) 는 열린 채로 둔다.
- 실측은 stderr 문자열을 넣은 단위 테스트로만 했다. 실제 구버전 CLI 로 재현하지는 않았다.

## 승인

- 상태: 미승인.
- 필요한 승인: `generate` 오너. 공개 타입 두 개(`AuthoringProviderFailureReason`,
  `classifyFailure` 반환형)의 모양이 바뀐다.
- 확정 방법: PR 이 머지되면 이 결정이 코드로 확정된다. 그때 이 절과 문서 머리의 `상태` 를 `채택` 으로
  바꾸고 승인일과 승인한 오너를 적는다.
- 되돌리는 조건: provider CLI 들이 옵션 거절을 상태 코드나 구조화된 출력으로 알리게 되면 문자열
  대조를 걷어내고 기존 숫자 분류로 되돌린다.
