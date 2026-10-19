import type { JSX } from "react";
import type { Transport } from "../build-test-argv.js";
import { ArgChips } from "../components/ArgChips.js";
import { Field, INPUT_CLASS, Toggle } from "../components/Field.js";
import { SegmentedControl } from "../components/SegmentedControl.js";
import type { ProbeChoice, SecurityForm } from "./build-security-request.js";

const PROBE_OPTIONS: readonly { readonly value: ProbeChoice; readonly label: string }[] = [
  { value: "auto", label: "자동" },
  { value: "readonly", label: "읽기 전용만" },
  { value: "none", label: "호출 안 함" },
  { value: "all", label: "전부" },
];

export const REMOTE_SANDBOX_HINT =
  "원격 서버는 격리할 수 없습니다. 격리는 프로세스를 띄우는 대상에만 적용됩니다.";
/** 격리 이미지가 띄울 수 있는 명령. `npx -y` 로 받는 서버도 뜬다(PR #498, ADR-0109). */
const SANDBOX_HINT = "격리 이미지는 node, npx, npm 으로 띄우는 서버만 실행합니다.";
const COMPARE_HOST_HINT =
  "서버를 이 머신에서 한 번 더 띄워 tools/list 만 받습니다. 도구는 호출하지 않습니다.";

/**
 * 점검 옵션 구획. 폼 값은 부모가 들고 있고 여기서는 그리기와 부분 갱신만 한다. 원격 대상이면 격리 체크가
 * 남아 있어도 꺼진 것으로 보인다(요청에도 싣지 않는다. `buildSecurityRequest`).
 */
export function SecurityOptions({
  form,
  transport,
  onChange,
}: {
  readonly form: SecurityForm;
  readonly transport: Transport;
  readonly onChange: (partial: Partial<SecurityForm>) => void;
}): JSX.Element {
  const http = transport === "http";
  const sandboxOn = form.sandbox && !http;
  const baselineEmpty = form.baselinePath.trim() === "";

  return (
    <div className="space-y-4 border-t border-line pt-5">
      <h2 className="text-title font-semibold text-ink">점검 옵션</h2>

      <div className="space-y-1">
        <p className="text-sm font-medium text-ink">호출 정책</p>
        <SegmentedControl
          options={PROBE_OPTIONS}
          value={form.probe}
          onChange={(probe) => onChange({ probe })}
        />
        <p className="text-xs text-ink-muted">
          자동은 격리 안에서는 전부, 격리가 없으면 읽기 전용 도구만 호출합니다.
        </p>
      </div>

      <div className="space-y-2">
        <Field label="기준 파일 (프로젝트 루트 기준, 선택)" htmlFor="security-baseline-path">
          <input
            id="security-baseline-path"
            className={`${INPUT_CLASS} font-mono`}
            value={form.baselinePath}
            placeholder=".mcpeak/audit-baseline.json"
            onChange={(event) => onChange({ baselinePath: event.target.value })}
          />
        </Field>
        <Toggle
          id="security-update-baseline"
          label="기준 파일을 지금 표면으로 갱신"
          checked={form.updateBaseline && !baselineEmpty}
          disabled={baselineEmpty}
          onChange={(updateBaseline) => onChange({ updateBaseline })}
        />
      </div>

      <div className="space-y-3">
        <Toggle
          id="security-sandbox"
          label="Docker 격리 안에서 실행 (행위 관측)"
          checked={sandboxOn}
          disabled={http}
          hint={http ? REMOTE_SANDBOX_HINT : sandboxOn ? SANDBOX_HINT : undefined}
          onChange={(sandbox) => onChange({ sandbox })}
        />
        {sandboxOn && (
          <div className="space-y-3 pl-6">
            <Toggle
              id="security-compare-host"
              label="이 머신에서 받은 도구 표면과 비교 (--compare-host)"
              checked={form.compareHost}
              hint={COMPARE_HOST_HINT}
              onChange={(compareHost) => onChange({ compareHost })}
            />
            <ArgChips
              idPrefix="security-allow-host"
              args={form.allowHosts}
              hint="--allow-host"
              label="허용 호스트"
              placeholder="호스트 이름 하나씩 추가 (예: api.example.com)"
              removeLabel={(host) => `허용 호스트 ${host} 제거`}
              onChange={(allowHosts) => onChange({ allowHosts })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
