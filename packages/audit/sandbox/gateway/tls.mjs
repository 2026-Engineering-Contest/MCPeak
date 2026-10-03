// @ts-check
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecureContext } from "node:tls";
import { isHostname } from "./address.mjs";

/**
 * @typedef {{
 *   caPem: string,
 *   issue(host: string): Promise<{ key: string, cert: string }>,
 *   dispose(): Promise<void>,
 * }} CertificateAuthority
 *   실행마다 새로 만드는 CA. `issue` 는 호스트 이름 하나에 그 CA 로 서명한 인증서를 만든다.
 */

/** 인증서 유효 기간(일). 실행 하나보다 길기만 하면 된다. 길게 두면 새어 나간 CA 가 오래 쓸모 있다. */
const VALID_DAYS = "2";

/**
 * openssl 을 한 번 실행한다. 인자는 배열로 넘기고 셸을 거치지 않는다. env 는 PATH 만 준다.
 * 게이트웨이의 env(베어러 토큰)가 자식에게 가지 않게 한다.
 * @param {string} openssl
 * @param {ReadonlyArray<string>} args
 * @returns {Promise<string>} stdout
 */
function run(openssl, args) {
  return new Promise((resolve, reject) => {
    execFile(
      openssl,
      [...args],
      { env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin" }, shell: false },
      (error, stdout, stderr) => {
        if (error) {
          const firstLine = String(stderr)
            .split("\n")
            .find((line) => line.trim() !== "");
          reject(new Error(`openssl ${args[0]} 실패: ${firstLine ?? error.message}`));
          return;
        }
        resolve(String(stdout));
      },
    );
  });
}

/**
 * `openssl` CLI 로 실행마다 새 CA 를 만든다. 개인 키는 `directory`(컨테이너에서는 tmpfs 인 /tmp)
 * 아래에만 있고 그 밖으로 나가지 않는다. 호스트별 인증서는 키 하나를 같이 쓰고 서명만 새로 한다.
 *
 * `openssl req -x509 -CA` 는 OpenSSL 3.0 이상에 있다(격리 이미지의 bookworm 이 3.0 이다).
 *
 * @param {{ openssl?: string, directory?: string }} [options]
 * @returns {Promise<CertificateAuthority>}
 */
export async function createOpensslAuthority(options = {}) {
  const openssl = options.openssl ?? "openssl";
  const directory = await mkdtemp(join(options.directory ?? tmpdir(), "mcpeak-gateway-ca-"));
  const caKey = join(directory, "ca.key");
  const caCert = join(directory, "ca.pem");
  const leafKey = join(directory, "leaf.key");
  try {
    await run(openssl, [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-nodes",
      "-keyout",
      caKey,
      "-out",
      caCert,
      "-days",
      VALID_DAYS,
      "-subj",
      "/CN=mcpeak audit sandbox CA",
      "-addext",
      "basicConstraints=critical,CA:TRUE",
      "-addext",
      "keyUsage=critical,keyCertSign",
    ]);
    await run(openssl, [
      "genpkey",
      "-algorithm",
      "EC",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-out",
      leafKey,
    ]);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  const caPem = await readFile(caCert, "utf8");
  const key = await readFile(leafKey, "utf8");

  return {
    caPem,
    async issue(host) {
      // 이름이 명령 인자에 들어간다. 문법에 맞는 것만 여기까지 온다. 파일 이름으로는 쓰지 않는다(인증서는 stdout 으로 받는다).
      if (!isHostname(host)) throw new Error("호스트 이름 문법에 맞지 않는 이름입니다.");
      const cert = await run(openssl, [
        "req",
        "-x509",
        "-new",
        "-key",
        leafKey,
        "-CA",
        caCert,
        "-CAkey",
        caKey,
        "-days",
        VALID_DAYS,
        "-set_serial",
        `0x${randomBytes(16).toString("hex")}`,
        // CN 은 64자 제한이 있어 이름을 싣지 않는다. 이름은 subjectAltName 에만 둔다.
        "-subj",
        "/O=mcpeak audit sandbox",
        "-addext",
        `subjectAltName=DNS:${host}`,
        "-addext",
        "basicConstraints=critical,CA:FALSE",
        "-addext",
        "keyUsage=critical,digitalSignature",
        "-addext",
        "extendedKeyUsage=serverAuth",
      ]);
      return { key, cert };
    },
    async dispose() {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

/**
 * `tls.createServer` 의 `SNICallback`. 이름마다 인증서를 한 번 만들어 메모리에 둔다. 문법에 맞지 않는
 * SNI 는 서명기에 넘기지 않고 악수를 끊는다.
 * @param {CertificateAuthority} authority
 * @returns {(servername: string, callback: (error: Error | null, context?: import("node:tls").SecureContext) => void) => void}
 */
export function createSniCallback(authority) {
  /** @type {Map<string, Promise<import("node:tls").SecureContext>>} */
  const contexts = new Map();
  return (servername, callback) => {
    const host = servername.toLowerCase();
    if (!isHostname(host)) {
      callback(new Error("SNI 가 호스트 이름 문법에 맞지 않습니다."));
      return;
    }
    let context = contexts.get(host);
    if (context === undefined) {
      context = authority.issue(host).then(({ key, cert }) =>
        // 사슬에 CA 를 붙여 보낸다. 클라이언트는 CA 를 신뢰 목록에 이미 갖고 있지만, 붙여 보내도 해가 없다.
        createSecureContext({ key, cert: `${cert}\n${authority.caPem}` }),
      );
      contexts.set(host, context);
      // 실패한 서명은 다음 접속에서 다시 해 본다.
      context.catch(() => contexts.delete(host));
    }
    context.then(
      (value) => callback(null, value),
      (error) => callback(error instanceof Error ? error : new Error(String(error))),
    );
  };
}
