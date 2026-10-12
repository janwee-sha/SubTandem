import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import business from "../fixtures/localization/business-values.json";
import baseline from "../fixtures/localization/translation-request-baseline.json";
import { UI_LOCALES } from "../../shared/localization/locales.js";
import { TARGET_LANGUAGES } from "../../src/domain/target-languages.js";
import { TargetLanguageSession } from "../../src/app/target-language-session.js";
import { createOptionDirectory } from "../../ui/localization.js";
import {
  buildTranslationTask,
  buildOllamaTranslationTask,
  buildDeepSeekTranslationTask,
  buildClaudeTranslationTask,
} from "../../src/providers/translation-task.js";
const builders = {
  openai: buildTranslationTask,
  ollama: buildOllamaTranslationTask,
  deepseek: buildDeepSeekTranslationTask,
  claude: buildClaudeTranslationTask,
};
describe("localized display preserves complete production translation tasks", () => {
  it.each(UI_LOCALES)(
    "keeps all 156 business identities and four request builders in %s",
    (locale) => {
      const directory = createOptionDirectory().project(locale, "targets", 1, TARGET_LANGUAGES);
      expect(directory.effectiveLocale).toBe(locale);
      expect(directory.options).toHaveLength(156);
      for (const target of business.targetLanguages) {
        expect(TARGET_LANGUAGES.find(({ id }) => id === target.id)).toEqual(target);
        const session = new TargetLanguageSession(target.id);
        expect(directory.options.find(({ id }) => id === target.id)).toBeDefined();
        for (const [kind, builder] of Object.entries(builders)) {
          const task = builder({ targetLanguage: target.id, targets: baseline.targets });
          expect(createHash("sha256").update(JSON.stringify(task)).digest("hex")).toBe(
            baseline.hashes[target.id as keyof typeof baseline.hashes][
              kind as keyof typeof builders
            ],
          );
          expect(task.userMessage).toContain(target.providerLabel);
        }
        expect(session.snapshot).toEqual({ targetLanguage: target.id, revision: 1 });
        expect(session.pendingSave).toBeNull();
      }
    },
  );
});
