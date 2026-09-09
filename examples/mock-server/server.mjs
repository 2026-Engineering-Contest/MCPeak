#!/usr/bin/env node
/**
 * 예제 목 MCP 서버 — `weather.mock.json` 을 그대로 서빙한다.
 *
 * `mcpeak-mock <정의파일>` 을 직접 쓸 수도 있지만, 그러면 실행할 때마다 정의 파일 경로를
 * 인자로 붙여야 하고 대시보드 후보 목록에도 안 뜬다. 이 파일은 **정의 파일을 자기 옆에서
 * 읽는 서버 하나**라, 다른 예제 서버(`examples/weather-server/server.mjs`)와 같은 방식으로
 * 고르고 같은 방식으로 스위트가 짝지어진다.
 *
 * stdout 에는 아무것도 쓰지 않는다. stdio 트랜스포트가 그 채널을 쓴다.
 */
import { readFileSync } from "node:fs";
import { assertMockDefinition, serveStdio } from "@mcpeak/mock";

const path = new URL("./weather.mock.json", import.meta.url);
const definition = JSON.parse(readFileSync(path, "utf8"));
assertMockDefinition(definition, "examples/mock-server/weather.mock.json");

await serveStdio(definition);
