import type { JSX } from "react";
import { useState } from "react";
import type { Transport } from "../build-test-argv.js";
import { Field, INPUT_CLASS } from "../generate/steps/fields.js";

const TRANSPORT_LABELS: Record<Transport, string> = {
  stdio: "stdio (위 서버 명령)",
  http: "HTTP URL",
};

/**
 * 접속 방식 컨트롤(설계 §6-6). 세그먼트와, HTTP 일 때의 URL·헤더 환경변수 칩이다.
 *
 * **홈과 Generate 가 같은 것을 쓴다.** 복제하면 두 화면의 문구와 검증이 갈라진다. DOM id 는
 * `idPrefix` 로만 달라지고(홈은 `home-run`), 그 밖의 문구·동작은 두 화면에서 같다.
 */
export function TransportFields(props: {
  /** 홈은 "home-run", Generate 는 "generate". DOM id 접두사다. */
  idPrefix: string;
  transport: Transport;
  url: string;
  headerEnvs: readonly string[];
  onChange: (
    patch: Partial<{ transport: Transport; url: string; headerEnvs: readonly string[] }>,
  ) => void;
}): JSX.Element {
  const [headerDraft, setHeaderDraft] = useState("");
  const http = props.transport === "http";

  function addHeaderEnv(): void {
    if (headerDraft.trim() === "") {
      return;
    }
    props.onChange({ headerEnvs: [...props.headerEnvs, headerDraft.trim()] });
    setHeaderDraft("");
  }

  return (
    <>
      <fieldset className="inline-flex overflow-hidden rounded-md border border-line">
        {(Object.keys(TRANSPORT_LABELS) as readonly Transport[]).map((transport) => (
          <button
            key={transport}
            type="button"
            aria-pressed={props.transport === transport}
            className={`px-3 py-1.5 text-sm ${
              props.transport === transport
                ? "bg-accent-soft font-semibold text-accent"
                : "text-ink-muted hover:bg-line-subtle"
            }`}
            onClick={() => props.onChange({ transport })}
          >
            {TRANSPORT_LABELS[transport]}
          </button>
        ))}
      </fieldset>
      {http && (
        <div className="space-y-3 pt-1">
          <Field label="URL" htmlFor={`${props.idPrefix}-url`}>
            <input
              id={`${props.idPrefix}-url`}
              className={`${INPUT_CLASS} font-mono`}
              value={props.url}
              onChange={(event) => props.onChange({ url: event.target.value })}
            />
          </Field>
          <div className="space-y-2">
            <label
              className="block text-sm font-medium text-ink"
              htmlFor={`${props.idPrefix}-header-env`}
            >
              헤더 환경변수
            </label>
            {props.headerEnvs.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {props.headerEnvs.map((entry, index) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: 같은 값 중복을 막지 않아 값만으로는 유일 키가 없고, 목록은 변경마다 통째로 재생성된다
                    key={`${entry}-${index}`}
                    className="inline-flex items-center gap-1.5 rounded bg-line-subtle px-2 py-0.5 font-mono text-xs text-ink"
                  >
                    {entry}
                    <button
                      type="button"
                      aria-label={`헤더 환경변수 ${entry} 제거`}
                      className="text-ink-muted hover:text-ink"
                      onClick={() =>
                        props.onChange({
                          headerEnvs: props.headerEnvs.filter((_, i) => i !== index),
                        })
                      }
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <input
                id={`${props.idPrefix}-header-env`}
                className={`${INPUT_CLASS} font-mono`}
                value={headerDraft}
                onChange={(event) => setHeaderDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addHeaderEnv();
                  }
                }}
              />
              <button
                type="button"
                className="rounded border border-line px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
                onClick={addHeaderEnv}
              >
                추가
              </button>
            </div>
            <p className="text-xs text-ink-muted">
              예: Authorization=MCP_TOKEN. 값이 아니라 환경변수 이름을 적습니다.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
