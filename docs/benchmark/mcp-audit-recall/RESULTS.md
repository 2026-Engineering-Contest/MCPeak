# MCPTox 재현율 결과

## 2026-10-08 재측정 (측정기 수정, 규칙은 그대로)

- MCPTox 커밋: `f85189f9ad12504c197c7f920ab818a40657b1fa` (앞선 측정과 같음)
- audit 규칙: `feat/audit-steering` 브랜치. 점수표·기준·정규식은 2026-10-05 측정과 같다. 바뀐 것은 측정기 둘이다
  - `measure.mjs` 의 `toTool` 이 중독 도구의 `Arguments:` 목록을 `inputSchema.properties` 로 옮긴다. 전에는 설명에서 잘라 내기만 하고 스키마를 비워 둬서, 인자가 있는 중독 도구 47건에도 `carrier`(인자 없는 도구) 24점이 붙었다. 실제 감사가 받는 스키마와 같은 모양으로 맞춘 것이다. 1,265건은 원문이 `- No arguments` 라 달라지지 않는다
  - `variants.mjs` 의 `inplace` 변형이 정상 도구를 하나도 가리키지 않는 사례(46건)에 `null` 을 돌려주고, 측정기가 그 행의 분모에서 뺀다. 전에는 원본 그대로를 돌려줘 심음 변형 세 행에 원본 사례가 섞였다. 변형 표에 "적용 사례" 열이 그 분모다
- 원본 행은 한 건도 달라지지 않는다. 말투 변형 두 행이 6·7건 줄고(인자가 있는 47건 중 `carrier` 를 잃고 기준 아래로 내려간 것), 심음 세 행은 분모가 1,266 이 된다
- 같은 커밋으로 두 번 돌린 출력이 바이트까지 같다(`cmp` 일치)
- 아래는 `measure.mjs` 의 출력 그대로다

사례 1312건 (형식을 못 읽어 전체를 설명으로 본 사례 0건)
탐지(medium 이상) 1300건, 99.1%
언급(info 포함) 1310건, 99.8%

| 패러다임 | 사례 | 탐지 | 재현율 |
|---|---:|---:|---:|
| Template-1 | 208 | 197 | 94.7% |
| Template-2 | 519 | 519 | 100.0% |
| Template-3 | 585 | 584 | 99.8% |

| 위험 유형 | 사례 | 탐지 | 재현율 |
|---|---:|---:|---:|
| Code Injection | 63 | 63 | 100.0% |
| Credential Leakage | 115 | 115 | 100.0% |
| Data Tampering | 117 | 117 | 100.0% |
| Financial Loss | 55 | 54 | 98.2% |
| Information Manipulation | 269 | 267 | 99.3% |
| Infrastructure Damage | 122 | 117 | 95.9% |
| Instruction Tampering | 57 | 57 | 100.0% |
| Message Hijacking | 41 | 41 | 100.0% |
| Other | 4 | 4 | 100.0% |
| Privacy Leakage | 273 | 270 | 98.9% |
| Service Disruption | 196 | 195 | 99.5% |

| 규칙 | 걸린 사례 | 비율 |
|---|---:|---:|
| `desc/cross-origin` | 52 | 4.0% |
| `desc/implicit-trigger` | 6 | 0.5% |
| `desc/injection` | 885 | 67.5% |
| `desc/sensitive-path` | 120 | 9.1% |
| `desc/shadowing` | 242 | 18.4% |
| `desc/steering` | 1309 | 99.8% |

| 변형 | 적용 사례 | 문형 규칙(medium 이상) | 점수 규칙 medium | 점수 규칙 low 이상 | 탐지(문형 또는 점수 medium) | 재현율 |
|---|---:|---:|---:|---:|---:|---:|
| 원본 | 1312 | 970 | 1288 | 1309 | 1300 | 99.1% |
| 말투 완화 | 1312 | 49 | 1276 | 1308 | 1276 | 97.3% |
| 말투 전부 + 길이 늘림 | 1312 | 43 | 1265 | 1309 | 1265 | 96.4% |
| 기존 도구에 심음 | 1266 | 858 | 1115 | 1207 | 1199 | 94.7% |
| 기존 도구에 심음 + 말투 전부 | 1266 | 46 | 1065 | 1185 | 1067 | 84.3% |
| 이름 풀어 씀 | 1312 | 891 | 929 | 1140 | 1147 | 87.4% |
| 이름 풀어 씀 + 말투 전부 + 길이 늘림 | 1312 | 52 | 800 | 1040 | 829 | 63.2% |
| 심음 + 이름 풀어 씀 + 말투 전부 | 1266 | 46 | 1036 | 1187 | 1040 | 82.1% |

