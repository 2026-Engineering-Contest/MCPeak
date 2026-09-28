// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  newResponseDraft,
  newToolDraft,
  type ResponseDraft,
  type ToolDraft,
} from "../src/mock-builder/draft.js";
import { ResponseEditor } from "../src/mock-builder/ResponseEditor.js";
import { ToolEditor } from "../src/mock-builder/ToolEditor.js";

afterEach(() => {
  cleanup();
});

/** 편집기는 상태를 갖지 않는다. 부모 흉내를 내며 마지막 값을 들고 있는다. */
function ToolHarness(props: { initial: ToolDraft; onLatest?: (tool: ToolDraft) => void }) {
  const [tool, setTool] = useState(props.initial);
  return (
    <ToolEditor
      index={0}
      tool={tool}
      onChange={(next) => {
        setTool(next);
        props.onLatest?.(next);
      }}
      onRemove={() => undefined}
    />
  );
}

const TOOLS: readonly ToolDraft[] = [
  { ...newToolDraft("get_weather"), fields: [{ name: "city", type: "string", required: true }] },
  newToolDraft("search"),
];

function ResponseHarness(props: {
  initial: ResponseDraft;
  highlighted?: boolean;
  onLatest?: (response: ResponseDraft) => void;
}) {
  const [response, setResponse] = useState(props.initial);
  return (
    <ResponseEditor
      index={0}
      response={response}
      tools={TOOLS}
      highlighted={props.highlighted ?? false}
      onChange={(next) => {
        setResponse(next);
        props.onLatest?.(next);
      }}
      onRemove={() => undefined}
    />
  );
}

