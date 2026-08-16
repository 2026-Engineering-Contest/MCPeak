---
"ohmymcp": minor
---

서버 수정 방향 제안(단계 4 repair)을 추가합니다. 승인된 명세로 `test` 를 돌려 실패가 났을 때 그 근거를 한 파일로 남기고, `ohmymcp repair` 가 그것을 AI provider 에게 물어 **서버 코드의 원인 후보**를 화면에 보여줍니다. 파일도 명세도 고치지 않습니다.

cli: `repair` 명령을 추가합니다.

```
ohmymcp repair <bundle.json> --provider <codex|claude> --model <model> [--max-cases <N>] [--no-stderr] [--yes]
```

`--provider` 와 `--model` 은 필수이며 기본값을 두지 않습니다. 외부로 나가기 전에 전송 내용을 확인 화면으로 보여주고, 비대화형 환경에서 `--yes` 가 없으면 보내지 않습니다. `n` 을 답하면 provider 를 한 번도 부르지 않고 종료 코드 0 으로 끝납니다. 진단을 받았든 근거가 부족하든 종료 코드는 0 이고, 1 이 되는 경우는 운영 실패뿐입니다(ADR-0032, ADR-0033).

cli: `test` 에 `--repair-bundle <path>` 옵션을 추가합니다. 실패한 케이스와 서버 stderr 를 담은 번들 파일을 만듭니다. `repair` 의 입력이며 `--json` 보고서와는 별도 파일입니다(ADR-0031). 실패가 없으면 파일을 만들지 않고 그 사실을 한 줄로 알립니다. 쓰기에 실패하면 전부 통과여도 종료 코드가 1 이고 `REPAIR_BUNDLE_WRITE_FAILED` 가 뜹니다. **이 옵션을 주지 않은 실행의 stdout · stderr · 종료 코드는 이전과 같습니다.**
