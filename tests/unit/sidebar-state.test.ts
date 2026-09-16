import { beforeAll, describe, expect, it } from "vitest";

beforeAll(async () => {
  await import("../../ui/sidebar-state.js");
});

function createState() {
  return globalThis.createSubTandemSidebarState([
    { profileId: "deleted", revision: 2 },
    { profileId: "retained", revision: 1 },
  ]);
}

describe("Sidebar Profile delete confirmation", () => {
  it("freezes the exact visible target and ignores duplicate confirmation", () => {
    const state = createState();

    expect(
      state.openDeleteConfirmation({
        profileId: "deleted",
        expectedRevision: 2,
        displayName: "Delete me",
      }),
    ).toBe(true);
    expect(state.snapshot.deleteConfirmation).toEqual({
      profileId: "deleted",
      expectedRevision: 2,
      displayName: "Delete me",
      phase: "confirming",
      requestId: null,
    });
    expect(
      state.openDeleteConfirmation({
        profileId: "retained",
        expectedRevision: 1,
        displayName: "Retained",
      }),
    ).toBe(false);
    expect(state.beginProfileDelete("delete-request")).toEqual({
      profileId: "deleted",
      expectedRevision: 2,
      displayName: "Delete me",
    });
    expect(state.beginProfileDelete("duplicate-request")).toBeNull();
  });

  it("cancels without changing Profile, editing or Test state", () => {
    const state = createState();
    state.setProfileContext({ editingProfileId: "deleted" });
    state.setProfileTest("deleted", { revision: 2, state: "passed" });
    state.openDeleteConfirmation({
      profileId: "deleted",
      expectedRevision: 2,
      displayName: "Delete me",
    });

    expect(state.cancelDeleteConfirmation()).toMatchObject({ profileId: "deleted" });
    expect(state.snapshot.deleteConfirmation).toBeNull();
    expect(state.snapshot.profiles.map((profile) => profile.profileId)).toEqual([
      "deleted",
      "retained",
    ]);
    expect(state.snapshot.editingProfileId).toBe("deleted");
    expect(state.snapshot.profileTests.deleted).toEqual({ revision: 2, state: "passed" });
  });

  it("invalidates a frozen target instead of silently adopting a newer revision", () => {
    const state = createState();
    state.openDeleteConfirmation({
      profileId: "deleted",
      expectedRevision: 2,
      displayName: "Delete me",
    });

    state.applyProfiles([
      { profileId: "deleted", revision: 3 },
      { profileId: "retained", revision: 1 },
    ]);

    expect(state.snapshot.deleteConfirmation).toBeNull();
    expect(state.beginProfileDelete("stale-request")).toBeNull();
  });

  it("closes a failed submission while retaining every business state", () => {
    const state = createState();
    state.setProfileContext({ editingProfileId: "deleted" });
    state.setProfileTest("deleted", { revision: 2, state: "passed" });
    state.openDeleteConfirmation({
      profileId: "deleted",
      expectedRevision: 2,
      displayName: "Delete me",
    });
    state.beginProfileDelete("delete-request");

    expect(state.finishProfileDeleteFailure("delete-request")).toBe(true);
    expect(state.snapshot.deleteConfirmation).toBeNull();
    expect(state.snapshot.profiles.map((profile) => profile.profileId)).toContain("deleted");
    expect(state.snapshot.editingProfileId).toBe("deleted");
    expect(state.snapshot.profileTests.deleted).toEqual({ revision: 2, state: "passed" });
  });
});

describe("Sidebar authoritative profile deletion", () => {
  it("filters immediately, records a tombstone and clears every matching transient state", () => {
    const state = createState();
    state.setProfileContext({
      editingProfileId: "deleted",
      selectedProfileId: "deleted",
      credentialDisplayProfileId: "deleted",
    });
    state.setProfileTest("deleted", { revision: 2, state: "passed" });
    state.beginOperation({
      requestId: "delete-request",
      regionId: "profile-row:deleted",
      actionId: "delete",
      profileId: "deleted",
    });

    const result = state.deleteSucceeded({
      requestId: "delete-request",
      profileId: "deleted",
      message: "Profile and saved credential deleted.",
    });

    expect(result.announced).toBe(true);
    expect(state.snapshot.profiles.map((profile) => profile.profileId)).toEqual(["retained"]);
    expect(state.snapshot.deletedProfileIds).toEqual(["deleted"]);
    expect(state.snapshot.editingProfileId).toBeNull();
    expect(state.snapshot.selectedProfileId).toBeNull();
    expect(state.snapshot.credentialDisplayProfileId).toBeNull();
    expect(state.snapshot.profileTests.deleted).toBeUndefined();
    expect(state.snapshot.requests["delete-request"]).toBeUndefined();
    expect(state.snapshot.activeFeedback).toMatchObject({
      requestId: "delete-request",
      phase: "success",
      visibility: "assistive",
    });
  });

  it("filters late snapshots and treats repeated success as idempotent", () => {
    const state = createState();
    state.beginOperation({
      requestId: "delete-request",
      regionId: "profile-row:deleted",
      actionId: "delete",
      profileId: "deleted",
    });
    state.deleteSucceeded({ requestId: "delete-request", profileId: "deleted", message: "Done" });
    state.applyProfiles([
      { profileId: "deleted", revision: 2 },
      { profileId: "retained", revision: 2 },
    ]);
    state.deleteSucceeded({ requestId: "delete-request", profileId: "deleted", message: "Done" });

    expect(state.snapshot.profiles).toEqual([{ profileId: "retained", revision: 2 }]);
    expect(state.snapshot.deletedProfileIds).toEqual(["deleted"]);
    expect(state.snapshot).not.toHaveProperty("deletedResults");
  });

  it("does not create a success slot for another window without a local request", () => {
    const state = createState();
    const result = state.deleteSucceeded({
      requestId: "other-window-request",
      profileId: "deleted",
      message: "Done",
    });

    expect(result.announced).toBe(false);
    expect(state.snapshot.profiles.map((profile) => profile.profileId)).toEqual(["retained"]);
    expect(state.snapshot.activeFeedback).toBeNull();
  });

  it.each(["cancelled", "error"] as const)("retains business state after %s", (phase) => {
    const state = createState();
    state.setProfileContext({ editingProfileId: "deleted", selectedProfileId: "deleted" });
    state.beginOperation({
      requestId: "delete-request",
      regionId: "profile-row:deleted",
      actionId: "delete",
      profileId: "deleted",
    });
    state.finishOperation("delete-request", phase, "Not deleted");

    expect(state.snapshot.profiles.map((profile) => profile.profileId)).toEqual([
      "deleted",
      "retained",
    ]);
    expect(state.snapshot.editingProfileId).toBe("deleted");
    expect(state.snapshot.selectedProfileId).toBe("deleted");
    expect(state.snapshot.activeFeedback).toMatchObject({
      phase,
      visibility: phase === "error" ? "visible" : "assistive",
    });
  });
});

