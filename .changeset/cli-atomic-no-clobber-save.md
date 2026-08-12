---
"ohmymcp": patch
---

suite 저장을 원자적 no-clobber로 바꾼다. 지금까지는 저장 전에 출력 경로를 검사한 뒤 `rename`으로
커밋했는데, `rename`은 대상이 있으면 말없이 덮어쓴다. 검사와 커밋 사이에 다른 프로세스가 같은
경로를 만들면 그 파일이 조용히 사라졌다. 이제 `link`로 커밋해 대상이 있으면 `EEXIST`로 실패하고
`GENERATE_OUTPUT_EXISTS`로 안내한다. 임시 파일 이름도 실행마다 고유해진다.
