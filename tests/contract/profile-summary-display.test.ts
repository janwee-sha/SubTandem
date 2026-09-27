import { describe, expect, it } from "vitest";
import { sidebarHarness } from "../helpers/sidebar-harness.js";

const labels = {
  openai: "OpenAI",
  claude: "Claude",
  deepseek: "DeepSeek",
  ollama: "Ollama",
} as const;

describe("saved Profile summary", () => {
  it.each(Object.entries(labels))(
    "shows %s with only three saved display fields",
    (kind, label) => {
      for (const proxyMode of ["direct", "system"] as const)
        for (const credentialConfigured of [false, true])
          for (const model of [undefined, "model-v2"]) {
            const h = sidebarHarness();
            const profile = {
              profileId: "saved",
              revision: 3,
              endpointFingerprint: "fingerprint",
              displayName: "My profile",
              kind,
              endpoint: "https://provider.example/v1",
              proxyMode,
              credentialConfigured,
              model,
            };
            const row = h.evaluate(`createProfileRow(${JSON.stringify(profile)})`);
            expect(row.querySelector("strong").textContent).toBe("My profile");
            expect(row.querySelector(".profile-summary").textContent).toBe(
              model ? `${label} · ${model}` : label,
            );
            expect(row.querySelector("code").textContent).toBe("https://provider.example/v1");
            expect(
              [
                row.querySelector("strong").textContent,
                row.querySelector(".profile-summary").textContent,
                row.querySelector("code").textContent,
              ].join(" "),
            ).not.toMatch(/macOS proxy|direct|key saved|no key saved|secret-key/);
          }
    },
  );

  it("keeps special characters as text in all display fields", () => {
    const h = sidebarHarness();
    const profile = {
      profileId: "special",
      revision: 1,
      endpointFingerprint: "fingerprint",
      displayName: "<Name & Co>",
      kind: "openai",
      endpoint: "https://example.test/?a=1&b=<value>",
      model: "<model>&",
      proxyMode: "direct",
      credentialConfigured: true,
    };
    const row = h.evaluate(`createProfileRow(${JSON.stringify(profile)})`);
    expect(row.querySelector("strong").textContent).toBe(profile.displayName);
    expect(row.querySelector(".profile-summary").textContent).toBe("OpenAI · <model>&");
    expect(row.querySelector("code").textContent).toBe(profile.endpoint);
  });
});
