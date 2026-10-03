# 격리 이미지. target 컨테이너와 gateway 컨테이너가 이 이미지 하나를 함께 쓴다.
# 베이스는 다이제스트로 고정한다. 태그만 두면 이미지가 조용히 바뀐다
# (ci.yml 이 액션을 SHA 로 고정하는 것과 같은 이유). 다이제스트는 `docker pull node:22-bookworm-slim` 뒤
# `docker inspect --format '{{index .RepoDigests 0}}' node:22-bookworm-slim` 로 읽은 값이다.
FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c
RUN apt-get update \
 && apt-get install -y --no-install-recommends strace openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# strace 기록용 볼륨의 마운트 자리. 빈 볼륨이 처음 붙을 때 이 소유자를 물려받는다.
RUN install -d -o node -g node /var/mcpeak
COPY gateway/ /opt/mcpeak/gateway/