describe("Sidebar operation feedback ownership", () => {
  it("keeps regional request ownership while exposing only the latest global message", () => {
    const state = createState();
    const regions = [
      "translation-toggle",
      "language-settings",
      "profile-editor",
      "profile-row:retained",
      "subtitle-retry",
    ];
    for (const regionId of regions) {
      state.beginOperation(
        { requestId: `request-${regionId}`, regionId, actionId: regionId },
        "Busy",
      );
      expect(state.snapshot.activeFeedback).toMatchObject({
        requestId: `request-${regionId}`,
        regionId,
        phase: "busy",
        message: "Busy",
        visibility: "assistive",
      });
    }
    expect(Object.keys(state.snapshot.latestRequestByRegion)).toHaveLength(5);
    expect(state.snapshot.activeFeedback?.regionId).toBe("subtitle-retry");

    state.beginOperation(
      {
        requestId: "new-editor-request",
        regionId: "profile-editor",
        actionId: "save-profile",
      },
      "Saving",
    );
    expect(state.finishOperation("request-profile-editor", "success", "Old").accepted).toBe(false);
    expect(state.snapshot.latestRequestByRegion["profile-editor"]).toMatchObject({
      requestId: "new-editor-request",
      actionId: "save-profile",
    });
    expect(state.snapshot.activeFeedback).toMatchObject({
      requestId: "new-editor-request",
      phase: "busy",
      message: "Saving",
    });
    expect(state.finishOperation("new-editor-request", "success", "Saved").accepted).toBe(true);
    expect(state.snapshot.activeFeedback).toMatchObject({
      regionId: "profile-editor",
      phase: "success",
      message: "Saved",
      visibility: "assistive",
    });
  });

  it("lets an accepted terminal result replace busy and ignores unknown or duplicate results", () => {
    const state = createState();
    state.beginOperation(
      {
        requestId: "test-request",
        regionId: "profile-row:retained",
        actionId: "test",
        profileId: "retained",
        revision: 1,
      },
      "Testing",
    );

    expect(state.snapshot.requests["test-request"]).toMatchObject({
      actionId: "test",
      profileId: "retained",
    });
    expect(state.finishOperation("unknown", "error", "Unknown").accepted).toBe(false);
    expect(state.finishOperation("test-request", "success", "Passed").accepted).toBe(true);
    expect(state.finishOperation("test-request", "error", "Duplicate").accepted).toBe(false);
    expect(state.snapshot.activeFeedback).toMatchObject({
      actionId: "test",
      phase: "success",
      message: "Passed",
      visibility: "assistive",
    });
  });

  it("keeps the latest message and business state until another accepted message replaces it", () => {
    const state = createState();
    state.setProfileContext({
      editingProfileId: "retained",
      selectedProfileId: "retained",
      credentialDisplayProfileId: "retained",
    });
    state.setProfileTest("retained", { revision: 1, state: "passed" });
    state.beginProfileSave("profile-save", true);
    state.beginOperation(
      {
        requestId: "language-request",
        regionId: "language-settings",
        actionId: "languages",
      },
      "Saving languages…",
    );

    expect(state.snapshot.activeFeedback).toMatchObject({
      requestId: "language-request",
      message: "Saving languages…",
    });
    expect(state.snapshot.requests["language-request"]).toBeDefined();
    expect(state.snapshot.latestRequestByRegion["language-settings"]).toEqual({
      requestId: "language-request",
      actionId: "languages",
    });
    expect(state.snapshot.editingProfileId).toBe("retained");
    expect(state.snapshot.selectedProfileId).toBe("retained");
    expect(state.snapshot.credentialDisplayProfileId).toBe("retained");
    expect(state.snapshot.profileTests.retained).toEqual({ revision: 1, state: "passed" });
    expect(state.snapshot.pendingProfileSave?.requestId).toBe("profile-save");
    expect(state.snapshot.deletedProfileIds).toEqual([]);
  });

  it("lets a later accepted result from another pending region become the global message", () => {
    const state = createState();
    state.beginOperation(
      { requestId: "translation", regionId: "translation-toggle", actionId: "translation" },
      "Enabling…",
    );
    state.beginOperation(
      { requestId: "languages", regionId: "language-settings", actionId: "languages" },
      "Saving…",
    );

    expect(state.finishOperation("translation", "success", "Enabled.").accepted).toBe(true);
    expect(state.snapshot.activeFeedback).toMatchObject({
      requestId: "translation",
      regionId: "translation-toggle",
      message: "Enabled.",
    });
    expect(state.snapshot.requests.languages).toBeDefined();
  });

  it("announces deletion success without creating a visible result slot", () => {
    const state = createState();
    state.beginOperation(
      {
        requestId: "delete-request",
        regionId: "profile-row:deleted",
        actionId: "delete",
        profileId: "deleted",
      },
      "Deleting…",
    );
    state.deleteSucceeded({
      requestId: "delete-request",
      profileId: "deleted",
      message: "Deleted.",
    });

    expect(state.snapshot.activeFeedback).toMatchObject({
      message: "Deleted.",
      visibility: "assistive",
    });
    expect(state.snapshot).not.toHaveProperty("deletedResults");

    state.beginOperation(
      { requestId: "retry", regionId: "subtitle-retry", actionId: "retry-preparation" },
      "Retrying…",
    );
    expect(state.snapshot.activeFeedback).toMatchObject({
      requestId: "retry",
      regionId: "subtitle-retry",
      visibility: "assistive",
    });
    expect(state.snapshot.deletedProfileIds).toContain("deleted");
  });

  it("keeps different Profile rows independently eligible to publish accepted results", () => {
    const state = createState();
    state.beginOperation(
      {
        requestId: "deleted-row-test",
        regionId: "profile-row:deleted",
        actionId: "test",
        profileId: "deleted",
      },
      "Testing deleted…",
    );
    state.beginOperation(
      {
        requestId: "retained-row-test",
        regionId: "profile-row:retained",
        actionId: "test",
        profileId: "retained",
      },
      "Testing retained…",
    );

    expect(state.finishOperation("deleted-row-test", "success", "First row passed.").accepted).toBe(
      true,
    );
    expect(state.snapshot.activeFeedback?.regionId).toBe("profile-row:deleted");
    expect(state.finishOperation("retained-row-test", "error", "Second row failed.").accepted).toBe(
      true,
    );
    expect(state.snapshot.activeFeedback).toMatchObject({
      regionId: "profile-row:retained",
      phase: "error",
      message: "Second row failed.",
      visibility: "visible",
    });
  });
});

