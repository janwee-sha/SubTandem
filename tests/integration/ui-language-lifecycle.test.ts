import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uiLanguageRuntime } from "../helpers/ui-language-runtime.js";
import { sidebarHarness } from "../helpers/sidebar-harness.js";
import { UI_LOCALES } from "../../src/shared/localization/locales.js";
import { createLocalizer } from "../../src/ui/localization.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock("../../src/runtime/providers/profile-activation.js");
});
const context = (locale: string, authorityId = "current-authority") => ({
  authorityId,
  locale,
  direction: locale === "he" ? "rtl" : "ltr",
  hostVersion: "1.5.0",
  hostLocalization: locale,
  fallbackReason: null,
});
const authority = (authorityId: string) => ({
  authorityId,
  stateVersion: 1,
  ready: true,
  activationGeneration: 0,
  activation: null,
  profiles: [],
});

describe("real Main, Global mailbox and Sidebar language lifecycle", () => {
  it.each([
    [{ version: "1.4.9" }, "legacyHost", 0],
    [{ version: "1.5.0-beta.1" }, "unknownVersion", 0],
    [{ version: "unknown" }, "unknownVersion", 0],
    [{ throwVersion: true }, "unknownVersion", 0],
    [{ missingApi: true }, "unavailable", 0],
    [{ throwLanguage: true }, "readFailed", 1],
    [{ preferred: [] }, "emptyResult", 1],
    [{ preferred: "de" }, "invalidResult", 1],
    [{ preferred: [42] }, "invalidResult", 1],
    [{ preferred: [""] }, "invalidResult", 1],
    [{ preferred: ["zh", "de"] }, "unsupportedLocale", 1],
    [{ preferred: ["sr-Cyrl", "he"] }, "unsupportedLocale", 1],
  ] as const)(
    "resolves a host fault once and preserves operations: %j",
    async (options, failure, calls) => {
      const runtime = await uiLanguageRuntime();
      const window = await runtime.addWindow(options);
      expect(
        window.state,
        JSON.stringify({
          frames: runtime.frames.map((f) => [f.frame.name, f.frame.data]),
          files: [...runtime.files.keys()],
          logs: window.runtime.console.log.mock.calls,
        }),
      ).toBeDefined();
      expect(window.state.uiLanguage).toMatchObject({
        locale: "en",
        direction: "ltr",
        fallbackReason: failure,
      });
      expect(window.preferred).toHaveBeenCalledTimes(calls);
      expect(window.sidebar.evaluate("document.documentElement.lang")).toBe("en");
      expect(window.sidebar.element("#new-profile").disabled).toBe(false);
      window.sidebar.activate("#new-profile");
      expect(window.sidebar.evaluate("profileDrawer.hidden")).toBe(false);
      const second = await runtime.addWindow({ preferred: ["he"] });
      expect(second.state.uiLanguage).toEqual(window.state.uiLanguage);
      expect(runtime.exec).not.toHaveBeenCalled();
      expect(runtime.network).not.toHaveBeenCalled();
      window.close();
      second.close();
    },
  );
  it.each(UI_LOCALES)(
    "freezes %s across windows/reloads and resamples after restart",
    async (locale) => {
      const runtime = await uiLanguageRuntime();
      const first = await runtime.addWindow({
        preferred: [locale.replace(/-/g, "_").toUpperCase(), "en"],
      });
      const second = await runtime.addWindow({ preferred: [locale === "he" ? "de" : "he"] });
      expect(first.state.uiLanguage.locale).toBe(locale);
      expect(second.state.uiLanguage).toEqual(first.state.uiLanguage);
      const id = first.state.uiLanguage.authorityId;
      expect(first.state.profileAuthority.authorityId).toBe(id);
      first.reload();
      await runtime.pump();
      expect(first.sidebar.evaluate("document.documentElement.lang")).toBe(locale);
      expect(first.sidebar.element("#new-profile").textContent).toBe(
        createLocalizer(locale).format("sidebar.newProfile"),
      );
      expect(first.preferred).toHaveBeenCalledTimes(1);
      first.close();
      second.close();
      const restarted = await uiLanguageRuntime();
      const fresh = await restarted.addWindow({ preferred: [locale === "he" ? "de" : "he"] });
      expect(fresh.state.uiLanguage.locale).toBe(locale === "he" ? "de" : "he");
      expect(fresh.state.uiLanguage.authorityId).not.toBe(id);
      expect(restarted.preferences.set).not.toHaveBeenCalled();
      expect(runtime.exec).not.toHaveBeenCalled();
      expect(restarted.exec).not.toHaveBeenCalled();
      fresh.close();
    },
  );
  it("rebinds Main only after a correlated authority response and rejects old locale results", async () => {
    const runtime = await uiLanguageRuntime();
    const window = await runtime.addWindow({ preferred: ["de"] });
    const previous = window.state.uiLanguage;
    runtime.dropResponse("profile-activation:state", true);
    runtime.dropLanguage(true);
    window.reload();
    await runtime.pump();
    const request = [...runtime.frames]
      .reverse()
      .find((entry) => entry.frame.name === "profile-activation:get")!.frame.data;
    const freshAuthority = {
      ...window.state.profileAuthority,
      authorityId: "replacement-authority",
      stateVersion: 1,
    };
    runtime.injectResponse("profile-activation:state", {
      requestId: request.requestId,
      authority: freshAuthority,
    });
    await runtime.pump();
    const languageRequest = [...runtime.frames]
      .reverse()
      .find((entry) => entry.frame.name === "ui-language:get")!.frame.data;
    runtime.injectResponse("ui-language:state", {
      requestId: languageRequest.requestId,
      context: previous,
    });
    await runtime.pump();
    expect(window.state.uiLanguage).toEqual(previous);
    runtime.injectResponse("ui-language:state", {
      requestId: languageRequest.requestId,
      context: { ...previous, authorityId: freshAuthority.authorityId },
    });
    await runtime.pump();
    expect(window.state.uiLanguage.authorityId).toBe(freshAuthority.authorityId);
    expect(window.state.profileAuthority.authorityId).toBe(freshAuthority.authorityId);
    expect(window.sidebar.evaluate("document.documentElement.lang")).toBe("de");
    runtime.injectResponse("ui-language:state", {
      requestId: languageRequest.requestId,
      context: { ...previous, locale: "he", direction: "rtl", hostLocalization: "he" },
    });
    await runtime.pump();
    runtime.injectResponse("profile-activation:state", {
      requestId: request.requestId,
      authority: { ...freshAuthority, authorityId: previous.authorityId, stateVersion: 50 },
    });
    await runtime.pump();
    expect(window.state.uiLanguage.authorityId).toBe(freshAuthority.authorityId);
    expect(window.state.profileAuthority.authorityId).toBe(freshAuthority.authorityId);
    expect(window.preferred).toHaveBeenCalledTimes(1);
    window.close();
  });
  it("waits for an atomic snapshot before applying buffered business events", async () => {
    const runtime = await uiLanguageRuntime();
    const window = await runtime.addWindow({ preferred: ["he"], holdSnapshots: true });
    expect(window.sidebar.element("#app").getAttribute("inert")).not.toBeNull();
    expect(window.sidebar.evaluate("sidebarState.snapshot.profileAuthority")).toBeNull();
    window.releaseSnapshot();
    expect(window.sidebar.evaluate("document.documentElement.lang")).toBe("he");
    expect(window.sidebar.element("#app").getAttribute("inert")).toBeNull();
    expect(window.sidebar.evaluate("sidebarState.snapshot.profileAuthority.authorityId")).toBe(
      window.state.uiLanguage.authorityId,
    );
    window.close();
  });
  it("retries within the existing mailbox lifecycle and ignores the timed out language result", async () => {
    const runtime = await uiLanguageRuntime();
    runtime.dropLanguage(true);
    const window = await runtime.addWindow({ preferred: ["de"] });
    expect(window.state).toBeUndefined();
    const previous = runtime.frames.find((entry) => entry.frame.name === "ui-language:state")!;
    await vi.advanceTimersByTimeAsync(30_001);
    window.poll();
    runtime.dropLanguage(false);
    await runtime.pump();
    expect(window.state.uiLanguage.locale).toBe("de");
    expect(runtime.frames.filter((entry) => entry.frame.name === "ui-language:get")).toHaveLength(
      2,
    );
    runtime.files.set(previous.path, previous.content);
    runtime.files.set(previous.path.replace(/\.json$/, ".ready"), "");
    await runtime.pump();
    expect(window.state.uiLanguage.locale).toBe("de");
    expect(window.preferred).toHaveBeenCalledTimes(1);
    window.close();
  });
});

