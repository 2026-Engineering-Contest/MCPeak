import { join } from "node:path";
import { WORK_DIR } from "./paths.ts";

export type FaultId = "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "C1" | "C2";

export interface Fault {
  readonly id: FaultId;
  readonly area: "tool" | "control";
  readonly target: string;
  readonly find: string;
  readonly replace: string;
}

export const FAULTS: readonly Fault[] = [
  {
    id: "F1",
    area: "tool",
    target: "tools-call-audio",
    // 오디오 mimeType 을 다른 형식으로 잘못 쓴다.
    find: "{ type: 'audio', data: TEST_AUDIO_BASE64, mimeType: 'audio/wav' }",
    replace: "{ type: 'audio', data: TEST_AUDIO_BASE64, mimeType: 'audio/mpeg' }",
  },
  {
    id: "F2",
    area: "tool",
    target: "tools-call-image",
    // 이미지 항목에서 mimeType 을 빠뜨린다. 앞의 "content: [" 까지 잡아야 mixed 도구와 구별된다.
    find: "content: [\n          { type: 'image', data: TEST_IMAGE_BASE64, mimeType: 'image/png' }\n        ]",
    replace: "content: [\n          { type: 'image', data: TEST_IMAGE_BASE64 } as any\n        ]",
  },
  {
    id: "F3",
    area: "tool",
    target: "tools-call-error",
    // 오류를 던지는 대신 정상 응답으로 돌려준다. isError 가 빠진다.
    find: "throw new Error('This tool intentionally returns an error for testing');",
    replace:
      "return {\n        content: [\n          { type: 'text', text: 'This tool intentionally returns an error for testing' }\n        ]\n      };",
  },
  {
    id: "F4",
    area: "tool",
    target: "tools-call-embedded-resource",
    // 내장 리소스의 uri 줄을 지운다.
    find: "              uri: 'test://embedded-resource',\n",
    replace: "",
  },
  {
    id: "F5",
    area: "tool",
    target: "tools-call-mixed-content",
    // 혼합 응답에서 image 항목을 지운다. 끝의 쉼표로 image 단독 도구와 구별된다.
    find: "          { type: 'image', data: TEST_IMAGE_BASE64, mimeType: 'image/png' },\n",
    replace: "",
  },
  {
    id: "F6",
    area: "tool",
    target: "json-schema-2020-12",
    // 원시 스키마 대신 SDK 변환 결과를 내보낸다. $schema 와 $defs 가 사라진다.
    find: "                inputSchema: JSON_SCHEMA_2020_12_INPUT_SCHEMA\n",
    replace:
      "                inputSchema: toJsonSchemaCompat(tool.inputSchema, {\n                  strictUnions: true,\n                  pipeStrategy: 'input'\n                }) as Tool['inputSchema']\n",
  },
  {
    id: "C1",
    area: "control",
    target: "resources-read-text",
    // 정적 텍스트 리소스 읽기 응답에서 mimeType 을 지운다.
    find: "            uri: 'test://static-text',\n            mimeType: 'text/plain',\n",
    replace: "            uri: 'test://static-text',\n",
  },
  {
    id: "C2",
    area: "control",
    target: "prompts-get-with-args",
    // 템플릿 리터럴의 $ 를 빠뜨려 인자가 치환되지 않는다.
    find: "text: `Prompt with arguments: arg1='${arg1}', arg2='${arg2}'`",
    replace: "text: `Prompt with arguments: arg1='{arg1}', arg2='{arg2}'`",
  },
];

export function applyFault(source: string, fault: Fault): string {
  const count = source.split(fault.find).length - 1;
  if (count !== 1) {
    throw new Error(`${fault.id}: 치환 대상이 ${count}번 나온다. 정확히 1번이어야 한다.`);
  }
  return source.replace(fault.find, () => fault.replace);
}

/** id 에 해당하는 결함 변형 서버 파일 경로. */
export function variantFile(id: FaultId): string {
  return join(WORK_DIR, "variants", id, "everything-server.ts");
}
