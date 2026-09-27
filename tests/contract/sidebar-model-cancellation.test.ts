import { describe, expect, it } from "vitest";
import { sidebarHarness } from "../helpers/sidebar-harness.js";

describe.each(["openai", "claude", "deepseek", "ollama"])(
  "%s Sidebar model cancellation",
  (kind) => {
    it.each(["#provider-key", "#provider-endpoint", "#provider-proxy-mode", "#provider-kind"])(
      "cancels the old request when %s changes",
      (field) => {
        const h = sidebarHarness();
        h.evaluate(
          `providerKind.value = ${JSON.stringify(kind)}; applyProviderKind(); requestModels("manual");`,
        );
        const old = h.messages.filter((m) => m.name === "provider:models").at(-1)!;
        const count = h.messages.length;
        h.element(field).value =
          field === "#provider-key"
            ? "draft-key"
            : field === "#provider-kind"
              ? "openai"
              : field === "#provider-proxy-mode"
                ? "system"
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
    it("keeps a newer busy state after late success and cancels on pagehide", () => {
      const h = sidebarHarness();
      h.evaluate(
        `providerKind.value = ${JSON.stringify(kind)}; applyProviderKind(); requestModels("manual");`,
      );
      const old = h.messages.filter((m) => m.name === "provider:models").at(-1)!;
      h.evaluate('requestModels("manual")');
      const next = h.messages.filter((m) => m.name === "provider:models").at(-1)!;
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
