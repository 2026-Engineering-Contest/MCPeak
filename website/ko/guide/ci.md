# CI 연동

이 문서를 끝내면 `mcpeak test` 를 CI 에 넣고, 종료 코드와 JUnit 리포트, JSON 보고서 중 무엇을
읽을지 정한 상태가 된다.

## 종료 코드

모든 케이스가 통과하면 0 이다. 실패·타임아웃·중단이 하나라도 있으면, 그리고 명세를 못 읽거나
서버에 못 붙으면 1 이다. 가장 단순한 연동은 이것으로 끝난다.

```yaml
- run: npx @mcpeak/cli test weather.suite.json -- node ./server.mjs
```

## JUnit 리포트

```bash
mcpeak test weather.suite.json --junit reports/junit.xml -- node ./server.mjs
```

CI 도구가 읽는 JUnit XML 을 그 경로에 쓴다. stdout 은 그대로 두고 파일만 더하므로 `--json` 과
함께 쓸 수 있다. 경로의 디렉터리는 미리 있어야 한다.

파일을 쓰지 못하면 모든 테스트가 통과했더라도 `JUNIT_WRITE_FAILED` 와 함께 종료 코드 1 을
낸다. 리포트 없이 CI 가 초록이 되지 않게 하려는 것이다. XML 을 만드는 단계에서 실패하면 파일을
만들지도 덮어쓰지도 않으므로 직전 실행의 리포트가 남는다. 이 경로를 읽는 도구가 낡은 리포트를
최신으로 오해할 수 있으니 판정은 종료 코드로 한다.

`time` 속성은 전부 `0` 이다. 보고서에 시간 정보가 없어서이지 0초 걸렸다는 뜻이 아니다.

## JSON 보고서

```bash
mcpeak test weather.suite.json --json -- node ./server.mjs > report.json
```

stdout 에 보고서 JSON 이 나간다. CLI 오류와 서버 진단은 stderr 로만 나가므로 리다이렉트가
깨지지 않는다.

```json
{
  "schemaVersion": 1,
  "suite": { "id": "weather", "name": "날씨 서버" },
  "status": "passed",
  "cases": [],
  "summary": {
    "total": 8, "passed": 8, "failed": 0, "timedOut": 0,
    "cancelled": 0, "notRun": 0, "rejectionUnverified": 6
  },
  "spec": { "approval": "matched", "fingerprint": "…", "approvedFingerprint": "…" }
}
```

`spec.approval` 은 `matched` · `mismatched` · `absent` 중 하나다. 사람용 출력에서는 상황에
따라 지문 줄을 숨기지만 JSON 에는 항상 넣는다. 기계가 읽는 출력에서 키가 조건부로 사라지면
소비자가 분기를 하나 더 써야 하기 때문이다. `--determinism` 을 켜면 `determinism` 키가
더해진다([결정론성 확인](/ko/guide/determinism)).

## 서버 진단

실패했거나 서버가 비정상 종료했을 때 stderr 에 서버 프로세스 진단 블록이 붙는다. 종료 코드와
시그널, 서버가 남긴 stderr 의 마지막 N 줄이다. 기본 20줄이고 `--stderr-lines 0` 이면 끈다.
서버가 정상 종료했고 stderr 도 비어 있으면 블록을 쓰지 않는다.

## 외부 API 를 부르는 서버

CI 에서 실제 API 를 부르지 않으려면 [External 세션](/ko/guide/external-sessions)을 로컬에서
한 번 녹화해 커밋하고, CI 에서는 `--session` 으로 재생한다. 세션 파일에 자격증명이 남지
않았는지 커밋 전에 확인한다.

## 비밀값 넘기기

서버가 환경변수에서 API 키를 읽는다면 `--env NAME` 으로 이름을 지정한다. SDK 는 `HOME` · `PATH`
등 고정 목록만 자식에게 주므로 지정하지 않으면 가지 않는다. 값을 직접 받지 않는 이유는 명령줄에
쓴 토큰이 `ps` 목록과 셸 히스토리에 남기 때문이다.

```yaml
- run: mcpeak test suite.json --env WEATHER_API_KEY -- node ./server.mjs
  env:
    WEATHER_API_KEY: ${{ secrets.WEATHER_API_KEY }}
```

이미 떠 있는 HTTP 서버에 붙을 때는 `--url` 과 `--header-env 헤더=환경변수` 를 쓴다.

## 저장소가 자기를 검증하는 방법

이 저장소의 CI 는 `examples/` 의 예제 서버에 `mcpeak` 을 적용하는 E2E 를 돌린다. 이게 깨지면
사용자에게도 깨진 것이다.
