---
"ohmymcp": patch
---

`generate`: 실패할 때 `generate`가 이미 알고 있던 원인을 그대로 보여 줍니다. 지금까지는 스키마가 거절돼도 `GENERATE_FAILED`와 "MCP 서버와 출력 경로를 확인하세요"만 나왔는데, 서버도 경로도 멀쩡한 경우라 **틀린 안내**였습니다. 이제 오류 코드·스키마 경로·원인·조치가 모두 나옵니다.

```
오류 [UNSUPPORTED_SCHEMA]: 지원하지 않는 JSON Schema 키워드 '$schema'가 있습니다. 경로: tools[0].inputSchema.$schema
해결: 첫 버전은 type, required, properties, items, enum, const, default, examples, description, title, $schema를 지원합니다.
```
