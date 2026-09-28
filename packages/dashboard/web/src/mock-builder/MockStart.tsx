import type { JSX } from "react";
import { useEffect, useState } from "react";
import type { FileContent, JsonValue, MockFileEntry } from "../../../src/api-types.js";
import { apiGet } from "../api.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { type MockDraft, mockFilePath } from "./draft.js";
import { draftFromDefinition } from "./from-definition.js";

/** 기존 목을 연 결과. `mtimeMs` 는 저장할 때 덮어쓰기 기준이 된다. */
export interface LoadedMock {
  readonly path: string;
  readonly mtimeMs: number;
  readonly draft: MockDraft;
}

export interface MockStartProps {
  readonly onNew: () => void;
  readonly onOpen: (mock: LoadedMock) => void;
}

/**
 * 첫 화면. 새로 만들기 · 기존 목 수정 둘 중 하나다. 녹화본은 여기서 고르지 않는다 — 편집 중
 * 옆에 펴 두는 참고 패널이다(설계 §화면 흐름).
 */
export function MockStart({ onNew, onOpen }: MockStartProps): JSX.Element {
  const [mocks, setMocks] = useState<readonly MockFileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    apiGet<MockFileEntry[]>("/api/mocks")
      .then(setMocks)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  function open(path: string): void {
    setOpening(true);
    setError(null);
    apiGet<FileContent>(mockFilePath(path))
      .then((file) => {
        // 서버가 assertMockDefinition 으로 본 내용이다. 여기서는 모양만 옮긴다.
        const draft = draftFromDefinition(JSON.parse(file.content) as JsonValue);
        onOpen({ path: file.path, mtimeMs: file.mtimeMs, draft });
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setOpening(false);
      });
  }

  return (
    <div className="grid grid-cols-2 items-start gap-6">
      <Card className="space-y-3 p-6">
        <h2 className="text-title font-semibold text-ink">새로 만들기</h2>
        <p className="text-sm text-ink-muted">빈 폼에서 도구와 응답을 적습니다.</p>
        <Button variant="primary" onClick={onNew}>
          시작
        </Button>
      </Card>
      <Card className="space-y-3 p-6">
        <h2 className="text-title font-semibold text-ink">기존 목 수정</h2>
        <p className="text-sm text-ink-muted">저장된 목 정의 파일을 열어 고칩니다.</p>
        {mocks === null && error === null && <p className="text-sm text-ink-muted">찾는 중…</p>}
        {mocks !== null && mocks.length === 0 && (
          <p className="text-sm text-ink-muted">
            이 디렉터리 아래에 목 정의 파일이 없습니다. 새로 만들기로 시작하세요.
          </p>
        )}
        {mocks !== null && mocks.length > 0 && (
          <ul className="space-y-1">
            {mocks.map((mock) => (
              <li key={mock.path} className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{mock.path}</span>
                  <span className="block text-xs text-ink-muted">
                    {`도구 ${mock.toolCount} · 응답 ${mock.responseCount}`}
                  </span>
                </span>
                <Button
                  size="xs"
                  disabled={opening}
                  aria-label={`${mock.path} 열기`}
                  onClick={() => open(mock.path)}
                >
                  열기
                </Button>
              </li>
            ))}
          </ul>
        )}
        {mocks !== null && mocks.length > 0 && (
          <p className="text-xs text-ink-muted">목 정의 검사를 통과한 .json 만 나옵니다.</p>
        )}
        {error !== null && (
          <p role="alert" className="whitespace-pre-line text-sm text-ink">
            {error}
          </p>
        )}
      </Card>
    </div>
  );
}
