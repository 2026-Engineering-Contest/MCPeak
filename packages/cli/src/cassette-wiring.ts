import type { McpClient } from "@mcpeak/core";
import type { Cassette, CassetteMode } from "@mcpeak/record";
import { cassetteClient, loadCassette, saveCassette } from "@mcpeak/record";

/**
 * 시험 실행에 카세트 클라이언트를 배선한다. `record` 패키지를 고치지 않고 감싸기만 한다.
 *
 * 이 파일이 존재하는 이유는 `cassetteClient.close()` 의 부작용 하나다. 그 `close()` 는
 * `onFlush` 를 부른 뒤 `inner.close()` 까지 부른다. 우리는 검토가 끝날 때까지 연결을 살려
 * 둬야 하므로 시험 실행 종료 시점에 그것을 부를 수 없다. 그래서 카세트 저장을 `flush()` 로
 * 따로 떼어 냈다.
 *
 * **`flush()` 는 연결을 닫아도 되는 시점에만 불러야 한다.** 내부에서 `recorder.close()` 를
 * 부르고 그것이 `inner.close()` 까지 부르기 때문이다. 저장이 끝난 뒤에 부르는 것이 배선의
 * 계약이다. 그 전에 부르면 남은 호출이 죽은 연결로 나간다.
 */

export interface CassetteWiring {
  readonly client: McpClient;
  /**
   * 이 배선이 실제로 쓰는 모드. 화면이 재생 여부를 말할 때 이 값을 쓴다. 호출 측이 파일
   * 존재로 다시 추정하면 근거가 갈리고, 갈리는 순간 화면이 실제 동작과 어긋난다.
   *
   * 카세트를 안 쓰면 `undefined` 다.
   */
  readonly mode?: CassetteMode;
  /** 시험 실행과 저장이 끝난 뒤 호출한다. 연결이 함께 닫힌다. */
  flush(): Promise<void>;
  /** 같은 키에 다른 응답이 왔다는 경고. `record` 가 만든 문장을 그대로 담는다. */
  readonly warnings: readonly string[];
}

export interface WireCassetteOptions {
  readonly inner: McpClient;
  readonly path: string | undefined;
  readonly forceRecord: boolean;
  /** 테스트 주입점. 생략하면 record 패키지의 loadCassette·saveCassette 를 쓴다. */
  readonly io?: {
    load(path: string): Promise<Cassette | null>;
    save(path: string, cassette: Cassette): Promise<void>;
  };
}

/**
 * 카세트가 없으면 새로 녹화하고, 있으면 재생하며 빠진 것만 녹화한다. `--record` 는 있는 파일을
 * 무시한다. `replay` 는 쓰지 않는다. 새 케이스가 추가되는 것이 이 경로의 정상 흐름인데
 * `replay` 는 미스에서 실패한다. 설계 문서 §5.2.
 */
const resolveMode = (cassette: Cassette | null, forceRecord: boolean): CassetteMode =>
  forceRecord || cassette === null ? "record" : "auto";

export async function wireCassette(options: WireCassetteOptions): Promise<CassetteWiring> {
  const { inner, path, forceRecord } = options;
  if (path === undefined) {
    return { client: inner, flush: async () => {}, warnings: [] };
  }

  const io = options.io ?? { load: loadCassette, save: saveCassette };
  // 깨진 카세트를 삼키지 않는다. 삼키고 새로 녹화하면 사용자의 카세트를 말없이 버리는 것이 된다.
  const cassette = await io.load(path);

  const warnings: string[] = [];
  let snapshot: Cassette | undefined;
  const mode = resolveMode(cassette, forceRecord);
  const recorder = cassetteClient(inner, {
    cassette,
    mode,
    cassettePath: path,
    onFlush: async (value) => {
      snapshot = value;
    },
    onWarning: (message) => {
      warnings.push(message);
    },
  });

  const client: McpClient = {
    listTools: () => recorder.listTools(),
    callTool: (name, args) => recorder.callTool(name, args),
    // close 는 recorder 를 거치지 않는다. 카세트 저장은 flush() 가 소유한다. 여기서 recorder 를
    // 부르면 검토 도중의 정상 종료 경로가 카세트까지 써 버린다.
    close: () => inner.close(),
  };

  const flush = async (): Promise<void> => {
    await recorder.close(); // onFlush 로 snapshot 을 채운다. inner.close() 도 여기서 일어난다.
    if (snapshot === undefined) return;
    await io.save(path, snapshot);
  };

  return { client, mode, flush, warnings };
}
