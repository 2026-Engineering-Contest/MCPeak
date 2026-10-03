# 노트 서버 요구사항

이 서버는 도구 세 개를 제공한다. 아래가 각 도구가 받아야 할 입력과 거절해야 할 입력이다.
서버가 선언하는 스키마와 이 문서가 다르면 **이 문서가 맞다.**

## get_note

| 필드 | 타입 | 필수 | 제약 |
|---|---|---|---|
| id | string | 예 | UUID 형식 |

선언 밖 필드는 거절한다. 모르는 id 는 `isError: true` 로 답한다.

## create_note

| 필드 | 타입 | 필수 | 제약 |
|---|---|---|---|
| title | string | 예 | 길이 1 이상 80 이하 |
| body | string | 아니오 | |
| tags | string[] | 아니오 | 각 원소는 `work`, `home`, `idea` 중 하나. 최대 5개 |
| priority | string | 예 | `low`, `mid`, `high` 중 하나 |
| dueAt | string 또는 null | 예 | ISO 8601 datetime |
| parentId | string | 아니오 | UUID 형식. 존재하는 노트여야 한다 |
| author | object | 예 | `name`(string, 길이 1 이상, 필수), `email`(string, 이메일 형식, 선택) |

## list_notes

| 필드 | 타입 | 필수 | 제약 |
|---|---|---|---|
| filter | object | 아니오 | `tag`(위 태그 중 하나, 선택), `priority`(위 우선순위 중 하나 또는 null, 필수) |
| limit | number | 아니오 | 정수, 1 이상 50 이하. 기본 10 |
