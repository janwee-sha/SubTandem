import { describe, expect, it } from "vitest";
import { sidebarHarness } from "../helpers/sidebar-harness.js";

describe.each(["openai", "claude", "deepseek", "ollama"])(
  "%s Sidebar model cancellation",
  (kind) => {
    it("cleans the pending load on pagehide without dispatching its automatic intent", async () => {
      const h = sidebarHarness();
      h.connectCredentials({ readValue: "synthetic-late-key", deferRead: true });
      const profile = {
        profileId: "saved",
        revision: 1,
        kind,
        displayName: "Saved",
        endpoint: "https://fixture.test",
        model: "model",
        proxyMode: "direct",
        endpointFingerprint: "fingerprint",
        credentialConfigured: true,
      };
      h.receive("state:update", { profiles: [profile] });
      h.evaluate('loadEditor(profiles.get("saved"))');
      await h.settleCredentials();
      h.event("pagehide");
      h.releaseCredentialReads();
      await h.settleCredentials();
      expect(h.element("#provider-key").value).toBe("");
      expect(h.messages.filter((entry) => entry.name === "provider:models")).toHaveLength(0);
      expect(h.evaluate("sidebarState.snapshot.credentialLoad")).toBeNull();
      expect(h.evaluate("sidebarState.snapshot.pendingAutomaticRefresh")).toBeNull();
    });
    it.each(["#provider-key", "#provider-endpoint", "#provider-proxy-mode", "#provider-kind"])(
      "cancels the old request when %s changes",
      async (field) => {
        const h = sidebarHarness();
        h.connectCredentials();
        h.evaluate("sidebarState.openNewProfileDrawer()");
        h.evaluate(
          `providerKind.value = ${JSON.stringify(kind)}; applyProviderKind(); requestModels("manual");`,
        );
        await h.settleCredentials();
        const old = h.messages.filter((m) => m.name === "provider:draft-models").at(-1)!;
        const count = h.messages.length;
        h.element(field).value =
          field === "#provider-key"
            ? "draft-key"
            : field === "#provider-kind"
              ? "openai"
              : field === "#provider-proxy-mode"
                ? "direct"
                : "https://another.test/v1";
        h.element(field).dispatch(
          field === "#provider-key" || field === "#provider-endpoint" ? "input" : "change",
        );
        expect(
          h.messages
            .slice(count)
            .some(
              (m) =>
                m.name === "provider:models-cancel" &&
                m.data.payload.modelRequestId === old.data.requestId,
            ),
        ).toBe(true);
        expect(
          h.messages
            .slice(count)
            .filter((m) => m.name === "provider:models" && m.data.payload.trigger === "credential"),
        ).toHaveLength(0);
      },
    );
    it("keeps a newer busy state after late success and cancels on pagehide", async () => {
      const h = sidebarHarness();
      h.connectCredentials();
      h.evaluate("sidebarState.openNewProfileDrawer()");
      h.evaluate(
        `providerKind.value = ${JSON.stringify(kind)}; applyProviderKind(); requestModels("manual");`,
      );
      await h.settleCredentials();
      const old = h.messages.filter((m) => m.name === "provider:draft-models").at(-1)!;
      h.evaluate('requestModels("manual")');
      await h.settleCredentials();
      const next = h.messages.filter((m) => m.name === "provider:draft-models").at(-1)!;
      h.receive("provider:models-result", {
        requestId: old.data.requestId,
        ok: true,
        contextKey: "old",
        models: ["stale"],
      });
      expect(h.evaluate("pendingModelRefresh.requestId")).toBe(next.data.requestId);
      h.event("pagehide");
      expect(h.messages.at(-1)).toMatchObject({
        name: "provider:models-cancel",
        data: { payload: { modelRequestId: next.data.requestId } },
      });
      expect(h.evaluate("pendingModelRefresh")).toBeNull();
    });
  },
);