const defaultSubtitleStyle = {
  fontColor: { r: 255, g: 255, b: 255, a: 255 },
  fontSize: 40,
  fontFamily: null,
  bold: false,
  italic: false,
  borderColor: { r: 0, g: 0, b: 0, a: 255 },
  borderWidth: 3,
  backgroundColor: { r: 0, g: 0, b: 0, a: 0 },
};

const subtitleAuthority = (overrides: Record<string, unknown> = {}) => ({
  phase: "snapshot",
  liveStyle: defaultSubtitleStyle,
  committedStyle: defaultSubtitleStyle,
  changedField: null,
  stateRevision: 1,
  latestIntentSequence: 0,
  committedRevision: 0,
  fontResolution: {
    preferredFamily: null,
    availability: "available",
    effectiveFamily: null,
    fallbackActive: false,
    catalogRevision: 0,
  },
  ...overrides,
});

describe("Sidebar Font style state", () => {
  it("tracks Font display, committed and pending state per field", () => {
    const state = createState();
    expect(state.applySubtitleStyleState(subtitleAuthority())).toBe(true);
    expect(state.previewSubtitleStyle("font-size-1", "fontSize", 50)).toBe(true);
    expect(state.beginSubtitleStyleSave("save-size-1", "font-size-1", "fontSize")).toBe(true);
    expect(state.previewSubtitleStyle("bold-1", "bold", true)).toBe(true);
    expect(state.beginSubtitleStyleSave("save-bold-1", "bold-1", "bold")).toBe(true);
    expect(state.snapshot.subtitleStyle.displayStyle).toMatchObject({ fontSize: 50, bold: true });
    expect(state.snapshot.subtitleStyle.committedStyle).toEqual(defaultSubtitleStyle);
    expect(state.snapshot.subtitleStyle.pendingByField.fontSize).toMatchObject({
      requestId: "save-size-1",
      interactionId: "font-size-1",
    });
    expect(state.snapshot.subtitleStyle.pendingByField.bold).toMatchObject({
      requestId: "save-bold-1",
      interactionId: "bold-1",
    });
    expect(state.snapshot.subtitleStyle.feedbackByField).toMatchObject({
      fontSize: "saving",
      bold: "saving",
    });
  });

  it("applies latest authority state and exposes requested-family fallback", () => {
    const state = createState();
    state.applySubtitleStyleState(subtitleAuthority());
    const fallbackStyle = { ...defaultSubtitleStyle, fontFamily: "Example Family" };
    expect(
      state.applySubtitleStyleState(
        subtitleAuthority({
          phase: "availability",
          liveStyle: fallbackStyle,
          committedStyle: fallbackStyle,
          stateRevision: 2,
          fontResolution: {
            preferredFamily: "Example Family",
            availability: "unavailable",
            effectiveFamily: null,
            fallbackActive: true,
            catalogRevision: 2,
          },
        }),
      ),
    ).toBe(true);
    expect(state.snapshot.subtitleStyle.fontResolution).toMatchObject({
      preferredFamily: "Example Family",
      effectiveFamily: null,
      fallbackActive: true,
    });
    expect(state.applySubtitleStyleState(subtitleAuthority())).toBe(false);
  });

  it("restores all eight fields and clears all pending state on save failure", () => {
    const state = createState();
    state.applySubtitleStyleState(subtitleAuthority());
    state.previewSubtitleStyle("size-1", "fontSize", 60);
    state.beginSubtitleStyleSave("save-size-1", "size-1", "fontSize");
    state.previewSubtitleStyle("italic-1", "italic", true);
    const reverted = subtitleAuthority({
      phase: "reverted",
      stateRevision: 4,
      latestIntentSequence: 2,
    });
    expect(
      state.finishSubtitleStyleSave({
        requestId: "save-size-1",
        field: "fontSize",
        ok: false,
        code: "SUBTITLE_STYLE_SAVE_FAILED",
        userAction: "EDIT_AGAIN",
        intentSequence: 1,
        authority: reverted,
      }),
    ).toBe(true);
    expect(state.snapshot.subtitleStyle.displayStyle).toEqual(defaultSubtitleStyle);
    expect(
      Object.values(state.snapshot.subtitleStyle.pendingByField).every((value) => !value),
    ).toBe(true);
    expect(state.snapshot.subtitleStyle.groupError).toBe(
      "Subtitle style could not be saved. The previous style remains active.",
    );
  });
});

describe("Sidebar Border and Background style state", () => {
  it("tracks all three fields with independent parallel pending state", () => {
    const state = createState();
    state.applySubtitleStyleState(subtitleAuthority());
    expect(
      state.previewSubtitleStyle("border-color-1", "borderColor", { r: 1, g: 2, b: 3, a: 4 }),
    ).toBe(true);
    expect(state.beginSubtitleStyleSave("save-border-color", "border-color-1", "borderColor")).toBe(
      true,
    );
    expect(
      state.previewSubtitleStyle("background-1", "backgroundColor", { r: 5, g: 6, b: 7, a: 8 }),
    ).toBe(true);
    expect(state.beginSubtitleStyleSave("save-background", "background-1", "backgroundColor")).toBe(
      true,
    );
    expect(state.previewSubtitleStyle("width-1", "borderWidth", 4)).toBe(true);
    expect(state.beginSubtitleStyleSave("save-width", "width-1", "borderWidth")).toBe(true);
    expect(state.snapshot.subtitleStyle.displayStyle).toMatchObject({
      borderColor: { r: 1, g: 2, b: 3, a: 4 },
      backgroundColor: { r: 5, g: 6, b: 7, a: 8 },
      borderWidth: 4,
    });
    expect(state.snapshot.subtitleStyle.pendingByField.borderColor?.requestId).toBe(
      "save-border-color",
    );
    expect(state.snapshot.subtitleStyle.pendingByField.backgroundColor?.requestId).toBe(
      "save-background",
    );
    expect(state.snapshot.subtitleStyle.pendingByField.borderWidth?.requestId).toBe("save-width");
  });

  it("accepts only the finite Width choices and restores the group on failure", () => {
    const state = createState();
    state.applySubtitleStyleState(subtitleAuthority());
    for (const width of [0, 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5]) {
      expect(state.previewSubtitleStyle(`width-${width}`, "borderWidth", width)).toBe(true);
    }
    expect(state.previewSubtitleStyle("width-invalid", "borderWidth", 0.75)).toBe(false);
    state.previewSubtitleStyle("background-fail", "backgroundColor", { r: 1, g: 1, b: 1, a: 128 });
    state.beginSubtitleStyleSave("background-fail-save", "background-fail", "backgroundColor");
    expect(
      state.finishSubtitleStyleSave({
        requestId: "background-fail-save",
        field: "backgroundColor",
        ok: false,
        code: "SUBTITLE_STYLE_SAVE_FAILED",
        userAction: "EDIT_AGAIN",
        intentSequence: 11,
        authority: subtitleAuthority({ phase: "reverted", stateRevision: 12 }),
      }),
    ).toBe(true);
    expect(state.snapshot.subtitleStyle.displayStyle).toEqual(defaultSubtitleStyle);
  });

  it("keeps one explicit color target and clears it without changing style", () => {
    const state = createState();
    state.applySubtitleStyleState(subtitleAuthority());
    expect(state.openSubtitleColorPalette("borderColor")).toBe(true);
    expect(state.snapshot.subtitleStyle.colorTarget).toBe("borderColor");
    expect(state.openSubtitleColorPalette("backgroundColor")).toBe(true);
    expect(state.snapshot.subtitleStyle.colorTarget).toBe("backgroundColor");
    expect(state.openSubtitleColorPalette("fontSize" as "fontColor")).toBe(false);
    state.closeSubtitleColorPalette();
    expect(state.snapshot.subtitleStyle.colorTarget).toBeNull();
    expect(state.snapshot.subtitleStyle.displayStyle).toEqual(defaultSubtitleStyle);
  });
});

