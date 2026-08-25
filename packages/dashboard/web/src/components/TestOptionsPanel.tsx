import type { JSX } from "react";
import { useState } from "react";
import type { SessionMode, TestOptions, Transport } from "../build-test-argv.js";
import { DEFAULT_TEST_OPTIONS } from "../build-test-argv.js";
import { Field, INPUT_CLASS, Toggle } from "../generate/steps/fields.js";

const TRANSPORT_LABELS: Record<Transport, string> = {
  stdio: "stdio (위 서버 명령)",
  http: "HTTP URL",
};

/** §5-4 와 같은 문장이다. 두 자리에서 같은 제약을 말하므로 한 곳에 둔다. */
export const DETERMINISM_SESSION_HINT =
  "결정론 검사는 서버에 2회 연결하지만 세션은 연결 하나에 묶여 있어 함께 쓸 수 없습니다.";

/**
 * 기본값과 다른 옵션의 수. 접힌 머리줄 요약이 쓴다.
 *
 * `headerEnvs` 만 길이 0 과 비교한다. 배열은 매번 새 참조라 `!==` 로 보면 아무것도 안 바꿔도
 * 늘 "바꿈" 이 된다.
 */
export function changedOptionCount(options: TestOptions): number {
  const keys = Object.keys(DEFAULT_TEST_OPTIONS) as readonly (keyof TestOptions)[];
  return keys.filter((key) =>
    key === "headerEnvs"
      ? options.headerEnvs.length > 0
      : options[key] !== DEFAULT_TEST_OPTIONS[key],
  ).length;
}

function GroupTitle(props: { children: string }): JSX.Element {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{props.children}</p>
  );
}

/**
 * 테스트 옵션 접이식 섹션(설계 §5-5). `mcpeak test` 의 옵션(`--json` 제외)을 GUI 컨트롤로
 * 노출한다.
 *
 * **비활성과 그 사유를 같이 보여주는 것이 이 패널의 요점이다.** CLI 가 거절하는 조합은
 * 폼에서 만들 수 없어야 하고(구현계획 §1 목표 3), 왜 못 만드는지는 컨트롤 옆에 있어야 한다.
 */
export function TestOptionsPanel(props: {
  options: TestOptions;
  /** External 세션 상태. 결정론 검사의 비활성 판정에 쓴다. */
  sessionMode: SessionMode;
  open: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<TestOptions>) => void;
}): JSX.Element {
  const [headerDraft, setHeaderDraft] = useState("");
  const options = props.options;
  const http = options.transport === "http";
  const changed = changedOptionCount(options);

  function addHeaderEnv(): void {
    if (headerDraft.trim() === "") {
      return;
    }
    props.onChange({ headerEnvs: [...options.headerEnvs, headerDraft.trim()] });
    setHeaderDraft("");
  }

  return (
    <div className="rounded-md border border-line">
      <button
        type="button"
        aria-expanded={props.open}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
        onClick={props.onToggle}
      >
        <span className="text-sm font-medium text-ink">{props.open ? "▾" : "▸"} 테스트 옵션</span>
        <span className="text-xs text-ink-muted">
          {changed === 0 ? "기본값 · 바꾼 것 없음" : `${changed}개 바꿈`}
        </span>
      </button>

      {props.open && (
        <div className="space-y-5 border-t border-line px-3 py-3">
          <div className="space-y-2">
            <GroupTitle>접속</GroupTitle>
            <fieldset className="inline-flex overflow-hidden rounded-md border border-line">
              {(Object.keys(TRANSPORT_LABELS) as readonly Transport[]).map((transport) => (
                <button
                  key={transport}
                  type="button"
                  aria-pressed={options.transport === transport}
                  className={`px-3 py-1.5 text-sm ${
                    options.transport === transport
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
                <Field label="URL" htmlFor="home-run-url">
                  <input
                    id="home-run-url"
                    className={`${INPUT_CLASS} font-mono`}
                    value={options.url}
                    onChange={(event) => props.onChange({ url: event.target.value })}
                  />
                </Field>
                <div className="space-y-2">
                  <label
                    className="block text-sm font-medium text-ink"
                    htmlFor="home-run-header-env"
                  >
                    헤더 환경변수
                  </label>
                  {options.headerEnvs.length > 0 && (
                    <ul className="flex flex-wrap gap-2">
                      {options.headerEnvs.map((entry, index) => (
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
                                headerEnvs: options.headerEnvs.filter((_, i) => i !== index),
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
                      id="home-run-header-env"
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
          </div>

          <div className="space-y-3">
            <GroupTitle>검사</GroupTitle>
            <Toggle
              id="home-run-determinism"
              label="결정론 검사"
              checked={options.determinism}
              disabled={props.sessionMode !== "off"}
              hint={
                props.sessionMode === "off"
                  ? "스위트를 2회 실행해 결과를 대조합니다."
                  : DETERMINISM_SESSION_HINT
              }
              onChange={(determinism) => props.onChange({ determinism })}
            />
            <Field
              label="초기화 명령"
              htmlFor="home-run-reset-cmd"
              hint="회차마다 실행 전에 서버 상태를 되돌리는 셸 명령입니다. 결정론 검사와 함께 쓰면 초기 상태 복원이 확인됩니다."
            >
              <input
                id="home-run-reset-cmd"
                className={`${INPUT_CLASS} font-mono`}
                value={options.resetCmd}
                onChange={(event) => props.onChange({ resetCmd: event.target.value })}
              />
            </Field>
            <Field
              label="서버 stderr 줄 수"
              htmlFor="home-run-stderr-lines"
              hint={
                http
                  ? "원격 서버에는 stderr 를 읽을 프로세스가 없습니다."
                  : "실패 시 함께 보여줄 서버 로그 줄 수. 기본 20."
              }
            >
              <input
                id="home-run-stderr-lines"
                type="number"
                min={0}
                step={1}
                className={INPUT_CLASS}
                value={options.stderrLines}
                disabled={http}
                onChange={(event) => props.onChange({ stderrLines: event.target.value })}
              />
            </Field>
          </div>

          <div className="space-y-3">
            <GroupTitle>결과 파일</GroupTitle>
            <Field
              label="JUnit 리포트"
              htmlFor="home-run-junit"
              hint="비우면 만들지 않습니다. 디렉터리는 있어야 합니다."
            >
              <input
                id="home-run-junit"
                className={`${INPUT_CLASS} font-mono`}
                value={options.junitPath}
                onChange={(event) => props.onChange({ junitPath: event.target.value })}
              />
            </Field>
            <Field
              label="Repair 번들"
              htmlFor="home-run-repair-bundle"
              hint="실패를 Repair 화면에서 고칠 수 있게 묶어 둡니다."
            >
              <input
                id="home-run-repair-bundle"
                className={`${INPUT_CLASS} font-mono`}
                value={options.repairBundlePath}
                onChange={(event) => props.onChange({ repairBundlePath: event.target.value })}
              />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}
