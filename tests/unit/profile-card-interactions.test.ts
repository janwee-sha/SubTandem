import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

const sidebarSource = ts.createSourceFile(
  "sidebar.ts",
  readFileSync(new URL("../../ui/sidebar.ts", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
);

function loadSidebarFunctions(names: string[], globals: Record<string, unknown>) {
  const source = sidebarSource.statements
    .filter(
      (statement) =>
        ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text ?? ""),
    )
    .map((statement) => statement.getText(sidebarSource))
    .join("\n");
  const context = createContext(globals);
  runInContext(
    ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText,
    context,
  );
  return context;
}

beforeAll(async () => {
  await import("../../ui/profile-card-interactions.js");
  await import("../../ui/sidebar-state.js");
});

const createCoordinator = (threshold?: number) =>
  new globalThis.ProfileCardInteractionCoordinator(threshold);

const createDeleteCoordinator = () => new globalThis.ProfileDeleteDialogInteractionCoordinator();

describe("Profile card interaction coordinator", () => {
  it("activates a short primary pointer gesture outside control ancestors", () => {
    const coordinator = createCoordinator(5);
    expect(
      coordinator.beginPointer({
        profileId: "profile-a",
        clientX: 10,
        clientY: 20,
        scrollPosition: 0,
        controlAncestor: false,
        selectionCollapsed: true,
        detail: 1,
        primary: true,
      }),
    ).toBe(true);
    expect(
      coordinator.finishPointer({
        clientX: 13,
        clientY: 23,
        scrollPosition: 0,
        selectionCollapsed: true,
      }),
    ).toBe("profile-a");
  });

  it("excludes controls, drag selection, double-click selection and scrolling", () => {
    const coordinator = createCoordinator(5);
    const begin = (overrides: Record<string, unknown> = {}) =>
      coordinator.beginPointer({
        profileId: "profile-a",
        clientX: 10,
        clientY: 20,
        scrollPosition: 4,
        controlAncestor: false,
        selectionCollapsed: true,
        detail: 1,
        primary: true,
        ...overrides,
      });

    expect(begin({ controlAncestor: true })).toBe(false);
    expect(begin()).toBe(true);
    expect(
      coordinator.finishPointer({
        clientX: 20,
        clientY: 20,
        scrollPosition: 4,
        selectionCollapsed: true,
      }),
    ).toBeNull();
    expect(begin()).toBe(true);
    expect(
      coordinator.finishPointer({
        clientX: 10,
        clientY: 20,
        scrollPosition: 4,
        selectionCollapsed: false,
      }),
    ).toBeNull();
    expect(begin({ detail: 2 })).toBe(false);
    expect(begin()).toBe(true);
    expect(
      coordinator.finishPointer({
        clientX: 10,
        clientY: 20,
        scrollPosition: 5,
        selectionCollapsed: true,
      }),
    ).toBeNull();
  });

  it("supports Enter and Space while excluding nested controls and other keys", () => {
    const coordinator = createCoordinator();
    expect(coordinator.activateKey("profile-a", "Enter", false)).toBe("profile-a");
    expect(coordinator.activateKey("profile-a", " ", false)).toBe("profile-a");
    expect(coordinator.activateKey("profile-a", "Escape", false)).toBeNull();
    expect(coordinator.activateKey("profile-a", "Enter", true)).toBeNull();
  });
});

describe("Profile delete dialog interaction coordinator", () => {
  it("loops Tab and Shift+Tab inside the two confirmation actions", () => {
    const coordinator = createDeleteCoordinator();
    expect(coordinator.nextFocusIndex(1, 2, false)).toBe(0);
    expect(coordinator.nextFocusIndex(0, 2, true)).toBe(1);
    expect(coordinator.nextFocusIndex(0, 2, false)).toBe(1);
  });

  it("maps Escape to safe cancellation but does not cancel a submitted deletion", () => {
    const coordinator = createDeleteCoordinator();
    expect(coordinator.shouldCancel("Escape", false)).toBe(true);
    expect(coordinator.shouldCancel("Escape", true)).toBe(false);
    expect(coordinator.shouldCancel("Enter", false)).toBe(false);
  });

  it("restores focus to the next row, then previous row, then the create entry", () => {
    const coordinator = createDeleteCoordinator();
    expect(coordinator.focusAfterRemoval(0, ["profile-b"])).toEqual({
      kind: "profile-delete",
      profileId: "profile-b",
    });
    expect(coordinator.focusAfterRemoval(1, ["profile-a"])).toEqual({
      kind: "profile-delete",
      profileId: "profile-a",
    });
    expect(coordinator.focusAfterRemoval(0, [])).toEqual({ kind: "create-profile" });
  });
});

describe("Profile action button labels", () => {
  it.each([
    ["test", "Test", "Testing…"],
    ["delete", "Delete", "Deleting…"],
  ])(
    "preserves the %s label slot and maximum-width placeholder during busy transitions",
    (action, idle, busy) => {
      class Button {
        disabled = false;
        label = { textContent: idle };
        placeholder = { textContent: busy, ariaHidden: "true" };
        children = [this.label, this.placeholder];
        attributes = new Map<string, string>();
        querySelector(selector: string) {
          return selector === ".profile-action-label" ? this.label : null;
        }
        set textContent(value: string) {
          this.children = [{ textContent: value }];
        }
        setAttribute(name: string, value: string) {
          this.attributes.set(name, value);
        }
        removeAttribute(name: string) {
          this.attributes.delete(name);
        }
      }
      const button = new Button();
      const children = [...button.children];
      const runtime = loadSidebarFunctions(["setActionBusy"], {
        controlForAction: () => button,
        idleLabelForAction: () => idle,
        HTMLButtonElement: Button,
      });
      runtime.setActionBusy(action, "profile-a", true, busy);
      expect(button.label.textContent).toBe(busy);
      expect(button.disabled).toBe(true);
      expect(button.attributes.get("aria-busy")).toBe("true");
      expect(button.children).toEqual(children);
      runtime.setActionBusy(action, "profile-a", false);
      expect(button.label.textContent).toBe(idle);
      expect(button.disabled).toBe(false);
      expect(button.attributes.has("aria-busy")).toBe(false);
      expect(button.children[0]).toBe(children[0]);
      expect(button.children[1]).toBe(children[1]);
      expect(button.placeholder).toEqual({ textContent: busy, ariaHidden: "true" });
    },
  );
});

describe("Profile editor DOM synchronization", () => {
  function createEditor() {
    class Element extends EventTarget {
      dataset: Record<string, string> = {};
      attributes = new Map<string, string>();
      classes = new Set<string>();
      classList = {
        toggle: (name: string, enabled: boolean) => {
          if (enabled) this.classes.add(name);
          else this.classes.delete(name);
        },
      };
      value = "";
      checked = false;
      parent: Element | null = null;
      constructor(readonly kind: string) {
        super();
      }
      closest(selector: string): Element | null {
        if (selector === ".profile-details" && this.kind === "entry") return this;
        if (selector === ".profile" && this.kind === "article") return this;
        if (selector.includes("button,input") && ["switch", "test", "delete"].includes(this.kind))
          return this;
        return this.parent?.closest(selector) ?? null;
      }
      setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
      }
    }
    const rows = ["profile-a", "profile-b"].map((profileId) => {
      const article = new Element("article");
      const entry = new Element("entry");
      entry.dataset.profileId = profileId;
      entry.parent = article;
      const toggle = new Element("switch");
      toggle.checked = profileId === "profile-a";
      toggle.parent = article;
      return { article, entry, toggle };
    });
    const root = Object.assign(new Element("root"), {
      querySelectorAll: (selector: string) => {
        if (selector !== ".profile-details") throw new Error(`Unexpected DOM query: ${selector}`);
        return rows.map((row) => row.entry);
      },
    });
    const savedProfiles = rows.map(({ entry }, index) => ({
      profileId: entry.dataset.profileId!,
      revision: 1,
      displayName: `Profile ${index}`,
      kind: "ollama" as const,
      endpoint: "http://127.0.0.1:11434",
      model: "model-a",
      endpointFingerprint: `fingerprint-${index}`,
      proxyMode: "direct" as const,
      credentialConfigured: false,
    }));
    const state = globalThis.createSubTandemSidebarState(savedProfiles);
    const newProfileButton = new Element("new");
    const document = { activeElement: rows[0]!.entry, documentElement: { scrollTop: 74 } };
    const selection = { isCollapsed: true };
    const noop = () => undefined;
    const runtime = loadSidebarFunctions(["loadEditor", "resetEditor", "renderProfileEditing"], {
      sidebarState: state,
      profilesElement: root,
      profiles: new Map(savedProfiles.map((p) => [p.profileId, p])),
      profileCardInteractions: createCoordinator(),
      editingProfile: null,
      draftCredentialEpoch: 1,
      providerKey: new Element("key"),
      providerKind: new Element("kind"),
      profileName: new Element("name"),
      providerProxyMode: new Element("proxy"),
      saveProfileButton: new Element("save"),
      newProfileButton,
      providerDrafts: { ollama: {} },
      activeProviderKind: "ollama",
      selectedServiceTypeLabel: () => "Ollama",
      cancelPendingProfileSaveForContextChange: noop,
      invalidatePendingModelRefresh: noop,
      applyProviderKind: noop,
      setModelContext: noop,
      requestModels: noop,
      document,
      window: Object.assign(new EventTarget(), { getSelection: () => selection }),
    });
    const bindings = sidebarSource.statements
      .filter((statement) => {
        const text = statement.getText(sidebarSource);
        return (
          /^const (profileScrollPosition|selectionCollapsed) =/.test(text) ||
          /^(profilesElement\.addEventListener\("(?:pointerdown|pointerup|pointercancel|keydown)"|window\.addEventListener\("scroll"|newProfileButton\.addEventListener\("click")/.test(
            text,
          )
        );
      })
      .map((statement) => statement.getText(sidebarSource))
      .join("\n");
    runInContext(
      ts.transpileModule(bindings, { compilerOptions: { target: ts.ScriptTarget.ES2020 } })
        .outputText,
      runtime,
    );
    const dispatch = (type: string, target: Element, overrides: Record<string, unknown> = {}) => {
      const event = new Event(type, { cancelable: true });
      for (const [key, value] of Object.entries({
        target,
        clientX: 10,
        clientY: 20,
        button: 0,
        isPrimary: true,
        detail: 1,
        ...overrides,
      })) {
        Object.defineProperty(event, key, { value });
      }
      root.dispatchEvent(event);
    };
    const click = (target: Element) => {
      dispatch("pointerdown", target);
      dispatch("pointerup", target);
    };
    const selected = () =>
      rows
        .filter((row) => row.article.classes.has("is-editing"))
        .map((row) => row.entry.dataset.profileId);
    return {
      rows,
      state,
      runtime,
      root,
      document,
      selection,
      newProfileButton,
      dispatch,
      click,
      selected,
      Element,
    };
  }

  it("updates the first and subsequent selections before any model result or polling message", () => {
    const h = createEditor();
    const first = h.rows[0]!;
    const second = h.rows[1]!;
    h.click(first.entry);
    expect(h.selected()).toEqual(["profile-a"]);
    expect(first.entry.attributes.get("aria-pressed")).toBe("true");
    h.runtime.profileName.value = "Unsaved name";
    h.runtime.providerKey.value = "unsaved-key";
    h.click(first.entry);
    expect(h.runtime.profileName.value).toBe("Unsaved name");
    expect(h.runtime.providerKey.value).toBe("unsaved-key");
    h.click(second.entry);
    expect(h.selected()).toEqual(["profile-b"]);
    expect(first.entry.attributes.get("aria-pressed")).toBe("false");
    expect(h.runtime.profileName.value).toBe("Profile 1");
    expect(h.runtime.providerKey.value).toBe("");
    h.click(first.entry);
    expect(h.selected()).toEqual(["profile-a"]);
    expect(h.runtime.profileName.value).toBe("Profile 0");
    expect(h.document.activeElement).toBe(first.entry);
    expect(h.document.documentElement.scrollTop).toBe(74);
    expect(first.toggle.checked).toBe(true);
    expect(second.toggle.checked).toBe(false);
  });

  it("updates Enter, Space and New profile synchronously without moving the focus node", () => {
    const h = createEditor();
    h.dispatch("keydown", h.rows[0]!.entry, { key: "Enter" });
    expect(h.selected()).toEqual(["profile-a"]);
    h.document.activeElement = h.rows[1]!.entry;
    h.dispatch("keydown", h.rows[1]!.entry, { key: " " });
    expect(h.selected()).toEqual(["profile-b"]);
    expect(h.document.activeElement).toBe(h.rows[1]!.entry);
    h.newProfileButton.dispatchEvent(new Event("click"));
    expect(h.selected()).toEqual([]);
    expect(h.state.snapshot.editingProfileId).toBeNull();
    expect(h.rows.every((row) => row.entry.attributes.get("aria-pressed") === "false")).toBe(true);
  });

  it("does not change the editor for controls, selection, dragging or cancelled scrolling", () => {
    const h = createEditor();
    h.click(h.rows[0]!.entry);
    for (const kind of ["switch", "test", "delete"]) {
      const control = new h.Element(kind);
      control.parent = h.rows[1]!.article;
      h.click(control);
      h.dispatch("keydown", control, { key: "Enter" });
    }
    h.dispatch("pointerdown", h.rows[1]!.entry);
    h.selection.isCollapsed = false;
    h.dispatch("pointerup", h.rows[1]!.entry);
    h.selection.isCollapsed = true;
    h.dispatch("pointerdown", h.rows[1]!.entry);
    h.dispatch("pointerup", h.rows[1]!.entry, { clientX: 30 });
    h.dispatch("pointerdown", h.rows[1]!.entry);
    h.runtime.window.dispatchEvent(new Event("scroll"));
    h.dispatch("pointerup", h.rows[1]!.entry);
    expect(h.selected()).toEqual(["profile-a"]);
    expect(h.state.snapshot.editingProfileId).toBe("profile-a");
  });

  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    "keeps editing=%s independent from enabled=%s when painting an existing row",
    (editing, enabled) => {
      const h = createEditor();
      const row = h.rows[0]!;
      row.toggle.checked = enabled;
      h.state.setProfileContext({ editingProfileId: editing ? "profile-a" : null });
      h.runtime.renderProfileEditing();
      expect(row.article.classes.has("is-editing")).toBe(editing);
      expect(row.entry.attributes.get("aria-pressed")).toBe(String(editing));
      expect(row.toggle.checked).toBe(enabled);
      expect(h.document.activeElement).toBe(row.entry);
    },
  );
});
