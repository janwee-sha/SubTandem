import { CredentialEditor } from "../../ui/credential-editor.js";
import { CredentialPeer } from "./credential-peer.js";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";

class Element {
  value = "";
  placeholder = "";
  hidden = false;
  disabled = false;
  checked = false;
  required = false;
  textContent = "";
  innerHTML = "";
  tabIndex = 0;
  type = "password";
  selectionStart = 0;
  selectionEnd = 0;
  selectionDirection = "none";
  scrollLeft = 0;
  setSelectionRange(start: number, end: number, direction = "none") {
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionDirection = direction;
  }
  scrollTop = 0;
  clientWidth = 0;
  scrollWidth = 0;
  className = "";
  id = "";
  dataset: Record<string, string> = {};
  style = { setProperty() {}, removeProperty() {} };
  classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  children: Element[] = [];
  parentElement: Element | null = null;
  readonly attributes = new Map<string, string>();
  readonly events = new Map<string, Array<(event: any) => void>>();
  readonly elements = new Map<string, Element>();
  constructor(
    id = "",
    private readonly focusElement: (element: Element) => void = () => {},
  ) {
    this.id = id;
  }
  querySelector(selector: string): Element {
    if (selector.startsWith(":scope > ."))
      return (
        this.children.find((child) => child.className.split(" ").includes(selector.slice(11))) ??
        (null as any)
      );
    if (!this.elements.has(selector)) {
      const element = new Element(selector, this.focusElement);
      element.parentElement = this;
      this.elements.set(selector, element);
    }
    return this.elements.get(selector)!;
  }
  querySelectorAll(selector: string): Element[] {
    const descendants: Element[] = [];
    const visit = (element: Element) => {
      for (const child of [...element.elements.values(), ...element.children]) {
        if (descendants.includes(child)) continue;
        descendants.push(child);
        visit(child);
      }
    };
    visit(this);
    const matches = descendants.filter((element) =>
      selector === 'input[data-action="activation"]'
        ? element.dataset.action === "activation"
        : selector.startsWith("#")
          ? element.id === selector.slice(1)
          : selector.startsWith(".")
            ? element.className.split(" ").includes(selector.slice(1))
            : false,
    );
    return [...new Set(matches)];
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
  dispatch(name: string, target: Element = this, extra: Record<string, unknown> = {}) {
    for (const callback of this.events.get(name) ?? [])
      callback({
        target,
        currentTarget: this,
        preventDefault() {},
        stopPropagation() {},
        ...extra,
      });
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
  scrollIntoView() {}
  replaceChildren(...items: Element[]) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.append(...items);
  }
  insertBefore(item: Element) {
    this.append(item);
  }
  remove() {
    if (this.parentElement)
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
    this.dispatch("remove");
  }
  after(item: Element) {
    this.parentElement?.append(item);
  }
  focus() {
    this.focusElement(this);
    this.dispatch("focus");
  }
  closest(selector: string): Element | null {
    if (selector === 'input[data-action="activation"]' && this.dataset.action === "activation")
      return this;
    if (selector === ".profile-details" && this.className.split(" ").includes("profile-details"))
      return this;
    return this.parentElement?.closest(selector) ?? null;
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

export function sidebarHarness(
  options: {
    postMessage?(name: string, data: unknown): void;
    timers?: Pick<
      typeof globalThis,
      "setTimeout" | "clearTimeout" | "setInterval" | "clearInterval"
    >;
  } = {},
) {
  let activeElement: Element | null = null;
  const document = new Element("", (element) => {
    activeElement = element;
  });
  const messages: Array<{ name: string; data: any }> = [];
  const listeners = new Map<string, (data: unknown) => void>();
  const timers = new Map<number, () => void>();
  const intervals = new Map<number, () => void>();
  const windowEvents = new Map<string, () => void>();
  let timerId = 0;
  let credentialPeer: CredentialPeer | null = null;
  let credentialOwner: any;
  let credentialReadValue = "";
  let deferCredentialRead = false;
  let failCredentialRead = false;
  const deferredCredentialPhases = new Set<string>();
  const credentialPhaseReplies = new Map<string, Array<() => void>>();
  const credentialTimeline: Array<{
    name: string;
    at: number;
    key: string;
    masked: boolean;
    disabled: boolean;
  }> = [];
  const replyCredentialPhase = (phase: string, reply: () => void) => {
    if (deferredCredentialPhases.has(phase)) {
      credentialPhaseReplies.set(phase, [...(credentialPhaseReplies.get(phase) ?? []), reply]);
    } else reply();
  };
  const credentialReads: Array<() => void> = [];
  const resizeObservers: Array<{
    callback: () => void;
    targets: Set<Element>;
  }> = [];
  const context = createContext({
    document: Object.assign(document, {
      createElement: (tag: string) =>
        new Element(tag, (element) => {
          activeElement = element;
        }),
      documentElement: new Element(),
      get activeElement() {
        return activeElement;
      },
    }),
    console,
    Date,
    URL,
    Element,
    HTMLElement: Element,
    HTMLInputElement: Element,
    HTMLButtonElement: Element,
    HTMLSelectElement: Element,
    ResizeObserver: class {
      private readonly record = { callback: () => {}, targets: new Set<Element>() };
      constructor(callback: () => void) {
        this.record.callback = callback;
        resizeObservers.push(this.record);
      }
      observe(element: Element) {
        this.record.targets.add(element);
      }
      unobserve(element: Element) {
        this.record.targets.delete(element);
      }
      disconnect() {
        this.record.targets.clear();
      }
    },
    setTimeout:
      options.timers?.setTimeout ??
      ((callback: () => void) => {
        timers.set(++timerId, callback);
        return timerId;
      }),
    clearTimeout: options.timers?.clearTimeout ?? ((id: number) => timers.delete(id)),
    setInterval:
      options.timers?.setInterval ??
      ((callback: () => void) => {
        intervals.set(++timerId, callback);
        return timerId;
      }),
    clearInterval: options.timers?.clearInterval ?? ((id: number) => intervals.delete(id)),
    addEventListener: (name: string, callback: () => void) => windowEvents.set(name, callback),
    getSelection: () => ({ isCollapsed: true }),
    iina: {
      postMessage: (name: string, data: any) => {
        messages.push({ name, data });
        credentialTimeline.push({
          name,
          at: Date.now(),
          key: document.querySelector("#provider-key").value,
          masked: document.querySelector("#provider-key").type === "password",
          disabled: document.querySelector("#save-profile").disabled,
        });
        options.postMessage?.(name, data);
        if (!credentialPeer || !name.startsWith("credential-channel:")) return;
        const action = name.split(":")[1]!;
        if (action === "open") credentialOwner = { ...data.payload, senderId: "test-window" };
        const owner = {
          senderId: "test-window",
          sidebarInstanceId: credentialOwner?.sidebarInstanceId,
          drawerId: credentialOwner?.drawerId,
        };
        if (action === "operation") {
          const response = failCredentialRead
            ? null
            : credentialPeer!.respond(owner, data.payload, credentialReadValue);
          const reply = () =>
            replyCredentialPhase("read", () => {
              if (failCredentialRead)
                listeners.get("credential-channel:result")?.({
                  requestId: data.requestId,
                  ok: false,
                });
              else
                listeners.get("credential-channel:result")?.({
                  requestId: data.requestId,
                  ok: true,
                  sidebarInstanceId: owner.sidebarInstanceId,
                  drawerId: owner.drawerId,
                  payload: response,
                });
            });
          if (deferCredentialRead) credentialReads.push(reply);
          else reply();
          return;
        }
        void credentialPeer
          .call(action, action === "open" ? credentialOwner : { owner, frame: data.payload })
          .then(
            (payload) =>
              replyCredentialPhase(action, () =>
                listeners.get("credential-channel:result")?.({
                  requestId: data.requestId,
                  ok: true,
                  sidebarInstanceId: owner.sidebarInstanceId,
                  drawerId: owner.drawerId,
                  payload,
                }),
              ),
            () =>
              listeners.get("credential-channel:result")?.({
                requestId: data.requestId,
                ok: false,
              }),
          );
      },
      onMessage: (name: string, callback: (data: unknown) => void) => listeners.set(name, callback),
    },
  });
  Object.defineProperty(document, "activeElement", {
    get: () => activeElement,
    configurable: true,
  });
  context.window = context;
  context.subtandemCredentialEditor = {
    create: (port: ConstructorParameters<typeof CredentialEditor>[0]) =>
      new CredentialEditor(port, context as any),
  };
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
    credentialTimeline,
    connectCredentials(
      options: {
        readValue?: string;
        deferRead?: boolean;
        failRead?: boolean;
        deferPhases?: Array<"open" | "confirm" | "read">;
      } = {},
    ) {
      credentialReadValue = options.readValue ?? "";
      deferCredentialRead = options.deferRead ?? false;
      failCredentialRead = options.failRead ?? false;
      deferredCredentialPhases.clear();
      options.deferPhases?.forEach((phase) => deferredCredentialPhases.add(phase));
      credentialPeer = new CredentialPeer();
      return {
        open: (message: any) =>
          credentialPeer!.open(
            {
              senderId: "test-window",
              sidebarInstanceId: message.payload.sidebarInstanceId,
              drawerId: message.payload.drawerId,
            },
            message.payload.frame,
          ),
      };
    },
    releaseCredentialReads() {
      credentialReads.splice(0).forEach((reply) => reply());
    },
    releaseCredentialPhase(phase: "open" | "confirm" | "read") {
      deferredCredentialPhases.delete(phase);
      const replies = credentialPhaseReplies.get(phase) ?? [];
      credentialPhaseReplies.delete(phase);
      replies.forEach((reply) => reply());
    },
    activate(id: string, input: "mouse" | "Enter" | "Space" = "mouse") {
      const element = document.querySelector(id);
      if (element.disabled) return;
      if (input !== "mouse")
        element.dispatch("keydown", element, { key: input === "Space" ? " " : input });
      element.dispatch("click");
    },
    async settleCredentials() {
      for (let n = 0; n < 20; n++) await Promise.resolve();
    },
    element: (id: string) => document.querySelector(id),
    receive: (name: string, data: unknown) => listeners.get(name)?.(data),
    evaluate: (source: string) => runInContext(source, context),
    event: (name: string) => windowEvents.get(name)?.(),
    pulse: () => [...intervals.values()].forEach((callback) => callback()),
    resize: (element: Element, clientWidth: number, scrollWidth: number) => {
      element.clientWidth = clientWidth;
      element.scrollWidth = scrollWidth;
      for (const observer of resizeObservers)
        if (observer.targets.has(element)) observer.callback();
    },
    flush: () => {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}
