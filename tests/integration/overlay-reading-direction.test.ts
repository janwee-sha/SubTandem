import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { WebViewTranslationOverlay } from "../../src/adapters/iina/webview-translation-overlay.js";
import { FakeIinaEvent, FakeIinaOverlay } from "../helpers/fake-iina.js";

class TextElement {
  dir = "";
  hidden = true;
  style = {};
  children: Array<{ text?: string; tag?: string }> = [];
  replaceChildren() {
    this.children = [];
  }
  append(node: { text?: string; tag?: string }) {
    this.children.push(node);
  }
}

function loadOverlay() {
  const translation = new TextElement();
  const text = new TextElement();
  const listeners = new Map<string, (raw: unknown) => void>();
  const context = createContext({
    document: {
      querySelector: (selector: string) => (selector === "#translation" ? translation : text),
      documentElement: { clientHeight: 720 },
      createElement: (tag: string) => ({ tag }),
      createTextNode: (value: string) => ({ text: value }),
    },
    ResizeObserver: class {
      observe() {}
    },
    iina: {
      onMessage: (name: string, callback: (raw: unknown) => void) => listeners.set(name, callback),
      postMessage: () => undefined,
    },
    requestAnimationFrame: () => 1,
    addEventListener: () => undefined,
    setInterval: () => 1,
    clearInterval: () => undefined,
  });
  context.window = context;
  for (const path of ["ui/overlay-state.ts", "ui/overlay.ts"]) {
    const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
    runInContext(
      ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } })
        .outputText,
      context,
    );
  }
  const host = new FakeIinaOverlay();
  const event = new FakeIinaEvent();
  const overlay = new WebViewTranslationOverlay(host, event);
  event.trigger("iina.plugin-overlay-loaded");
  host.trigger("overlay:ready");
  const deliver = () => {
    const message = host.messages.at(-1)!;
    listeners.get(message.name)?.(message.data);
    return message;
  };
  return { translation, text, listeners, overlay, deliver };
}

describe("production Overlay DOM reading direction", () => {
  it("uses explicit RTL even with a Latin prefix and preserves punctuation, numbers and empty lines", () => {
    const { text, translation, overlay, deliver, listeners } = loadOverlay();
    const lines = ["Alice: مرحبا (123).", "", "שלום 456!", "  "];
    overlay.show(lines, "rtl");
    const render = deliver();
    expect(text.dir).toBe("rtl");
    expect(translation.hidden).toBe(false);
    expect(text.children).toEqual([
      { text: lines[0] },
      { tag: "br" },
      { text: "" },
      { tag: "br" },
      { text: lines[2] },
      { tag: "br" },
      { text: "  " },
    ]);
    const children = text.children;
    overlay.setPosition(75);
    deliver();
    expect(text.dir).toBe("rtl");
    expect(text.children).toBe(children);
    listeners.get("overlay:render")?.({ ...(render.data as object), direction: "ltr" });
    expect(text.dir).toBe("rtl");
    overlay.show(["Alice has (123) keys."], "ltr");
    deliver();
    expect(text.dir).toBe("ltr");
    expect(text.children).toEqual([{ text: "Alice has (123) keys." }]);
    overlay.clear();
    deliver();
    expect(text.children).toEqual([]);
    expect(translation.hidden).toBe(true);
  });
});
