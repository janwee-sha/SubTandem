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

describe("Profile Test button label", () => {
  it("preserves its label slot while switching between Test and Testing", () => {
    class Button {
      disabled = false;
      label = { textContent: "Test" };
      placeholder = { textContent: "Testing…", ariaHidden: "true" };
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
      idleLabelForAction: () => "Test",
      HTMLButtonElement: Button,
    });
    runtime.setActionBusy("test", undefined, true, "Testing…");
    expect(button.label.textContent).toBe("Testing…");
    expect(button.disabled).toBe(true);
    expect(button.attributes.get("aria-busy")).toBe("true");
    expect(button.children).toEqual(children);
    runtime.setActionBusy("test", undefined, false);
    expect(button.label.textContent).toBe("Test");
    expect(button.disabled).toBe(false);
    expect(button.attributes.has("aria-busy")).toBe(false);
    expect(button.children).toEqual(children);
  });
});
