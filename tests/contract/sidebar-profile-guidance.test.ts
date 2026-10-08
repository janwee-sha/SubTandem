import { describe, expect, it } from "vitest";
import { sidebarHarness } from "../helpers/sidebar-harness.js";

const services = [
  {
    kind: "openai",
    label: "OpenAI",
    root: "https://api.openai.com/v1",
    path: "/chat/completions",
    placeholder: "e.g. gpt-6-luna",
  },
  {
    kind: "claude",
    label: "Claude",
    root: "https://api.anthropic.com/v1",
    path: "/messages",
    placeholder: "e.g. claude-haiku-5-5",
  },
  {
    kind: "deepseek",
    label: "DeepSeek",
    root: "https://api.deepseek.com",
    path: "/chat/completions",
    placeholder: "e.g. deepseek-flash",
  },
  {
    kind: "ollama",
    label: "Ollama",
    root: "http://127.0.0.1:11434",
    path: "/api/chat",
    placeholder: "e.g. translategemma:12b",
  },
] as const;

type Harness = ReturnType<typeof sidebarHarness>;
function selectService(h: Harness, kind: string): void {
  h.element("#provider-kind").value = kind;
  h.element("#provider-kind").dispatch("change");
}

describe.each(services)("$label Profile guidance", (service) => {
  it("initializes and resets drafts with the same defaults, without selecting a model", () => {
    const h = sidebarHarness();
    expect(h.evaluate(`providerDrafts.${service.kind}.proxyMode`)).toBe("system");
    expect(h.evaluate(`providerDrafts.${service.kind}.endpoint`)).toBe(service.root);
    h.element("#new-profile").dispatch("click");
    selectService(h, service.kind);
    expect(h.element("#provider-proxy-mode").value).toBe("system");
    expect(h.element("#provider-endpoint").value).toBe(service.root);
    expect(h.element("#provider-model").value).toBe("");
    expect(h.element("#provider-model").placeholder).toBe(service.placeholder);
    expect(h.element("#model-hint").textContent).toBe(
      "Refresh the catalog or enter the exact model ID. Low-effort models are recommended.",
    );
    expect(h.element("#endpoint-hint").textContent).toBe(
      `Enter a HTTP(S) ${service.label} API root. Translation requests append ${service.path}.`,
    );
    expect(h.element("#request-url").textContent).toBe(
      `Actual request:\n${service.root}${service.path}`,
    );
    h.event("pagehide");
  });

  it.each(["Custom name", "", "   "])("resets %j on every Service type change", (name) => {
    const h = sidebarHarness();
    h.element("#new-profile").dispatch("click");
    for (const other of services.filter((entry) => entry.kind !== service.kind)) {
      selectService(h, other.kind);
      h.element("#profile-name").value = name;
      h.element("#profile-name").dispatch("input");
      selectService(h, service.kind);
      expect(h.element("#profile-name").value).toBe(service.label);
      expect(h.evaluate("sidebarState.snapshot.profileName.value")).toBe(service.label);
    }
    h.event("pagehide");
  });

  it.each(["system", "direct"])(
    "refills the saved name and %s route, preserving saved data on Cancel",
    (route) => {
      const h = sidebarHarness();
      const profile = {
        profileId: "saved",
        revision: 1,
        displayName: "Saved custom name",
        kind: service.kind,
        endpoint: "https://fixture.test/custom/v1/",
        model: "custom-model",
        proxyMode: route,
        endpointFingerprint: "fixture",
        credentialConfigured: false,
      };
      h.receive("state:update", { profiles: [profile] });
      h.evaluate('loadEditor(profiles.get("saved"))');
      expect(h.element("#profile-name").value).toBe(profile.displayName);
      expect(h.element("#provider-proxy-mode").value).toBe(route);
      const other = services.find((entry) => entry.kind !== service.kind)!;
      selectService(h, other.kind);
      expect(h.element("#profile-name").value).toBe(other.label);
      expect(h.element("#provider-proxy-mode").value).toBe("system");
      selectService(h, service.kind);
      expect(h.element("#profile-name").value).toBe(service.label);
      expect(h.element("#provider-proxy-mode").value).toBe(route);
      expect(h.element("#provider-endpoint").value).toBe(profile.endpoint);
      expect(h.element("#provider-model").value).toBe(profile.model);
      h.element("#cancel-profile").dispatch("click");
      expect(h.evaluate('profiles.get("saved")')).toEqual(profile);
      expect(h.messages.filter((message) => message.name === "profile:save")).toHaveLength(0);
      h.evaluate('loadEditor(profiles.get("saved"))');
      expect(h.element("#profile-name").value).toBe(profile.displayName);
      expect(h.element("#provider-proxy-mode").value).toBe(route);
      h.event("pagehide");
    },
  );

  it("preserves an explicitly selected draft route across all service switches and resets a new drawer", () => {
    const h = sidebarHarness();
    h.element("#new-profile").dispatch("click");
    selectService(h, service.kind);
    h.element("#provider-proxy-mode").value = "direct";
    h.element("#provider-proxy-mode").dispatch("change");
    for (const other of services.filter((entry) => entry.kind !== service.kind)) {
      selectService(h, other.kind);
      expect(h.element("#provider-proxy-mode").value).toBe("system");
      selectService(h, service.kind);
      expect(h.element("#provider-proxy-mode").value).toBe("direct");
    }
    h.element("#cancel-profile").dispatch("click");
    h.element("#new-profile").dispatch("click");
    selectService(h, service.kind);
    expect(h.element("#provider-proxy-mode").value).toBe("system");
    h.event("pagehide");
  });

  it.each(["", "/", "///"])(
    "previews the translation request live with trailing slash %j",
    (slash) => {
      const h = sidebarHarness();
      h.element("#new-profile").dispatch("click");
      selectService(h, service.kind);
      const root = `https://fixture.test/${"long-path-".repeat(40)}/v1`;
      h.element("#provider-endpoint").value = `  ${root}${slash}  `;
      h.element("#provider-endpoint").dispatch("input");
      expect(h.element("#request-url").textContent).toBe(`Actual request:\n${root}${service.path}`);
      h.event("pagehide");
    },
  );

  it.each([
    "",
    "not-a-url",
    "ftp://fixture.test",
    "https://user:key@fixture.test",
    "https://fixture.test:0",
    "https://fixture.test?query=1",
    "https://fixture.test#fragment",
  ])("shows a dash for invalid root %j", (root) => {
    const h = sidebarHarness();
    h.element("#new-profile").dispatch("click");
    selectService(h, service.kind);
    h.element("#provider-endpoint").value = root;
    h.element("#provider-endpoint").dispatch("input");
    expect(h.element("#request-url").textContent).toBe("Actual request:\n—");
    expect(h.evaluate("validModelEndpoint()")).toBe(false);
    h.event("pagehide");
  });

  it("submits the reset name, system route and any exact model ID for an encrypted save", async () => {
    const h = sidebarHarness();
    h.connectCredentials();
    h.element("#new-profile").dispatch("click");
    const other = services.find((entry) => entry.kind !== service.kind)!;
    selectService(h, other.kind);
    h.element("#profile-name").value = "Custom";
    h.element("#profile-name").dispatch("input");
    selectService(h, service.kind);
    await h.settleCredentials();
    h.evaluate('setModelContext("provider-specific-custom-model")');
    h.element("#save-profile").dispatch("click");
    await h.settleCredentials();
    const prepare = h.messages
      .filter((message) => message.name === "profile:save-prepare")
      .at(-1)!.data;
    expect(prepare.payload.input).toEqual({
      kind: service.kind,
      endpoint: service.root,
      model: "provider-specific-custom-model",
      proxyMode: "system",
      displayName: service.label,
    });
    h.event("pagehide");
  });
});

