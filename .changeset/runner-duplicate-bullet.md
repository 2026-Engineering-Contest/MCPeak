---
"@mcpeak/runner": patch
---

서버 오류 본문이 `→` 로 시작할 때 화면에 `→ →` 로 겹쳐 찍히던 것을 고칩니다([#280](https://github.com/2026-Engineering-Contest/MCPeak/issues/280)).

리포터가 위반·`notes` 줄에 조건 없이 `→ ` 글머리를 붙여서, 서버가 이미 그 글머리를 쓴 줄은 화살표가 두 개가 됐습니다.

```
전: → → 툴 'get_weather' 의 'city' 은(는) string 이어야 합니다. 받은 값: 12345 (number)
후: → 툴 'get_weather' 의 'city' 은(는) string 이어야 합니다. 받은 값: 12345 (number)
```

**목 전용 결함이 아닙니다.** `→` 글머리는 `CLAUDE.md` 「실패 메시지가 곧 제품이다」 절이 권장하는 형식이고 `examples/weather-server` 도 그렇게 쓰므로, 우리 안내를 따라 실패 메시지를 쓴 사용자 서버가 전부 이 자리에 걸렸습니다.

고친 곳은 표시 계층뿐입니다. `notes` 원문은 그대로 나갑니다 — 거절 근거 확인(ADR-0060)이 목 응답의 `→` 글머리를 완전 일치로 요구하고, `--json` 의 `notes` 와 `mcpeak generate` 의 교정 요청 문안이 같은 값을 씁니다. 서버가 들여쓴 하위 항목의 공백과 서버가 직접 쓴 두 번째 화살표도 보존합니다.
