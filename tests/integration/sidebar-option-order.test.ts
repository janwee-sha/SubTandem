import { describe, expect, it } from "vitest";
import { sidebarHarness } from "../helpers/sidebar-harness.js";
import { UI_LOCALES } from "../../shared/localization/locales.js";
import { TARGET_LANGUAGES } from "../../src/domain/target-languages.js";
import { createOptionDirectory, LOCALE_CATALOGS } from "../../ui/localization.js";
import baseline from "../fixtures/localization/business-values.json";

describe("actual Sidebar named DOM and identity", () => {
  it.each(UI_LOCALES)(
    "sorts targets/services/models/colors without changing values or non-name sequences in %s",
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
      h.evaluate(
        'sidebarState.setModelContext("catalog", "model-2"); sidebarState.applyModelCatalog("catalog", ["éclair", "Alpha", "model-2", "model-10"]); providerModelSelect.focus(); renderModelControl()',
      );
      const models = ["éclair", "Alpha", "model-2", "model-10"].map((id) => ({
        id,
        requestName: id,
      }));
      models.push({
        id: "__custom__",
        requestName: "Custom model ID",
        messageKey: "sidebar.customModelID",
      } as any);
      expect(
        h.evaluate(
          "Array.from(providerModelSelect.options).map(option=>({id:option.value,label:option.textContent}))",
        ),
      ).toEqual(
        projector
          .project(locale, "models", 1, models)
          .options.map(({ id, label }) => ({ id, label })),
      );
      expect(h.element("#provider-model-select").value).toBe("model-2");
      expect(h.evaluate("document.activeElement===providerModelSelect")).toBe(true);
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
