---
"@mcpeak/cli": patch
---

`mcpeak help test` 의 `--determinism` 항목에 표시값 마스킹의 한계를 적었습니다(#183).

차이 지점의 양쪽 값은 `token`·`apiKey` 같은 이름으로 판정해 가립니다. 그런데 서버가 결과를
JSON 문자열로 만들어 text 블록 하나에 싣는 형태(실서버의 기본 응답 형태)에서는 비밀값이 문자열
안에 있어 이름 판정이 닿지 않습니다. 설계 문서가 "redaction 이 적용된다" 고만 적어 안심하고
CI 로그에 남기던 자리라, 가려지지 않는 자리를 화면에 명시합니다
([ADR-0033](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0033-stderr-외부-전송-경계.md)
의 E3 방식, [ADR-0082](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0082-runner-의-민감-키-판정을-record-와-같은-접미-단어열-규칙으로-맞춘다.md)).