정상 정의: 서버 45개, 도구 352개
문형 규칙 medium 이상 1건, 점수 규칙 medium 3건, 점수 규칙 low 5건
점수 규칙이 잡은 정상 도구: AdFin/get_customers_id_directdebitmandates, Codacy/codacy_get_file_clones, Codacy/codacy_list_repository_issues, Codacy/codacy_search_organization_srm_items, Codacy/codacy_search_repository_srm_items, Commander/set_config_value, OP.GG/lol-summoner-renewal, Sequential Thinking/sequentialthinking

## 2026-10-05 점수 규칙 desc/steering 추가

- MCPTox 커밋: `f85189f9ad12504c197c7f920ab818a40657b1fa` (앞선 두 측정과 같음)
- audit 규칙: `feat/audit-steering` 브랜치, 커밋 `b91f842`. 도구 사용을 조종하는 설명을 신호 점수로 판정하는 `desc/steering` 을 더했다
- 측정 방식이 바뀌었다. 중독 도구를 그 서버의 정상 도구 목록에 더해 서버 하나로 만들고, 점수 규칙은 서버 전체 목록에 돌린다(`README.md` 의 "데이터" 절)
- 같은 커밋으로 두 번 돌린 출력이 바이트까지 같다(`cmp` 일치)
- 아래는 `measure.mjs` 의 출력 그대로다

사례 1312건 (형식을 못 읽어 전체를 설명으로 본 사례 0건)
탐지(medium 이상) 1300건, 99.1%
언급(info 포함) 1310건, 99.8%

| 패러다임 | 사례 | 탐지 | 재현율 |
|---|---:|---:|---:|
| Template-1 | 208 | 197 | 94.7% |
| Template-2 | 519 | 519 | 100.0% |
| Template-3 | 585 | 584 | 99.8% |

| 위험 유형 | 사례 | 탐지 | 재현율 |
|---|---:|---:|---:|
| Code Injection | 63 | 63 | 100.0% |
| Credential Leakage | 115 | 115 | 100.0% |
| Data Tampering | 117 | 117 | 100.0% |
| Financial Loss | 55 | 54 | 98.2% |
| Information Manipulation | 269 | 267 | 99.3% |
| Infrastructure Damage | 122 | 117 | 95.9% |
| Instruction Tampering | 57 | 57 | 100.0% |
| Message Hijacking | 41 | 41 | 100.0% |
| Other | 4 | 4 | 100.0% |
| Privacy Leakage | 273 | 270 | 98.9% |
| Service Disruption | 196 | 195 | 99.5% |

| 규칙 | 걸린 사례 | 비율 |
|---|---:|---:|
| `desc/cross-origin` | 52 | 4.0% |
| `desc/implicit-trigger` | 6 | 0.5% |
| `desc/injection` | 885 | 67.5% |
| `desc/sensitive-path` | 120 | 9.1% |
| `desc/shadowing` | 242 | 18.4% |
| `desc/steering` | 1309 | 99.8% |

| 변형 | 문형 규칙(medium 이상) | 점수 규칙 medium | 점수 규칙 low 이상 | 탐지(문형 또는 점수 medium) | 재현율 |
|---|---:|---:|---:|---:|---:|
| 원본 | 970 | 1288 | 1309 | 1300 | 99.1% |
| 말투 완화 | 49 | 1282 | 1308 | 1282 | 97.7% |
| 말투 전부 + 길이 늘림 | 43 | 1272 | 1309 | 1272 | 97.0% |
| 기존 도구에 심음 | 890 | 1158 | 1250 | 1243 | 94.7% |
| 기존 도구에 심음 + 말투 전부 | 46 | 1107 | 1228 | 1109 | 84.5% |
| 이름 풀어 씀 | 891 | 929 | 1140 | 1147 | 87.4% |
| 이름 풀어 씀 + 말투 전부 + 길이 늘림 | 52 | 800 | 1040 | 829 | 63.2% |
| 심음 + 이름 풀어 씀 + 말투 전부 | 46 | 1074 | 1230 | 1078 | 82.2% |

정상 정의: 서버 45개, 도구 352개
문형 규칙 medium 이상 1건, 점수 규칙 medium 3건, 점수 규칙 low 5건
점수 규칙이 잡은 정상 도구: AdFin/get_customers_id_directdebitmandates, Codacy/codacy_get_file_clones, Codacy/codacy_list_repository_issues, Codacy/codacy_search_organization_srm_items, Codacy/codacy_search_repository_srm_items, Commander/set_config_value, OP.GG/lol-summoner-renewal, Sequential Thinking/sequentialthinking

