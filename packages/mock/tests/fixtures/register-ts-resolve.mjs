// `--import` 로 실려 ts-resolve 훅을 로더 스레드에 등록한다.
// 훅 본체는 ts-resolve.mjs 이고, 이 파일은 등록만 한다.
import { register } from "node:module";

register("./ts-resolve.mjs", import.meta.url);