describe("ToolEditor", () => {
  it("이름 · 설명과 평면 필드를 고친다", () => {
    let latest: ToolDraft | undefined;
    render(
      <ToolHarness
        initial={newToolDraft()}
        onLatest={(tool) => {
          latest = tool;
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText("도구 이름"), { target: { value: "get_weather" } });
    fireEvent.change(screen.getByLabelText("설명"), { target: { value: "도시의 현재 날씨" } });
    fireEvent.click(screen.getByRole("button", { name: "필드 추가" }));
    fireEvent.change(screen.getByLabelText("필드 1 이름"), { target: { value: "days" } });
    fireEvent.change(screen.getByLabelText("필드 1 타입"), { target: { value: "integer" } });
    fireEvent.click(screen.getByLabelText("필드 1 필수"));
    expect(latest).toMatchObject({
      name: "get_weather",
      description: "도시의 현재 날씨",
      fields: [{ name: "days", type: "integer", required: true }],
    });
  });

  it("JSON 으로 편집하면 지금 필드로 만든 스키마가 채워지고, 평면이면 폼으로 돌아간다", () => {
    let latest: ToolDraft | undefined;
    render(
      <ToolHarness
        initial={{
          ...newToolDraft("get_weather"),
          fields: [{ name: "city", type: "string", required: true }],
        }}
        onLatest={(tool) => {
          latest = tool;
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "JSON 으로 편집" }));
    expect((screen.getByLabelText("입력 스키마 (JSON)") as HTMLTextAreaElement).value).toBe(
      JSON.stringify(
        { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
        null,
        2,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "폼으로 돌아가기" }));
    expect(latest?.schemaMode).toBe("fields");
    expect(latest?.fields).toEqual([{ name: "city", type: "string", required: true }]);
  });

  it("평면으로 못 돌아가는 스키마면 버튼을 끄고 이유를 적는다", () => {
    render(
      <ToolHarness
        initial={{
          ...newToolDraft("get_weather"),
          schemaMode: "json",
          schemaJson: '{"type":"object","properties":{"unit":{"type":"string","enum":["c","f"]}}}',
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "폼으로 돌아가기" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(
      screen.getByText(
        "평면 폼으로 돌아갈 수 없습니다 — 필드 'unit' 의 'enum' 은(는) 평면 폼에 자리가 없습니다.",
      ),
    ).toBeTruthy();
  });

  it("JSON 을 읽을 수 없어도 버튼을 끄고 이유를 적는다", () => {
    render(
      <ToolHarness initial={{ ...newToolDraft("t"), schemaMode: "json", schemaJson: "{ type:" }} />,
    );
    expect(
      screen.getByText(
        "평면 폼으로 돌아갈 수 없습니다 — 스키마 JSON 을 읽을 수 없습니다. 따옴표·쉼표·괄호 짝을 확인하세요.",
      ),
    ).toBeTruthy();
  });

  it("보존 키가 있으면 알린다", () => {
    render(
      <ToolHarness
        initial={{ ...newToolDraft("t"), extra: { outputSchema: {}, annotations: {} } }}
      />,
    );
    expect(
      screen.getByText("폼에 칸이 없는 키 2개를 그대로 보존합니다: outputSchema, annotations"),
    ).toBeTruthy();
  });
});

describe("ResponseEditor", () => {
  it("인자 무관을 켜면 args 칸이 꺼진다", () => {
    let latest: ResponseDraft | undefined;
    render(
      <ResponseHarness
        initial={newResponseDraft("get_weather")}
        onLatest={(r) => {
          latest = r;
        }}
      />,
    );
    fireEvent.click(screen.getByLabelText("인자 무관 (ANY)"));
    expect(latest?.anyArgs).toBe(true);
    expect(screen.getByLabelText("args (JSON)")).toHaveProperty("disabled", true);
  });

  it("도구 · result · isError 를 고친다", () => {
    let latest: ResponseDraft | undefined;
    render(
      <ResponseHarness
        initial={newResponseDraft("get_weather")}
        onLatest={(r) => {
          latest = r;
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText("도구"), { target: { value: "search" } });
    fireEvent.change(screen.getByLabelText("result (JSON)"), { target: { value: "[]" } });
    fireEvent.click(screen.getByLabelText("서버의 거절로 표시 (isError)"));
    expect(latest).toMatchObject({ tool: "search", resultJson: "[]", isError: true });
  });

  it("녹화 응답의 result 에 URL 이 있으면 경고하고, 지우면 사라진다", () => {
    render(
      <ResponseHarness
        initial={{
          ...newResponseDraft("get_weather"),
          origin: "recording",
          resultJson: '{"next":"https://a.example/p/2","docs":"https://b.example/"}',
        }}
      />,
    );
    const first =
      "→ 이 응답 본문에 URL 이 2개 있습니다. 녹화 때 가려지지 않는 자리라 자격증명이 담겼을 수 있습니다.";
    expect(screen.getByText(first)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("result (JSON)"), {
      target: { value: '{"temperature":21.5}' },
    });
    expect(screen.queryByText(first)).toBeNull();
  });

  it("손으로 친 응답은 URL 이 있어도 경고하지 않는다", () => {
    render(
      <ResponseHarness
        initial={{ ...newResponseDraft("get_weather"), resultJson: '{"a":"https://a.example/"}' }}
      />,
    );
    expect(screen.queryByText(/URL 이 1개 있습니다/)).toBeNull();
  });

  it("강조되면 data-highlighted 가 붙는다", () => {
    const { container } = render(
      <ResponseHarness initial={newResponseDraft("get_weather")} highlighted />,
    );
    expect(container.querySelector("fieldset")?.getAttribute("data-highlighted")).toBe("true");
  });

  it("도구를 고르면 args 가 {} 일 때만 그 도구의 입력 필드로 채운다", () => {
    let latest: ResponseDraft | undefined;
    render(
      <ResponseHarness
        initial={newResponseDraft("search")}
        onLatest={(r) => {
          latest = r;
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText("도구"), { target: { value: "get_weather" } });
    expect(latest?.argsJson).toBe('{"city":""}');

    fireEvent.change(screen.getByLabelText("args (JSON)"), {
      target: { value: '{"city":"Seoul"}' },
    });
    fireEvent.change(screen.getByLabelText("도구"), { target: { value: "search" } });
    fireEvent.change(screen.getByLabelText("도구"), { target: { value: "get_weather" } });
    expect(latest?.argsJson).toBe('{"city":"Seoul"}');
  });

  it("필수 입력이 빠진 args 는 그 줄에서 말하고, 채우면 사라진다", () => {
    render(<ResponseHarness initial={newResponseDraft("get_weather")} />);
    const missing =
      "→ args 에 get_weather 의 필수 입력 'city' 값이 없습니다. 목 서버가 이 호출을 인자 검사에서 거절하므로 이 응답은 쓰이지 않습니다.";
    expect(screen.getByText(missing)).toBeTruthy();
    expect(
      screen.getByText("→ 도구에 입력 필드를 추가했거나 이름을 바꿨다면 args 도 같이 고치세요."),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("args (JSON)"), {
      target: { value: '{"city":"Seoul"}' },
    });
    expect(screen.queryByText(missing)).toBeNull();
  });

  it("응답의 도구가 폼에 없으면 그 줄에서 바로 말한다", () => {
    render(<ResponseHarness initial={newResponseDraft("get_weathr")} />);
    expect(
      screen.getByText("→ 'get_weathr' 도구가 폼에 없습니다. 위 도구 목록에서 다시 고르세요."),
    ).toBeTruthy();
  });

  it("도구가 비어 있으면 고르라고 말한다", () => {
    render(<ResponseHarness initial={newResponseDraft("")} />);
    expect(screen.getByText("→ 어느 도구의 답인지 고르세요.")).toBeTruthy();
  });
});
