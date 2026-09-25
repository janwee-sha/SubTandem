import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";

class Element {
  value = "";
  hidden = false;
  disabled = false;
  checked = false;
  required = false;
  textContent = "";
  innerHTML = "";
  tabIndex = 0;
  scrollTop = 0;
  dataset: Record<string, string> = {};
  style = { setProperty() {}, removeProperty() {} };
  classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  children: Element[] = [];
  parentElement: Element | null = null;
  readonly attributes = new Map<string, string>();
  readonly events = new Map<string, Array<(event: any) => void>>();
  readonly elements = new Map<string, Element>();
  constructor(readonly id = "") {}
  querySelector(selector: string): Element {
    if (!this.elements.has(selector)) this.elements.set(selector, new Element(selector));
    return this.elements.get(selector)!;
  }
  querySelectorAll(): Element[] {
    return [];
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  addEventListener(name: string, callback: (event: any) => void) {
    this.events.set(name, [...(this.events.get(name) ?? []), callback]);
  }
  dispatch(name: string) {
    for (const callback of this.events.get(name) ?? [])
      callback({ target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} });
  }
  append(...items: Element[]) {
    for (const item of items) {
      item.parentElement = this;
      this.children.push(item);
    }
  }
  appendChild(item: Element) {
    this.append(item);
    return item;
  }
  replaceChildren(...items: Element[]) {
    this.children = [];
    this.append(...items);
  }
  insertBefore(item: Element) {
    this.append(item);
  }
  remove() {
    this.parentElement = null;
  }
  focus() {}
  closest() {
    return null;
  }
  contains(item: Element) {
    return item === this || this.children.includes(item);
  }
  reportValidity() {
    return true;
  }
  checkValidity() {
    return true;
  }
  setCustomValidity() {}
}

export function sidebarHarness() {
  const document = new Element();
  const messages: Array<{ name: string; data: any }> = [];
  const listeners = new Map<string, (data: unknown) => void>();
  const timers = new Map<number, () => void>();
  const windowEvents = new Map<string, () => void>();
  let timerId = 0;
  const context = createContext({
    document: Object.assign(document, {
      createElement: (tag: string) => new Element(tag),
      documentElement: new Element(),
      activeElement: null,
    }),
    console,
    URL,
    Element,
    HTMLElement: Element,
    HTMLInputElement: Element,
    HTMLSelectElement: Element,
    setTimeout: (callback: () => void) => {
      timers.set(++timerId, callback);
      return timerId;
    },
    clearTimeout: (id: number) => timers.delete(id),
    setInterval: () => 1,
    clearInterval() {},
    addEventListener: (name: string, callback: () => void) => windowEvents.set(name, callback),
    getSelection: () => ({ isCollapsed: true }),
    iina: {
      postMessage: (name: string, data: unknown) => messages.push({ name, data }),
      onMessage: (name: string, callback: (data: unknown) => void) => listeners.set(name, callback),
    },
  });
  context.window = context;
  document.querySelector("#provider-kind").value = "openai";
  document.querySelector("#provider-proxy-mode").value = "system";
  for (const path of [
    "shared/provider-endpoint.ts",
    "ui/service-failure-message.ts",
    "ui/provider-status.ts",
    "ui/sidebar-state.ts",
    "ui/profile-card-interactions.ts",
    "ui/session-status.ts",
    "ui/sidebar.ts",
  ]) {
    const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
    runInContext(
      ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
      }).outputText,
      context,
    );
  }
  return {
    messages,
    element: (id: string) => document.querySelector(id),
    receive: (name: string, data: unknown) => listeners.get(name)?.(data),
    evaluate: (source: string) => runInContext(source, context),
    event: (name: string) => windowEvents.get(name)?.(),
    flush: () => {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}