describe("Sidebar native color picker state", () => {
  it("owns one target session while accepting continuous remote authority", () => {
    const state = createState();
    state.applySubtitleStyleState(subtitleAuthority());
    expect(state.beginSubtitleColorPicker("picker-1", "fontColor")).toBe(true);
    expect(state.beginSubtitleColorPicker("picker-2", "borderColor")).toBe(false);
    expect(state.snapshot.subtitleStyle.nativeColorSession).toEqual({
      requestId: "picker-1",
      field: "fontColor",
    });
    expect(
      state.applySubtitleStyleState(
        subtitleAuthority({
          phase: "preview",
          stateRevision: 2,
          latestIntentSequence: 1,
          changedField: "fontColor",
          liveStyle: {
            ...defaultSubtitleStyle,
            fontColor: { r: 10, g: 20, b: 30, a: 40 },
          },
        }),
      ),
    ).toBe(true);
    expect(state.snapshot.subtitleStyle.displayStyle.fontColor).toEqual({
      r: 10,
      g: 20,
      b: 30,
      a: 40,
    });
  });

  it("settles only the current picker and reports safe group failure", () => {
    const state = createState();
    state.applySubtitleStyleState(subtitleAuthority());
    state.beginSubtitleColorPicker("picker-current", "backgroundColor");
    expect(state.finishSubtitleColorPicker("picker-old", "confirmed", subtitleAuthority())).toBe(
      false,
    );
    expect(
      state.finishSubtitleColorPicker(
        "picker-current",
        "failed",
        subtitleAuthority({ phase: "reverted", stateRevision: 2 }),
      ),
    ).toBe(true);
    expect(state.snapshot.subtitleStyle.nativeColorSession).toBeNull();
    expect(state.snapshot.subtitleStyle.groupError).toBe(
      "The system color picker is unavailable. The previous style remains active.",
    );
  });

  it("settles a focused duplicate picker without presenting an error", () => {
    const state = createState();
    state.applySubtitleStyleState(subtitleAuthority());
    state.beginSubtitleColorPicker("picker-duplicate", "fontColor");
    expect(
      state.finishSubtitleColorPicker("picker-duplicate", "focused", subtitleAuthority()),
    ).toBe(true);
    expect(state.snapshot.subtitleStyle.nativeColorSession).toBeNull();
    expect(state.snapshot.subtitleStyle.feedbackByField.fontColor).toBe("idle");
    expect(state.snapshot.subtitleStyle.groupError).toBeNull();
  });

  it("replaces a locally pending picker when the user explicitly retries Show Colors", () => {
    const state = createState();
    state.applySubtitleStyleState(subtitleAuthority());
    state.beginSubtitleColorPicker("picker-stalled", "fontColor");

    expect(state.restartSubtitleColorPicker("picker-retry", "borderColor")).toBe(true);
    expect(state.snapshot.subtitleStyle.nativeColorSession).toEqual({
      requestId: "picker-retry",
      field: "borderColor",
    });
    expect(state.snapshot.subtitleStyle.feedbackByField.fontColor).toBe("idle");
    expect(state.snapshot.subtitleStyle.feedbackByField.borderColor).toBe("saving");
  });

  it("settles the current picker after a newer authority snapshot arrives first", () => {
    const state = createState();
    state.applySubtitleStyleState(subtitleAuthority());
    state.beginSubtitleColorPicker("picker-delayed", "fontColor");
    const latestStyle = {
      ...defaultSubtitleStyle,
      fontColor: { r: 12, g: 34, b: 56, a: 255 },
    };
    expect(
      state.applySubtitleStyleState(
        subtitleAuthority({
          phase: "committed",
          liveStyle: latestStyle,
          committedStyle: latestStyle,
          stateRevision: 3,
          latestIntentSequence: 2,
          committedRevision: 2,
        }),
      ),
    ).toBe(true);

    expect(
      state.finishSubtitleColorPicker(
        "picker-delayed",
        "confirmed",
        subtitleAuthority({ phase: "committed", stateRevision: 2 }),
      ),
    ).toBe(true);
    expect(state.snapshot.subtitleStyle.nativeColorSession).toBeNull();
    expect(state.snapshot.subtitleStyle.feedbackByField.fontColor).toBe("idle");
    expect(state.snapshot.subtitleStyle.displayStyle).toEqual(latestStyle);
  });
});