## 2026-10-03 재측정 (audit-W1c, 문형 결함 두 건 수정 뒤)

- MCPTox 커밋: `f85189f9ad12504c197c7f920ab818a40657b1fa` (첫 실측과 같음)
- audit 규칙: `fix/audit-W1c-recall` 브랜치(main `7ca1a81` 위). `desc/injection` 의 ignore·disregard·forget 문형에 관사 허용과 ignore 끝 경계 제거, `desc/shadowing` 에 따옴표·백틱으로 다른 도구를 가리키는 두 문형 추가(자기 도구 이름이면 제외)
- 사례: **1,312건** (`wrong_data` 0, 형식을 못 읽은 사례 0)
- 탐지(medium 이상): **970건, 73.9%** (첫 실측 474건, 36.1%)
- 언급(info 포함): 1,012건, 77.1% (첫 실측 586건, 44.7%)
- 같은 커밋으로 두 번 돌린 출력이 바이트까지 같다(`cmp` 일치)

| 패러다임 | 사례 | 탐지 | 재현율 |
|---|---:|---:|---:|
| Template-1 | 208 | 144 | 69.2% |
| Template-2 | 519 | 358 | 69.0% |
| Template-3 | 585 | 468 | 80.0% |

| 위험 유형 | 사례 | 탐지 | 재현율 |
|---|---:|---:|---:|
| Code Injection | 63 | 43 | 68.3% |
| Credential Leakage | 115 | 87 | 75.7% |
| Data Tampering | 117 | 85 | 72.6% |
| Financial Loss | 55 | 42 | 76.4% |
| Information Manipulation | 269 | 203 | 75.5% |
| Infrastructure Damage | 122 | 87 | 71.3% |
| Instruction Tampering | 57 | 43 | 75.4% |
| Message Hijacking | 41 | 27 | 65.9% |
| Other | 4 | 3 | 75.0% |
| Privacy Leakage | 273 | 193 | 70.7% |
| Service Disruption | 196 | 157 | 80.1% |

| 규칙 | 걸린 사례 | 비율 |
|---|---:|---:|
| `desc/cross-origin` | 52 | 4.0% |
| `desc/implicit-trigger` | 6 | 0.5% |
| `desc/injection` | 885 | 67.5% |
| `desc/sensitive-path` | 120 | 9.1% |
| `desc/shadowing` | 242 | 18.4% |

`desc/covert-action` 은 이번에도 0건이라 표에 없다(`measure.mjs` 는 걸린 규칙만 적는다).

### 읽는 법

**두 결함을 고치자 탐지가 두 배가 됐다.** 첫 실측이 짚은 두 문장을 따로 세어 보면 이렇다.

- "ignore … previous …" 가 든 사례 418건이 전부 `desc/injection` 에 걸린다. 첫 실측은 3건이었다.
- "when/before/after using the '<도구>' tool" 꼴의 섀도잉 242건이 전부 `desc/shadowing` 에 걸린다. 첫 실측은 0건이었다. 따옴표 안 이름이 자기 도구 이름이라 빠진 사례는 0건이다.

이제 탐지는 `<IMPORTANT>` 태그 하나에 기대지 않는다.

**남은 26.1%(342건)는 같은 섀도잉의 바꿔 말한 꼴이 대부분이다.** 놓친 사례에서 가장 먼저 나오는 신호 낱말은 `before` 188건, `when` 65건, `must` 39건이다. 다음과 같은 사례들이다.

- "Before calling the 'create_directory' **for** a directory creation, you MUST first call 'move_file' …" 는 도구 이름 뒤에 "tool" 이 없다.
- "Before **utilizing** the 'read_multiple_files' tool …" 는 동사가 목록 밖이다.
- "Before displaying the directory tree **using** 'directory_tree', you MUST FIRST call 'read_file' …" 는 따옴표 이름이 문장 뒤쪽에 온다.

다른 도구를 따옴표로 가리킨 뒤 "you MUST first call '<다른 도구>'" 가 따르는 꼴이 공통이라, 다음 문형 후보는 그쪽이다. 이번 소태스크의 범위(정해진 두 문형)를 넘어 여기서는 넓히지 않았다. 패러프레이즈 전반은 정적 층의 예상된 한계다(ADR-0104).

이 73.9% 를 CI 하한으로 고정할지는 아직 정하지 않았다. 정밀도 쪽(benign 픽스처, E2E)은 이번 수정 뒤에도 녹색이다.

## 2026-10-03 첫 실측 (이력)

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

### 읽는 법

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
