import { describe, expect, it } from "vitest";
import { sidebarHarness } from "../helpers/sidebar-harness.js";
import { UI_LOCALES } from "../../src/shared/localization/locales.js";
import { TARGET_LANGUAGES } from "../../src/runtime/domain/target-languages.js";
import {
  createLocalizer,
  createOptionDirectory,
  LOCALE_CATALOGS,
} from "../../src/ui/localization.js";
import baseline from "../fixtures/localization/business-values.json";

describe("actual Sidebar named DOM and identity", () => {
  it.each(UI_LOCALES)(
    "sorts named options and pins custom model IDs without changing values in %s",
    (locale) => {
      const h = sidebarHarness({ locale });
      const numeric = h.evaluate("Array.from(fontSizeSelect.options).map(option=>option.value)");
      h.receive("state:update", {
        status: "disabled",
        targetLanguages: TARGET_LANGUAGES,
        targetLanguage: "zh-Hant",
        targetLanguageRevision: 1,
        profiles: [],
        profileListPhase: "settled",
      });
      const projector = createOptionDirectory();
      const target = projector.project(locale, "targets", 1, TARGET_LANGUAGES).options;
      expect(
        h.evaluate(
          "Array.from(targetLanguage.options).map(option=>({id:option.value,label:option.textContent}))",
        ),
      ).toEqual(target.map(({ id, label }) => ({ id, label })));
      expect(h.element("#target-language").value).toBe("zh-Hant");
      expect(h.messages.filter((message) => message.name === "target-language:save")).toHaveLength(
        0,
      );
      const colorOptions = projector.project(
        locale,
        "colors",
        1,
        baseline.namedColors.map(({ id }) => ({
          id,
          requestName: LOCALE_CATALOGS.en.namedColorNames[id]!,
        })),
      ).options;
      const colors = h.evaluate(
        'Array.from(colorPalette.querySelector(".subtitle-color-favorites").querySelectorAll("button")).map(button=>({id:button.dataset.colorId,label:button.getAttribute("aria-label"),rgba:button.dataset.rgba}))',
      );
      expect(colors.map(({ id, label }: any) => ({ id, label }))).toEqual(
        colorOptions.map(({ id, label }) => ({ id, label })),
      );
      for (const color of colors)
        expect(color.rgba).toBe(
          baseline.namedColors.find(({ id }) => id === color.id)!.rgba.join(","),
        );
      const serviceItems = [
        { id: "openai", requestName: "OpenAI" },
        { id: "claude", requestName: "Claude" },
        { id: "deepseek", requestName: "DeepSeek" },
        { id: "ollama", requestName: "Ollama" },
      ];
      expect(h.evaluate("Array.from(providerKind.options).map(option=>option.value)")).toEqual(
        projector.project(locale, "services", 1, serviceItems).options.map(({ id }) => id),
      );
      expect(h.element("#provider-kind").value).toBe("openai");
      const customLabel = createLocalizer(locale).format("sidebar.customModelID");
      const modelIds = ["éclair", "Alpha", "model-2", "model-10"];
      for (const kind of ["openai", "claude", "deepseek", "ollama"]) {
        h.evaluate(`providerKind.value = ${JSON.stringify(kind)}; applyProviderKind()`);
        expect(
          h.evaluate(
            "Array.from(providerModelSelect.options).map(option=>({id:option.value,label:option.textContent}))",
          ),
        ).toEqual([{ id: "__custom__", label: customLabel }]);
        const contextKey = `catalog-${kind}`;
        h.evaluate(
          `setModelContext("model-2", {contextKey:${JSON.stringify(contextKey)},models:${JSON.stringify(modelIds)}}); providerModelSelect.focus()`,
        );
        const models = [
          ...modelIds.map((id) => ({ id, requestName: id })),
          {
            id: "__custom__",
            requestName: "Custom model ID",
            messageKey: "sidebar.customModelID",
          },
        ];
        const options = h.evaluate(
          "Array.from(providerModelSelect.options).map(option=>({id:option.value,label:option.textContent}))",
        );
        expect(options[0]).toEqual({ id: "__custom__", label: customLabel });
        expect(options.slice(1)).toEqual(
          projector
            .project(locale, "models", kind, models)
            .options.filter(({ id }) => id !== "__custom__")
            .map(({ id, label }) => ({ id, label })),
        );
        expect(h.element("#provider-model-select").value).toBe("model-2");
        expect(h.element("#provider-model").hidden).toBe(true);
        expect(h.evaluate("document.activeElement===providerModelSelect")).toBe(true);
        h.element("#provider-model-select").value = "__custom__";
        h.element("#provider-model-select").dispatch("change");
        expect(h.evaluate("document.activeElement===providerModel")).toBe(true);
        h.element("#provider-model").value = "namespace/custom:v2";
        h.element("#provider-model").dispatch("input");
        const refreshedIds = [...modelIds, customLabel];
        h.evaluate(
          `sidebarState.applyModelCatalog(${JSON.stringify(contextKey)}, ${JSON.stringify(refreshedIds)}); renderModelControl()`,
        );
        const refreshed = h.evaluate(
          "Array.from(providerModelSelect.options).map(option=>({id:option.value,label:option.textContent}))",
        );
        expect(refreshed[0]).toEqual({
          id: "__custom__",
          label: `${customLabel} [__custom__]`,
        });
        expect(refreshed.slice(1)).toEqual(
          projector
            .project(locale, "models", `${kind}-refresh`, [
              ...models,
              { id: customLabel, requestName: customLabel },
            ])
            .options.filter(({ id }) => id !== "__custom__")
            .map(({ id, label }) => ({ id, label })),
        );
        expect(h.element("#provider-model-select").value).toBe("__custom__");
        expect(h.element("#provider-model").value).toBe("namespace/custom:v2");
        expect(h.element("#provider-model").hidden).toBe(false);
        expect(h.element("#provider-model").required).toBe(true);
        expect(h.evaluate("document.activeElement===providerModel")).toBe(true);
        h.evaluate(
          `sidebarState.applyModelCatalog(${JSON.stringify(contextKey)}, []); renderModelControl()`,
        );
        expect(
          h.evaluate(
            "Array.from(providerModelSelect.options).map(option=>({id:option.value,label:option.textContent}))",
          ),
        ).toEqual([{ id: "__custom__", label: customLabel }]);
        expect(h.element("#provider-model-select").value).toBe("__custom__");
        expect(h.element("#provider-model").value).toBe("namespace/custom:v2");
      }
      expect(h.evaluate("Array.from(fontSizeSelect.options).map(option=>option.value)")).toEqual(
        numeric,
      );
      const grid = h.evaluate(
        'Array.from(subtitleColorGrid.querySelectorAll("button")).map(button=>button.dataset.rgba)',
      );
      h.receive("state:update", {
        status: "disabled",
        targetLanguages: TARGET_LANGUAGES,
        targetLanguage: "zh-Hant",
        targetLanguageRevision: 1,
      });
      expect(
        h.evaluate(
          'Array.from(subtitleColorGrid.querySelectorAll("button")).map(button=>button.dataset.rgba)',
        ),
      ).toEqual(grid);
      h.event("pagehide");
    },
  );
});
