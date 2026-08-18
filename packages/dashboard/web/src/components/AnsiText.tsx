/**
 * 서버 `ansiToHtml`(packages/dashboard/src/server/ansi.ts)이 만든 HTML 조각을 그대로
 * 렌더링한다. `ansiToHtml`은 `&`·`<`·`>`를 항상 이스케이프하는 것을 계약으로 보장하므로
 * (T1 테스트가 이 계약을 단언한다) 여기서 다시 이스케이프하거나 파싱하지 않는다.
 */
interface AnsiTextProps {
  readonly html: string;
}

export function AnsiText({ html }: AnsiTextProps) {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: 서버 ansiToHtml이 이스케이프를 보장한다(T1 테스트가 그 계약을 단언한다).
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
