import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const contributing = readFileSync(new URL("../CONTRIBUTING.md", import.meta.url), "utf8");

/** "## 10. 이슈 · 도그푸딩 규칙" 부터 다음 "## 11." 전까지의 절 본문만 뽑아낸다. */
function getSection(heading: string, nextHeading: string): string {
  const start = contributing.indexOf(heading);
  const end = contributing.indexOf(nextHeading, start);
  expect(start, `"${heading}" 섹션을 찾을 수 없다`).toBeGreaterThan(-1);
  expect(end, `"${nextHeading}" 섹션을 찾을 수 없다`).toBeGreaterThan(start);
  return contributing.slice(start, end);
}

const section10 = getSection("## 10. 이슈 · 도그푸딩 규칙", "## 11.");
const section13_5 = getSection("### 13.5 공개 규칙", "## 부록");

describe("CONTRIBUTING.md § 10 라벨 규칙", () => {
  it("라벨 표에 패키지 · 종류 · 기타 세 묶음이 모두 있다", () => {
    expect(section10).toContain("| 묶음 | 라벨 |");
    expect(section10).toMatch(/\|\s*패키지\s*\|/);
    expect(section10).toMatch(/\|\s*종류\s*\|/);
    expect(section10).toMatch(/\|\s*기타\s*\|/);
  });

  it("패키지 라벨(pkg:*)이 실제 packages/ 디렉터리 목록과 정확히 일치한다", () => {
    const actualPackages = readdirSync(new URL("../packages", import.meta.url)).sort();

    const pkgRowMatch = section10.match(/\|\s*패키지\s*\|(.*)\|/);
    expect(pkgRowMatch, "패키지 라벨 행을 찾을 수 없다").not.toBeNull();

    const labeledPackages = [...(pkgRowMatch?.[1] ?? "").matchAll(/`pkg:([a-z-]+)`/g)]
      .map((m) => m[1])
      .sort();

    expect(labeledPackages).toEqual(actualPackages);
  });

  it("종류 라벨(type:*) 5개가 문서화되어 있다", () => {
    const typeRowMatch = section10.match(/\|\s*종류\s*\|(.*)\|/);
    expect(typeRowMatch, "종류 라벨 행을 찾을 수 없다").not.toBeNull();

    const types = [...(typeRowMatch?.[1] ?? "").matchAll(/`type:([a-z]+)`/g)].map((m) => m[1]);
    expect(types).toEqual(["bug", "feat", "docs", "chore", "question"]);
  });

  it("기타 라벨은 GitHub 기본 이름 그대로 공백 표기를 쓴다", () => {
    expect(section10).toContain("`good first issue`");
    expect(section10).toContain("`help wanted`");
    expect(section10).toContain("`blocked`");
  });

  it("help-wanted 하이픈 표기는 문서 어디에도 없다", () => {
    expect(contributing).not.toContain("help-wanted");
  });

  it("good-first-issue 하이픈 표기는 '쓰지 말라'는 경고 문장 안에만 정확히 1회 등장한다", () => {
    const occurrences = [...contributing.matchAll(/good-first-issue/g)];
    expect(occurrences).toHaveLength(1);
    expect(section10).toContain(
      "하이픈 형태(`good-first-issue`)로 만들면 평범한 라벨이 되어 그 효과가 사라진다",
    );
  });

  it("GitHub 특별 취급 때문에 공백 표기를 써야 한다는 근거가 설명되어 있다", () => {
    expect(section10).toContain("GitHub 기본 라벨 이름 그대로");
    expect(section10).toContain("기여자 탐색 페이지");
  });

  it("pkg:* 색상 그룹 설명에 6개 패키지가 모두 정확히 한 번씩만 언급된다", () => {
    const colorParagraph = section10.slice(section10.indexOf("`pkg:*` 는"));
    for (const pkg of ["core", "runner", "generate", "record", "mock", "cli"]) {
      const occurrences = colorParagraph.match(new RegExp("`" + pkg + "`", "g")) ?? [];
      expect(occurrences.length, `\`${pkg}\` 는 색상 그룹 설명에 정확히 1회 등장해야 한다`).toBe(1);
    }
  });
});

describe("CONTRIBUTING.md § 13.5 공개 규칙과 라벨 표의 일관성", () => {
  it("good first issue 라벨을 공백 표기로 참조한다", () => {
    expect(section13_5).toContain("`good first issue`");
    expect(section13_5).not.toContain("good-first-issue");
  });

  it("§10 라벨 표를 참조 링크로 남긴다", () => {
    expect(section13_5).toMatch(/§10\s*라벨\s*표/);
  });
});