import { describe, expect, it } from "vitest";
import "../../shared/provider-endpoint.js";
const { normalizeProviderEndpoint, providerEndpointIdentity, sameProviderService } = (
  globalThis as typeof globalThis & { subtandemProviderEndpoint: SubtandemProviderEndpointApi }
).subtandemProviderEndpoint;
import { ProviderProfiles } from "../../src/providers/profiles.js";

const kinds = ["openai", "claude", "deepseek", "ollama"] as const;
describe.each(kinds)("%s endpoint identity", (kind) => {
  const endpoint = "https://Example.test:443/Root/%41";
  it.each(["  HTTPS://EXAMPLE.TEST:443/Root/%41///  ", endpoint])(
    "accepts lexical equivalent %s",
    (value) => {
      expect(providerEndpointIdentity(kind, value)).toBe(providerEndpointIdentity(kind, endpoint));
      expect(normalizeProviderEndpoint(kind, value)).toBe(value.trim());
    },
  );
  it.each([
    "http://example.test:443/Root/%41",
    "https://other.test:443/Root/%41",
    "https://example.test/Root/%41",
    "https://example.test:0443/Root/%41",
    "https://example.test:443/root/%41",
    "https://example.test:443/Root/A",
    "https://example.test:443//Root/%41",
    "https://example.test:443/./Root/%41",
    "https://example.test:443/Root/../Root/%41",
  ])("does not expand equivalence for %s", (value) => {
    expect(providerEndpointIdentity(kind, value)).not.toBe(
      providerEndpointIdentity(kind, endpoint),
    );
  });
  it("keeps IPv6 host casing independent from port spelling", () => {
    expect(providerEndpointIdentity(kind, "HTTPS://[ABCD::1]:443/root///")).toBe(
      "https://[abcd::1]:443/root",
    );
  });
  it.each([
    "",
    "ftp://example.test",
    "https://user:pass@example.test",
    "https://example.test:0",
    "https://example.test:65536",
    "https://example.test/a?key=x",
    "https://example.test/#x",
  ])("rejects invalid %s", (value) => {
    expect(() => providerEndpointIdentity(kind, value)).toThrow("INVALID_ENDPOINT");
  });
  it("keeps profile display, revision and fingerprint across hydration", () => {
    const profiles = new ProviderProfiles(() => "profile");
    const saved = profiles.save({
      kind,
      displayName: "Profile",
      endpoint: " HTTPS://Example.test:443/root/// ",
      model: "model",
    });
    expect(saved.endpoint).toBe("HTTPS://Example.test:443/root///");
    const restored = new ProviderProfiles(() => "unused");
    restored.hydrate([saved]);
    expect(restored.get(saved.profileId)).toEqual(saved);
  });
  it("compares kind and route without involving the model", () => {
    const identity = { kind, endpoint, proxyMode: "direct" as const };
    expect(sameProviderService(identity, { ...identity, endpoint: endpoint + "/" })).toBe(true);
    expect(sameProviderService(identity, { ...identity, proxyMode: "system" })).toBe(false);
    expect(
      sameProviderService(identity, { ...identity, kind: kind === "openai" ? "claude" : "openai" }),
    ).toBe(false);
  });
});