describe("Sidebar context defects and authority replacement", () => {
  it("rejects contextless and retired authority snapshots/results", () => {
    const h = sidebarHarness();
    h.receiveRaw("state:update", {
      uiLanguage: context("de", "old"),
      profileAuthority: authority("old"),
      status: "disabled",
    });
    h.receiveRaw("state:update", { status: "translating" });
    expect(h.evaluate("document.documentElement.lang")).toBe("de");
    h.activate("#new-profile");
    h.receiveRaw("state:update", {
      uiLanguage: context("he", "new"),
      profileAuthority: authority("new"),
      status: "disabled",
    });
    expect(h.evaluate("sidebarState.snapshot.drawer.mode")).toBe("closed");
    expect(h.evaluate("sidebarState.snapshot.profileAuthority.authorityId")).toBe("new");
    h.receiveRaw("state:update", {
      uiLanguage: context("de", "old"),
      profileAuthority: authority("old"),
      status: "translating",
    });
    h.receiveRaw("profile-activation:state", { ...authority("old"), stateVersion: 50 });
    expect(h.evaluate("document.documentElement.lang")).toBe("he");
    expect(h.evaluate("sidebarState.snapshot.profileAuthority.authorityId")).toBe("new");
    h.event("pagehide");
  });
  it.each(["xx", "zh", 42, null, ""])(
    "safely renders English for invalid snapshot locale %j",
    (locale) => {
      const h = sidebarHarness();
      h.receiveRaw("state:update", {
        uiLanguage: { ...context("he"), locale },
        status: "disabled",
        profileAuthority: authority("current-authority"),
      });
      expect(h.evaluate("document.documentElement.lang")).toBe("en");
      expect(h.evaluate("document.documentElement.dir")).toBe("ltr");
      expect(h.element("#app").getAttribute("inert")).toBeNull();
      expect(h.element("#new-profile").textContent).toBe(
        createLocalizer("en").format("sidebar.newProfile"),
      );
      h.event("pagehide");
    },
  );
});
