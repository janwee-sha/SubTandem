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
});

describe("Sidebar model catalog state", () => {
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
        requestId: "select-request",
        regionId: "profile-row:retained",
        actionId: "select",
        profileId: "retained",
      },
      "Selecting…",
    );
    state.finishOperation("select-request", "success", "Profile selected for translation.");

    state.setModelRefreshState("busy", "Refreshing models…");
    state.setModelRefreshState("success", "2 models available.");

    expect(state.snapshot.activeFeedback).toMatchObject({
      requestId: "select-request",
      message: "Profile selected for translation.",
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
        "Profile updated. Select it again for translation.",
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