describe("Claude API root paths", () => {
  it.each([
    ["https://fixture.test", "/v1/messages"],
    ["https://fixture.test/proxy/", "/v1/messages"],
    ["https://fixture.test/v1///", "/messages"],
    ["https://fixture.test/proxy/V1/", "/messages"],
  ])("previews %s with %s", (root, path) => {
    const h = sidebarHarness();
    h.element("#new-profile").dispatch("click");
    selectService(h, "claude");
    h.element("#provider-endpoint").value = root;
    h.element("#provider-endpoint").dispatch("input");
    expect(h.element("#endpoint-hint").textContent).toBe(
      `Enter a HTTP(S) Claude API root. Translation requests append ${path}.`,
    );
    expect(h.element("#request-url").textContent).toBe(
      `Actual request:\n${root.replace(/\/+$/, "")}${path}`,
    );
    h.event("pagehide");
  });

  it.each(["https://fixture.test/v1/messages", "https://fixture.test/v1/models/"])(
    "keeps existing full-resource rejection for %s",
    (root) => {
      const h = sidebarHarness();
      h.element("#new-profile").dispatch("click");
      selectService(h, "claude");
      h.element("#provider-endpoint").value = root;
      h.element("#provider-endpoint").dispatch("input");
      expect(h.element("#request-url").textContent).toBe("Actual request:\n—");
      expect(h.evaluate("validModelEndpoint()")).toBe(false);
      h.event("pagehide");
    },
  );
});
