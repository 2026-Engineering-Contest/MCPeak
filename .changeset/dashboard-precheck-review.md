---
"@mcpeak/dashboard": patch
---

사전 점검의 위험 설명과 붙여넣기 해석을 고친다.

- 위험 설명이 같은 규칙 id 의 변형을 가려서 말한다. 판정하지 못한 검사(`확인 안 함:`), 로컬호스트의 평문 HTTP, 인증 헤더 없이 점검한 서버, 인증용 도구의 비밀값 인자, `destructiveHint` 를 어긴 호출이 각자의 문장을 받는다. 전에는 판정하지 못한 발견 아래에 "인증 없이도 접속을 받습니다" 가 붙었다.
- 과장으로 읽히는 단정 일곱 곳을 고치고 `surface/environment-dependent` 의 문장을 더했다.
- 붙여 넣은 환경변수 값이 인자로 나가는 꼴을 막는다. `sudo KEY=value 명령`, `npx cross-env KEY=value 명령`, `sh -c "KEY=value 명령"`, `export KEY=value && 명령`, 셸 연산자가 든 줄은 거절하고, `docker run -e KEY=value` 는 그 쌍을 걷어 내 이름만 남긴다. 거절 문장에는 이름만 싣는다.
- `env -C <디렉터리>` 는 조용히 버리지 않고 거절한다.