describe("Sidebar model catalog state", () => {
  class FakeModelControl {
    value = "";
    focusCount = 0;
    private readonly listeners = new Map<string, Array<() => void>>();

    addEventListener(type: string, listener: () => void): void {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    focus(): void {
      this.focusCount += 1;
    }

    dispatch(type: string): void {
      for (const listener of this.listeners.get(type) ?? []) listener();
    }
  }

  it("saves an exact discovered model and clears only its stale required-value error", () => {
    const state = createState();
    state.setModelContext("context-a", "");
    state.applyModelCatalog("context-a", ["model-a", "model-b"]);
    state.setModelRequiredError("Choose a model.");
    const modelSelect = new FakeModelControl();
    const customModelInput = new FakeModelControl();
    let feedbackRenders = 0;

    globalThis.bindSubTandemModelControls({
      state,
      modelSelect,
      customModelInput,
      cancelPendingSave: () => undefined,
      renderModelControl: () => undefined,
      renderModelFeedback: () => {
        feedbackRenders += 1;
      },
    });
    modelSelect.value = "model-b";
    modelSelect.dispatch("change");

    expect(state.modelForSave()).toBe("model-b");
    expect(state.snapshot.modelControl).toMatchObject({
      value: "model-b",
      mode: "known",
      refreshState: "success",
      refreshMessage: "",
      validationError: null,
    });
    expect(feedbackRenders).toBe(1);

    state.setModelRefreshState("error", "The catalog request failed.");
    modelSelect.value = "model-a";
    modelSelect.dispatch("change");
    expect(state.modelForSave()).toBe("model-a");
    expect(state.snapshot.modelControl).toMatchObject({
      refreshState: "error",
      refreshMessage: "The catalog request failed.",
      validationError: null,
    });
    expect(feedbackRenders).toBe(1);
  });

  it("saves a trimmed custom model and clears the empty-value error as soon as input is non-empty", () => {
    const state = createState();
    state.setModelContext("context-a", "");
    state.setModelRequiredError("Choose a model.");
    const modelSelect = new FakeModelControl();
    const customModelInput = new FakeModelControl();
    let feedbackRenders = 0;

    globalThis.bindSubTandemModelControls({
      state,
      modelSelect,
      customModelInput,
      cancelPendingSave: () => undefined,
      renderModelControl: () => undefined,
      renderModelFeedback: () => {
        feedbackRenders += 1;
      },
    });
    modelSelect.value = "__custom__";
    modelSelect.dispatch("change");
    expect(customModelInput.focusCount).toBe(1);
    expect(state.snapshot.modelControl).toMatchObject({
      refreshState: "idle",
      validationError: "Choose a model.",
    });

    customModelInput.value = "  namespace/custom:v2  ";
    customModelInput.dispatch("input");

    expect(state.modelForSave()).toBe("namespace/custom:v2");
    expect(state.snapshot.modelControl).toMatchObject({
      value: "  namespace/custom:v2  ",
      mode: "custom",
      refreshState: "idle",
      refreshMessage: "",
      validationError: null,
    });
    expect(feedbackRenders).toBe(1);
  });

  it("restores the last successful Claude catalog per context and keeps it after failure", () => {
    const state = createState();
    state.setModelContext("claude-a", "custom-a");
    state.applyModelCatalog("claude-a", ["model-a"]);
    state.setModelContext("claude-b", "custom-b");
    state.applyModelCatalog("claude-b", ["model-b"]);
    state.setModelRefreshState("error", "Safe failure");
    expect(state.snapshot.modelControl).toMatchObject({
      value: "custom-b",
      knownModelIds: ["model-b"],
      refreshState: "error",
    });
    state.setModelContext("claude-a", "custom-a");
    expect(state.snapshot.modelControl).toMatchObject({
      value: "custom-a",
      knownModelIds: ["model-a"],
      contextKey: "claude-a",
    });
    state.selectCustomModel();
    expect(state.snapshot.modelControl.mode).toBe("custom");
  });

  it("does not reuse a DeepSeek catalog after the service context changes", () => {
    const state = globalThis.createSubTandemSidebarState();
    state.setModelContext("deepseek|endpoint-a|system|revision-1|credential-1", "custom-id");
    state.applyModelCatalog("deepseek|endpoint-a|system|revision-1|credential-1", [
      "deepseek-model",
    ]);
    state.setModelContext("openai|endpoint-a|system|revision-1|credential-1", "openai-model");
    expect(state.snapshot.modelControl).toMatchObject({
      value: "openai-model",
      knownModelIds: [],
      refreshState: "idle",
    });
    expect(
      state.applyModelCatalog("deepseek|endpoint-a|system|revision-1|credential-1", ["stale"]),
    ).toBe(false);
  });

  it("classifies known and custom values without changing the model ID", () => {
    const state = createState();
    state.setModelContext("context-a", "custom/model:v1");
    expect(state.applyModelCatalog("context-a", ["model-a", "custom/model:v1"])).toBe(true);
    expect(state.snapshot.modelControl).toMatchObject({
      contextKey: "context-a",
      value: "custom/model:v1",
      mode: "known",
      knownModelIds: ["model-a", "custom/model:v1"],
    });
    state.applyModelCatalog("context-a", ["model-a"]);
    expect(state.snapshot.modelControl).toMatchObject({
      value: "custom/model:v1",
      mode: "custom",
      knownModelIds: ["model-a"],
    });
  });

  it("accepts a successful empty catalog and rejects another context", () => {
    const state = createState();
    state.setModelContext("context-a", "model-a");
    expect(state.applyModelCatalog("context-b", ["foreign"])).toBe(false);
    expect(state.applyModelCatalog("context-a", [])).toBe(true);
    expect(state.snapshot.modelControl).toMatchObject({
      value: "model-a",
      mode: "custom",
      knownModelIds: [],
    });
  });

  it("switches between exact known and custom input values", () => {
    const state = createState();
    state.setModelContext("context-a", "model-a");
    state.applyModelCatalog("context-a", ["model-a", "Model-A"]);
    state.selectKnownModel("Model-A");
    expect(state.snapshot.modelControl).toMatchObject({ value: "Model-A", mode: "known" });
    state.selectCustomModel();
    state.inputCustomModelValue("namespace/custom:v2");
    expect(state.snapshot.modelControl).toMatchObject({
      value: "namespace/custom:v2",
      mode: "custom",
    });
  });

  it("keeps an explicitly selected Custom mode when the current value is still known", () => {
    const state = createState();
    state.setModelContext("context-a", "model-a");
    state.applyModelCatalog("context-a", ["model-a", "model-b"]);

    state.selectCustomModel();

    expect(state.snapshot.modelControl).toMatchObject({
      value: "model-a",
      mode: "custom",
      knownModelIds: ["model-a", "model-b"],
    });
  });

  it("tracks busy and safe failure states without clearing the last successful catalog", () => {
    const state = createState();
    state.setModelContext("context-a", "model-a");
    state.applyModelCatalog("context-a", ["model-a", "model-b"]);
    state.setModelRefreshState("busy");
    expect(state.snapshot.modelControl).toMatchObject({
      refreshState: "busy",
      knownModelIds: ["model-a", "model-b"],
    });
    state.setModelRefreshState("error");
    expect(state.snapshot.modelControl).toMatchObject({
      refreshState: "error",
      knownModelIds: ["model-a", "model-b"],
      value: "model-a",
    });
  });

  it("keeps model refresh feedback independent from the latest Profile operation", () => {
    const state = createState();
    state.beginOperation(
      {
        requestId: "activation-request",
        regionId: "profile-row:retained",
        actionId: "activation",
        profileId: "retained",
      },
      "Enabling…",
    );
    state.finishOperation("activation-request", "success", "Profile enabled for translation.");

    state.setModelRefreshState("busy", "Refreshing models…");
    state.setModelRefreshState("success", "2 models available.");

    expect(state.snapshot.activeFeedback).toMatchObject({
      requestId: "activation-request",
      message: "Profile enabled for translation.",
    });
    expect(state.snapshot.modelControl).toMatchObject({
      refreshState: "success",
      refreshMessage: "2 models available.",
    });
  });
});

describe("Sidebar Profile name source", () => {
  it("tracks Claude system ownership, credential pending and exact model controls", () => {
    const state = createState();
    state.resetProfileName("OpenAI");
    state.changeServiceTypeLabel("Claude");
    expect(state.snapshot.profileName).toEqual({
      value: "Claude",
      mode: "system",
      serviceTypeLabel: "Claude",
    });
    state.beginProfileSave("claude-save", true);
    expect(state.snapshot.pendingProfileSave).toMatchObject({
      requestId: "claude-save",
      credentialPending: true,
    });
    state.setModelContext("claude-context", "custom-claude-model");
    state.applyModelCatalog("claude-context", ["catalog-model"]);
    expect(state.snapshot.modelControl).toMatchObject({
      value: "custom-claude-model",
      mode: "custom",
      knownModelIds: ["catalog-model"],
    });
    state.beginOperation({
      requestId: "select-claude",
      regionId: "profile-row:claude",
      actionId: "select",
      profileId: "claude",
      revision: 1,
    });
    expect(state.snapshot.requests["select-claude"]).toMatchObject({
      profileId: "claude",
      revision: 1,
    });
  });

  it("follows Service type labels only while the name is system-owned", () => {
    const state = createState();
    state.resetProfileName("OpenAI-compatible");
    expect(state.snapshot.profileName).toEqual({
      value: "OpenAI-compatible",
      mode: "system",
      serviceTypeLabel: "OpenAI-compatible",
    });

    state.changeServiceTypeLabel("Ollama");
    expect(state.snapshot.profileName.value).toBe("Ollama");
    expect(state.snapshot.profileName.mode).toBe("system");
  });

  it.each(["Custom", "", "   ", "OpenAI-compatible"])(
    "protects user input %j from later Service type changes",
    (value) => {
      const state = createState();
      state.resetProfileName("OpenAI-compatible");
      state.inputProfileName(value);
      state.changeServiceTypeLabel("Ollama");

      expect(state.snapshot.profileName).toEqual({
        value,
        mode: "user",
        serviceTypeLabel: "Ollama",
      });
    },
  );

  it("protects a saved name and lets New restore system ownership", () => {
    const state = createState();
    state.loadProfileName("Saved profile", "OpenAI-compatible");
    state.changeServiceTypeLabel("Ollama");
    expect(state.snapshot.profileName.value).toBe("Saved profile");
    expect(state.snapshot.profileName.mode).toBe("saved");

    state.resetProfileName("Ollama");
    expect(state.snapshot.profileName).toEqual({
      value: "Ollama",
      mode: "system",
      serviceTypeLabel: "Ollama",
    });
  });
});

describe("Sidebar two-stage Profile Update", () => {
  it("keeps the editing revision stable until its correlated save response arrives", () => {
    const state = createState();
    const editingProfile = { profileId: "retained", revision: 1, displayName: "Before" };
    state.setProfileContext({ editingProfileId: editingProfile.profileId });
    state.beginProfileSave("save-request", false);
    state.applyProfiles([
      { profileId: "deleted", revision: 2 },
      { profileId: "retained", revision: 2, displayName: "After" },
    ]);

    expect(state.reconcileEditingProfile(editingProfile)).toEqual(editingProfile);

    state.profileRevisionCreated("save-request", {
      profileId: "retained",
      revision: 2,
      selectionInvalidated: true,
    });
    state.completeProfileSave("save-request", "Profile saved.");

    expect(state.reconcileEditingProfile(editingProfile)).toEqual({
      profileId: "retained",
      revision: 2,
      displayName: "After",
    });
  });

  it.each([false, true])(
    "preserves selection invalidation through credentialPending=%s",
    (credentialPending) => {
      const state = createState();
      state.beginProfileSave("save-request", credentialPending);
      expect(
        state.profileRevisionCreated("save-request", {
          profileId: "retained",
          revision: 2,
          selectionInvalidated: true,
        }),
      ).toEqual({ accepted: true, waitingForCredential: credentialPending });
      expect(state.snapshot.pendingProfileSave?.selectionInvalidated).toBe(true);

      expect(state.completeProfileSave("save-request", "Profile saved.")).toBe(
        "Profile updated. Enable it when you are ready.",
      );
      expect(state.snapshot.pendingProfileSave).toBeNull();
    },
  );
});

describe("Sidebar translation position state", () => {
  it("previews input and begins one request-correlated save", () => {
    const state = createState();
    expect(state.previewOverlayPosition(42)).toBe(true);
    expect(state.snapshot.overlayPosition).toMatchObject({
      displayPosition: 42,
      committedPosition: 0,
      interaction: "previewing",
      feedback: "idle",
    });
    expect(state.beginOverlayPositionSave("position-save-1")).toBe(true);
    expect(state.beginOverlayPositionSave("position-save-1")).toBe(false);
    expect(state.snapshot.overlayPosition).toMatchObject({
      pendingSaveRequestId: "position-save-1",
      interaction: "idle",
      feedback: "saving",
    });
  });

  it("commits a trackpad-only drag once across repeated completion signals", () => {
    const state = createState();
    expect(state.completeOverlayPositionInteraction("position-save-touchpad")).toBe(false);
    expect(state.previewOverlayPosition(64)).toBe(true);
    expect(state.completeOverlayPositionInteraction("position-save-touchpad")).toBe(true);
    expect(state.completeOverlayPositionInteraction("position-save-duplicate")).toBe(false);
    expect(state.snapshot.overlayPosition).toMatchObject({
      displayPosition: 64,
      pendingSaveRequestId: "position-save-touchpad",
      interaction: "idle",
      feedback: "saving",
    });
  });

  it("filters old state and accepts current success", () => {
    const state = createState();
    state.applyOverlayPositionState({
      phase: "preview",
      position: 75,
      committedPosition: 0,
      intentSequence: 4,
      committedRevision: 0,
    });
    expect(
      state.applyOverlayPositionState({
        phase: "committed",
        position: 25,
        committedPosition: 25,
        intentSequence: 3,
        committedRevision: 1,
      }),
    ).toBe(false);
    state.beginOverlayPositionSave("position-save-1");
    expect(
      state.finishOverlayPositionSave({
        requestId: "position-save-1",
        ok: true,
        position: 75,
        intentSequence: 4,
        committedRevision: 1,
      }),
    ).toBe(true);
    expect(state.snapshot.overlayPosition).toMatchObject({
      displayPosition: 75,
      committedPosition: 75,
      feedback: "saved",
      pendingSaveRequestId: null,
    });
  });

  it("ignores stale results and safely reverts the current failed request", () => {
    const state = createState();
    state.applyOverlayPositionState({
      phase: "committed",
      position: 25,
      committedPosition: 25,
      intentSequence: 2,
      committedRevision: 1,
    });
    state.previewOverlayPosition(80);
    state.beginOverlayPositionSave("position-save-2");
    expect(
      state.finishOverlayPositionSave({
        requestId: "position-save-old",
        ok: false,
        committedPosition: 0,
        intentSequence: 1,
        committedRevision: 0,
      }),
    ).toBe(false);
    expect(
      state.finishOverlayPositionSave({
        requestId: "position-save-2",
        ok: false,
        committedPosition: 25,
        intentSequence: 3,
        committedRevision: 1,
      }),
    ).toBe(true);
    expect(state.snapshot.overlayPosition).toMatchObject({
      displayPosition: 25,
      committedPosition: 25,
      feedback: "error",
    });
  });
});

describe("Sidebar confirmed Profile activation", () => {
  const profiles = [
    {
      profileId: "profile-a",
      revision: 1,
      displayName: "A",
      kind: "openai",
      endpoint: "https://a.example/v1",
      endpointFingerprint: "fingerprint-a",
      proxyMode: "direct",
      model: "model-a",
      credentialConfigured: false,
    },
    {
      profileId: "profile-b",
      revision: 1,
      displayName: "B",
      kind: "openai",
      endpoint: "https://b.example/v1",
      endpointFingerprint: "fingerprint-b",
      proxyMode: "direct",
      model: "model-b",
      credentialConfigured: false,
    },
  ];
  const authority = (stateVersion: number, profileId: string | null = "profile-a") => ({
    authorityId: "authority-1",
    stateVersion,
    ready: true,
    activationGeneration: stateVersion,
    activation: profileId
      ? {
          profileId,
          profileRevision: 1,
          kind: "openai",
          endpointFingerprint: `fingerprint-${profileId.at(-1)}`,
          credentialConfigured: false,
        }
      : null,
    profiles,
  });

  it("derives checked state from confirmed authority and disables input while busy", () => {
    const state = createState();
    expect(state.applyProfileAuthority(authority(1))).toBe(true);
    expect(state.profileActivationView("profile-a")).toMatchObject({
      checked: true,
      disabled: false,
      accessibleName: "Enable A",
    });
    expect(state.beginProfileActivation("activation-1", "profile-b", true)).toBe(true);
    expect(state.profileActivationView("profile-b")).toMatchObject({
      checked: false,
      disabled: true,
      busy: true,
    });
    expect(state.profileActivationView("profile-a").checked).toBe(true);
  });

  it("does not let a receipt bypass authority version gating", () => {
    const state = createState();
    state.applyProfileAuthority(authority(3));
    state.beginProfileActivation("activation-1", "profile-b", true);
    expect(
      state.finishProfileActivation({
        requestId: "activation-1",
        outcome: "changed",
        authority: authority(2, "profile-b"),
      }),
    ).toMatchObject({ accepted: true, authorityAccepted: false });
    expect(state.profileActivationView("profile-a").checked).toBe(true);
    expect(state.profileActivationView("profile-b").checked).toBe(false);
  });

  it("keeps failures associated with the initiating switch and leaves unchanged silent", () => {
    const state = createState();
    state.applyProfileAuthority(authority(1));
    state.beginProfileActivation("activation-failed", "profile-b", true);
    state.finishProfileActivation({
      requestId: "activation-failed",
      outcome: "failed",
      authority: authority(1),
      error: { code: "PROFILE_STATE_CONFLICT", userAction: "NONE" },
    });
    expect(state.profileActivationView("profile-b").error).toMatch(/could not/i);
    state.beginProfileActivation("activation-unchanged", "profile-a", false);
    expect(
      state.finishProfileActivation({
        requestId: "activation-unchanged",
        outcome: "unchanged",
        authority: authority(1),
      }).announce,
    ).toBe(false);
  });

  it("reports restoration readiness without allowing activation requests", () => {
    const state = createState();
    state.applyProfileAuthority({ ...authority(1, null), ready: false });
    expect(state.profileActivationView("profile-a")).toMatchObject({
      checked: false,
      disabled: true,
      readinessMessage: expect.stringMatching(/restor|confirm|storage/i),
    });
    expect(state.beginProfileActivation("activation-1", "profile-a", true)).toBe(false);
  });
});

describe("Sidebar Profile editing identity", () => {
  it("keeps one editing identity, advances context only on switches and stays independent of activation", () => {
    const state = createState();
    expect(state.activateProfileEditor("retained")).toEqual({
      changed: true,
      discardedProfileId: null,
    });
    const firstContextVersion = state.snapshot.profileEditorContextVersion;
    expect(state.activateProfileEditor("retained")).toEqual({
      changed: false,
      discardedProfileId: null,
    });
    expect(state.snapshot.profileEditorContextVersion).toBe(firstContextVersion);
    expect(state.activateProfileEditor("deleted")).toEqual({
      changed: true,
      discardedProfileId: "retained",
    });
    expect(state.snapshot.editingProfileId).toBe("deleted");
    expect(state.snapshot.profileEditorContextVersion).toBe(firstContextVersion + 1);
    expect(state.snapshot.profileAuthority).toBeNull();
  });
});

describe("Sidebar Profile drawer identity", () => {
  it("creates single-use drawer identities and discards asynchronous ownership on close", () => {
    const state = createState();

    const first = state.openProfileDrawer("retained");
    expect(first.changed).toBe(true);
    expect(state.snapshot.drawer).toMatchObject({
      mode: "editing",
      profileId: "retained",
      draftRevision: 1,
      credentialEpoch: 1,
      validity: "current",
    });
    const firstDrawerId = state.snapshot.drawer.drawerId;

    state.beginDrawerTest("test-1");
    state.changeDrawerTestField();
    expect(state.snapshot.drawer.draftRevision).toBe(2);
    expect(state.snapshot.drawer.test).toBeNull();
    state.changeDrawerCredential();
    expect(state.snapshot.drawer.credentialEpoch).toBe(2);

    expect(state.closeProfileDrawer()).toMatchObject({ focus: "profile", profileId: "retained" });
    expect(state.snapshot.drawer).toMatchObject({ mode: "closed", drawerId: null });
    state.openProfileDrawer("retained");
    expect(state.snapshot.drawer.drawerId).not.toBe(firstDrawerId);
  });

  it("reuses one New drawer but switches away by clearing its ownership", () => {
    const state = createState();

    expect(state.openNewProfileDrawer()).toMatchObject({ changed: true, reused: false });
    const drawerId = state.snapshot.drawer.drawerId;
    state.beginDrawerTest("new-test");
    expect(state.openNewProfileDrawer()).toMatchObject({ changed: false, reused: true });
    expect(state.snapshot.drawer.drawerId).toBe(drawerId);

    expect(state.openProfileDrawer("deleted")).toMatchObject({
      changed: true,
      discardedMode: "new",
    });
    expect(state.snapshot.drawer).toMatchObject({
      mode: "editing",
      profileId: "deleted",
      test: null,
    });
  });

  it("returns the exact active Test owner when locally cancelling", () => {
    const state = createState();
    state.openProfileDrawer("retained");
    state.beginDrawerTest("test-cancel");

    expect(state.cancelDrawerTest()).toBe("test-cancel");
    expect(state.snapshot.drawer.test).toBeNull();
    expect(state.cancelDrawerTest()).toBeNull();
  });

  it("accepts Test results only for the matching request, drawer and draft revision", () => {
    const state = createState();
    state.openProfileDrawer("retained");
    const started = state.beginDrawerTest("test-owned")!;

    expect(
      state.finishDrawerTest(
        "test-owned",
        true,
        "Wrong drawer",
        "drawer-stale",
        started.draftRevision,
      ),
    ).toBeNull();
    expect(
      state.finishDrawerTest(
        "test-owned",
        true,
        "Wrong revision",
        started.drawerId,
        started.draftRevision + 1,
      ),
    ).toBeNull();
    expect(
      state.finishDrawerTest(
        "test-owned",
        true,
        "Connection test passed.",
        started.drawerId,
        started.draftRevision,
      ),
    ).toMatchObject({ phase: "passed", message: "Connection test passed." });
  });

  it("does not cancel Test on delete prompt, but locks the drawer after confirmation", () => {
    const state = createState();
    state.openProfileDrawer("retained");
    state.beginDrawerTest("test-delete");

    expect(
      state.openDeleteConfirmation({
        profileId: "retained",
        expectedRevision: 1,
        displayName: "Retained",
      }),
    ).toBe(true);
    expect(state.snapshot.drawer).toMatchObject({
      test: { requestId: "test-delete" },
      deletePhase: "confirming",
    });
    expect(state.beginProfileDelete("delete-request")).toMatchObject({ profileId: "retained" });
    expect(state.snapshot.drawer.deletePhase).toBe("deleting");
  });

  it("preserves a current draft across ordinary refresh and conflicts on a remote revision", () => {
    const state = createState();
    state.openProfileDrawer("retained");
    const drawerId = state.snapshot.drawer.drawerId;

    state.applyProfiles([
      { profileId: "deleted", revision: 2 },
      { profileId: "retained", revision: 1, displayName: "Remote summary" },
    ]);
    expect(state.snapshot.drawer).toMatchObject({ drawerId, validity: "current" });

    state.applyProfiles([
      { profileId: "deleted", revision: 2 },
      { profileId: "retained", revision: 2, displayName: "Remote revision" },
    ]);
    expect(state.snapshot.drawer).toMatchObject({
      drawerId,
      mode: "editing",
      validity: "conflict",
      test: null,
    });
  });

  it("closes a drawer whose saved Profile was remotely deleted", () => {
    const state = createState();
    state.openProfileDrawer("deleted");
    state.beginDrawerTest("test-remote-delete");

    state.applyProfiles([{ profileId: "retained", revision: 1 }]);

    expect(state.snapshot.drawer).toMatchObject({ mode: "closed", drawerId: null });
    expect(state.snapshot.editingProfileId).toBeNull();
  });
});

describe("Sidebar Profile drawer save lifecycle", () => {
  it("keeps a new drawer open through profile creation and closes only at terminal success", () => {
    const state = createState();
    state.openNewProfileDrawer();
    const drawerId = state.snapshot.drawer.drawerId;

    state.beginProfileSave("save-new", true);
    expect(state.snapshot.drawer).toMatchObject({ drawerId, savePhase: "profile", mode: "new" });
    expect(
      state.profileRevisionCreated("save-new", {
        profileId: "created",
        revision: 1,
        endpointFingerprint: "created-fingerprint",
        selectionInvalidated: false,
      }),
    ).toEqual({ accepted: true, waitingForCredential: true });
    expect(state.snapshot.drawer).toMatchObject({
      drawerId,
      mode: "editing",
      profileId: "created",
      savePhase: "credential",
      sourceProfile: {
        profileId: "created",
        profileRevision: 1,
        endpointFingerprint: "created-fingerprint",
      },
    });

    expect(state.completeProfileSave("save-new", "Saved.", true)).toBe("Saved.");
    expect(state.snapshot.drawer).toMatchObject({ mode: "closed", drawerId: null });
  });

  it("retains a retryable editing drawer after credential failure without recreating", () => {
    const state = createState();
    state.openNewProfileDrawer();
    state.beginProfileSave("save-partial", true);
    state.profileRevisionCreated("save-partial", {
      profileId: "created",
      revision: 1,
      endpointFingerprint: "created-fingerprint",
      selectionInvalidated: false,
    });

    expect(state.completeProfileSave("save-partial", "Credential failed.", false)).toBe(
      "Credential failed.",
    );
    expect(state.snapshot.drawer).toMatchObject({
      mode: "editing",
      profileId: "created",
      savePhase: null,
      validity: "current",
    });
  });
});
