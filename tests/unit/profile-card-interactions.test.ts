import { beforeAll, describe, expect, it } from "vitest";

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
