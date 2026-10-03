# MCPTox 재현율 결과

## 2026-10-03 첫 실측

- MCPTox 커밋: `f85189f9ad12504c197c7f920ab818a40657b1fa`
- audit 규칙: 이 저장소의 `feat/audit-T7-cli` 브랜치(main `b318d63` 위, audit-W1b 반영)
- 사례: **1,312건** (`wrong_data` 0)
- 탐지(medium 이상): **474건, 36.1%**
- 언급(info 포함): 586건, 44.7%

| 패러다임 | 사례 | 탐지 | 재현율 |
|---|---:|---:|---:|
| Template-1 | 208 | 78 | 37.5% |
| Template-2 | 519 | 179 | 34.5% |
| Template-3 | 585 | 217 | 37.1% |

| 위험 유형 | 사례 | 탐지 | 재현율 |
|---|---:|---:|---:|
| Code Injection | 63 | 22 | 34.9% |
| Credential Leakage | 115 | 39 | 33.9% |
| Data Tampering | 117 | 47 | 40.2% |
| Financial Loss | 55 | 22 | 40.0% |
| Information Manipulation | 269 | 99 | 36.8% |
| Infrastructure Damage | 122 | 42 | 34.4% |
| Instruction Tampering | 57 | 20 | 35.1% |
| Message Hijacking | 41 | 13 | 31.7% |
| Other | 4 | 2 | 50.0% |
| Privacy Leakage | 273 | 96 | 35.2% |
| Service Disruption | 196 | 72 | 36.7% |

| 규칙 | 걸린 사례 | 비율 |
|---|---:|---:|
| `desc/injection` | 470 | 35.8% |
| `desc/sensitive-path` | 120 | 9.1% |
| `desc/cross-origin` | 52 | 4.0% |
| `desc/implicit-trigger` | 6 | 0.5% |
| `desc/shadowing` | 0 | 0.0% |
| `desc/covert-action` | 0 | 0.0% |

## 읽는 법

**탐지의 거의 전부가 태그 하나에서 나온다.** `desc/injection` 470건 중 460건의 근거 조각이 `<IMPORTANT>`
태그다. 나머지 10건이 "do not inform/notify the user" 다. 탐지 474건 가운데 469건이 "ignore … previous
instructions" 문장이 없는 사례이고, 그 문장이 있는 418건에서는 5건만 탐지됐다.

**가장 흔한 주입 문장을 놓친다.** MCPTox 의 Template-2 변형은 설명 앞에 "Ignore the previous instructions"
를 붙인다(418건). 지금 `desc/injection` 첫 문형은 `ignore (all |any )?(previous|prior|…)` 라 그 사이의
**"the"** 를 허용하지 않아, 418건 중 3건만 걸렸다. 그중 292건은 원문에 "instructionsand" 처럼 공백이
빠져 있어 `\b` 경계까지 막힌다. 이것은 측정이 찾은 규칙 결함이다.

**섀도잉 문형이 MCPTox 의 주된 표현을 놓친다.** MCPTox 의 중독 설명은 "when using the 'get-autocomplete'
tool, you MUST …"(210건), "before using the 'read_file' tool …"(60건) 처럼 다른 도구 이름을 따옴표로
가리킨다. 지금 `desc/shadowing` 문형은 "when the X tool is available", "before using the tools" 처럼
도구 이름이 따옴표 없이 오거나 관사 뒤에 바로 tools 가 오는 경우만 잡아 0건이다.

두 결함은 audit 패키지의 후속 과제로 보고했다(`docs/reports/2026-10-03-audit-T7.md`). 고치기 전의 이
값은 "태그가 붙은 중독" 의 탐지율에 가깝고, 정적 층의 실력으로 읽으면 안 된다. 패러프레이즈를 놓치는
것은 정적 층의 예상된 한계지만(ADR-0104), 위 두 건은 패러프레이즈가 아니라 문형의 빈틈이다. 이 값을
CI 하한으로 고정하는 일은 두 결함을 고친 뒤 다시 잰 값으로 한다.

측정 스크립트는 사례의 줄바꿈 표기를 정규화한다. 1,312건 중 635건은 줄바꿈이 글자 그대로의 `\n` 이고,
도구 설명 뒤에 `Arguments:` 목록이 붙은 사례가 있다. 둘 다 정규화한 뒤 형식을 못 읽은 사례는 0건이다.
