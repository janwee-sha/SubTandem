import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sidebarHarness } from "../helpers/sidebar-harness.js";
import { uiLanguageRuntime } from "../helpers/ui-language-runtime.js";
import { UI_LOCALES } from "../../src/shared/localization/locales.js";
import { createLocalizer } from "../../src/ui/localization.js";

const base = "https://github.com/janwee-sha/SubTandem/blob/main/docs/support/";
const pageFiles: Record<string, string> = {
  "zh-Hans": "README.zh-Hans.md",
  "zh-Hant": "README.zh-Hant.md",
  fr: "README.fr.md",
  ja: "README.ja.md",
  ko: "README.ko.md",
  ru: "README.ru.md",
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock("../../src/runtime/providers/profile-activation.js");
});

describe("Sidebar support entry", () => {
  it.each(UI_LOCALES)("renders an inert-then-localized link in %s", (locale) => {
    const h = sidebarHarness({ locale });
    h.activate("#support-link");
    expect(h.messages.filter((message) => message.name === "support:open")).toEqual([]);
    expect(h.element("#support-link").getAttribute("href")).toBeNull();
    h.receive("state:update", { status: "disabled", profiles: [] });
    expect(h.element("#support-link").getAttribute("href")).toBe(
      base + (pageFiles[locale] ?? "README.md"),
    );
    expect(h.element("#support-link").textContent).toBe(
      createLocalizer(locale).format("support.label"),
    );
    expect(h.element("#support-link").getAttribute("title")).toBe(
      createLocalizer(locale).format("support.openInBrowser"),
    );
    h.pulse();
    h.receive("state:update", { status: "running", profiles: [] });
    expect(h.messages.filter((message) => message.name === "support:open")).toEqual([]);
    const preventDefault = vi.fn();
    h.element("#support-link").dispatch("click", h.element("#support-link"), { preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(h.messages.filter((message) => message.name === "support:open")).toHaveLength(1);
    const request = h.messages.at(-1)!;
    expect(request.data.payload).toEqual({});
    h.receive("support:open-result", { requestId: request.data.requestId, ok: false });
    expect(h.element("#support-status").textContent).toBe(
      createLocalizer(locale).format("support.openFailed"),
    );
  });

  it("correlates results and leaves retry available after a failure", () => {
    const h = sidebarHarness({ locale: "zh-Hant" });
    h.receive("state:update", { status: "disabled" });
    h.receive("support:open-result", { requestId: null, ok: false });
    h.receive("support:open-result", { requestId: "unsolicited", ok: false });
    expect(h.element("#support-status").textContent).toBe("");
    h.activate("#support-link", "Enter");
    const first = h.messages.at(-1)!;
    h.receive("support:open-result", { requestId: "other", ok: false });
    h.receive("support:open-result", { requestId: first.data.requestId, ok: "false" });
    expect(h.element("#support-status").textContent).toBe("");
    h.receive("support:open-result", { requestId: first.data.requestId, ok: false });
    expect(h.element("#support-status").dataset.state).toBe("error");
    h.activate("#support-link", "Enter");
    const second = h.messages.at(-1)!;
    expect(second.data.requestId).not.toBe(first.data.requestId);
    expect(h.element("#support-status").textContent).toBe("");
    h.receive("support:open-result", { requestId: first.data.requestId, ok: false });
    h.receive("support:open-result", { requestId: second.data.requestId, ok: true });
    expect(h.element("#support-status").textContent).toBe("");
    expect(h.messages.filter((message) => message.name === "support:open")).toHaveLength(2);
  });
});

describe("Main support navigation", () => {
  it.each(["en", "en-GB", "zh-Hans", "zh-Hant", "fr", "ja", "ko", "ru", "de", "he"])(
    "opens the fixed %s page once in the browser without provider traffic",
    async (locale) => {
      const h = await uiLanguageRuntime();
      const window = await h.addWindow({ preferred: [locale] });
      expect(window.runtime.utils.open).not.toHaveBeenCalled();
      window.poll();
      await h.pump();
      expect(window.runtime.utils.open).not.toHaveBeenCalled();
      window.sidebar.activate("#support-link", "Enter");
      expect(window.runtime.utils.open).toHaveBeenCalledExactlyOnceWith(
        base + (pageFiles[locale] ?? "README.md"),
      );
      expect(window.sidebar.element("#support-status").textContent).toBe("");
      expect(h.network).not.toHaveBeenCalled();
      expect(h.exec).not.toHaveBeenCalled();
      expect(h.preferences.set).not.toHaveBeenCalled();
      window.close();
    },
  );

  it("rejects arbitrary destinations and private data at the Main boundary", async () => {
    const h = await uiLanguageRuntime();
    const window = await h.addWindow({ preferred: ["fr"] });
    for (const payload of [
      { url: "https://example.invalid/private" },
      { url: "file:///private/file" },
      { url: "javascript:alert(1)" },
      { locale: "ja" },
      { apiKey: "synthetic-private-key" },
      { subtitle: "synthetic-private-subtitle" },
      [],
      null,
    ])
      window.send("support:open", { requestId: "test-request", revision: 1, payload });
    window.send("support:open", null);
    window.send("support:open", { requestId: "test-request", revision: 1, payload: {}, url: base });
    expect(window.runtime.utils.open).not.toHaveBeenCalled();
    expect(h.network).not.toHaveBeenCalled();
    expect(h.exec).not.toHaveBeenCalled();
    expect(window.messages.some((message) => message.name === "support:open-result")).toBe(false);
    window.sidebar.activate("#support-link");
    expect(window.runtime.utils.open).toHaveBeenCalledExactlyOnceWith(base + "README.fr.md");
    window.close();
  });

  it.each(["returns false", "throws"])(
    "shows a localized error when the host %s",
    async (failure) => {
      const h = await uiLanguageRuntime();
      const window = await h.addWindow({ preferred: ["zh-Hans"] });
      if (failure === "throws")
        window.runtime.utils.open.mockImplementationOnce(() => {
          throw new Error("synthetic-private-host-error");
        });
      else window.runtime.utils.open.mockReturnValueOnce(false);
      window.sidebar.activate("#support-link");
      expect(window.sidebar.element("#support-status").textContent).toBe(
        "无法打开打赏页面，请重试。",
      );
      expect(window.sidebar.element("#support-status").textContent).not.toContain("synthetic");
      window.sidebar.activate("#support-link");
      expect(window.sidebar.element("#support-status").textContent).toBe("");
      expect(window.runtime.utils.open).toHaveBeenCalledTimes(2);
      window.close();
    },
  );

  it("uses the existing English fallback on older hosts", async () => {
    const h = await uiLanguageRuntime();
    const window = await h.addWindow({ version: "1.4.4", preferred: ["zh-Hans"] });
    window.sidebar.activate("#support-link");
    expect(window.runtime.utils.open).toHaveBeenCalledExactlyOnceWith(base + "README.md");
    window.close();
  });

  it("keeps browser navigation inactive while the language snapshot is pending", async () => {
    const h = await uiLanguageRuntime();
    const window = await h.addWindow({ preferred: ["ja"], holdSnapshots: true });
    window.sidebar.activate("#support-link");
    expect(window.runtime.utils.open).not.toHaveBeenCalled();
    window.releaseSnapshot();
    window.sidebar.activate("#support-link");
    expect(window.runtime.utils.open).toHaveBeenCalledExactlyOnceWith(base + "README.ja.md");
    window.close();
  });
});
