import { parseSidebarStateUpdate } from "../src/domain/messages.js";
import { canonicalUiLocale, isUiLocale, type UiLocale } from "../shared/localization/locales.js";
import { MESSAGE_DEFINITIONS } from "../shared/localization/message-definitions.js";
import af from "../shared/localization/catalogs/af.json";
import ca from "../shared/localization/catalogs/ca.json";
import cs from "../shared/localization/catalogs/cs.json";
import da from "../shared/localization/catalogs/da.json";
import de from "../shared/localization/catalogs/de.json";
import en from "../shared/localization/catalogs/en.json";
import en_GB from "../shared/localization/catalogs/en-GB.json";
import es from "../shared/localization/catalogs/es.json";
import fi from "../shared/localization/catalogs/fi.json";
import fr from "../shared/localization/catalogs/fr.json";
import he from "../shared/localization/catalogs/he.json";
import hi from "../shared/localization/catalogs/hi.json";
import hr from "../shared/localization/catalogs/hr.json";
import hu from "../shared/localization/catalogs/hu.json";
import id from "../shared/localization/catalogs/id.json";
import it from "../shared/localization/catalogs/it.json";
import ja from "../shared/localization/catalogs/ja.json";
import ko from "../shared/localization/catalogs/ko.json";
import nl from "../shared/localization/catalogs/nl.json";
import pl from "../shared/localization/catalogs/pl.json";
import pt from "../shared/localization/catalogs/pt.json";
import pt_BR from "../shared/localization/catalogs/pt-BR.json";
import ro from "../shared/localization/catalogs/ro.json";
import ru from "../shared/localization/catalogs/ru.json";
import sk from "../shared/localization/catalogs/sk.json";
import sr_Latn from "../shared/localization/catalogs/sr-Latn.json";
import sv from "../shared/localization/catalogs/sv.json";
import tr from "../shared/localization/catalogs/tr.json";
import uk from "../shared/localization/catalogs/uk.json";
import zh_Hans from "../shared/localization/catalogs/zh-Hans.json";
import zh_Hant from "../shared/localization/catalogs/zh-Hant.json";
import type {
  LocaleCatalog,
  LocalizedFeedback,
  MessageDefinition,
  MessageParams,
  MessageTemplate,
  SelectableOptionView,
} from "../shared/localization/types.js";

export const LOCALE_CATALOGS: Readonly<Record<UiLocale, LocaleCatalog>> = {
  af: af as LocaleCatalog,
  ca: ca as LocaleCatalog,
  cs: cs as LocaleCatalog,
  da: da as LocaleCatalog,
  de: de as LocaleCatalog,
  en: en as LocaleCatalog,
  "en-GB": en_GB as LocaleCatalog,
  es: es as LocaleCatalog,
  fi: fi as LocaleCatalog,
  fr: fr as LocaleCatalog,
  he: he as LocaleCatalog,
  hi: hi as LocaleCatalog,
  hr: hr as LocaleCatalog,
  hu: hu as LocaleCatalog,
  id: id as LocaleCatalog,
  it: it as LocaleCatalog,
  ja: ja as LocaleCatalog,
  ko: ko as LocaleCatalog,
  nl: nl as LocaleCatalog,
  pl: pl as LocaleCatalog,
  pt: pt as LocaleCatalog,
  "pt-BR": pt_BR as LocaleCatalog,
  ro: ro as LocaleCatalog,
  ru: ru as LocaleCatalog,
  sk: sk as LocaleCatalog,
  "sr-Latn": sr_Latn as LocaleCatalog,
  sv: sv as LocaleCatalog,
  tr: tr as LocaleCatalog,
  uk: uk as LocaleCatalog,
  "zh-Hans": zh_Hans as LocaleCatalog,
  "zh-Hant": zh_Hant as LocaleCatalog,
};

export interface LocalizerOptions {
  catalogs?: Readonly<Partial<Record<UiLocale, LocaleCatalog>>>;
  intl?: typeof Intl | null;
}

function sameKeys(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join("\u0000") === [...right].sort().join("\u0000");
}

export function validMessageTemplate(
  template: unknown,
  definition: MessageDefinition,
  categories: readonly string[],
): template is MessageTemplate {
  const validText = (value: unknown): value is string => {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      /<\/?[A-Za-z][^>]*>/.test(value) ||
      Array.from(value).some(
        (character) =>
          character.charCodeAt(0) < 32 && ![9, 10, 13].includes(character.charCodeAt(0)),
      )
    )
      return false;
    const params = [...value.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((match) => match[1]!);
    return (
      sameKeys([...new Set(params)], Object.keys(definition.params)) &&
      !/[{}]/.test(value.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, ""))
    );
  };
  if (!definition.pluralParam) return validText(template);
  if (template === null || typeof template !== "object" || Array.isArray(template)) return false;
  const variants = template as Record<string, unknown>;
  return (
    sameKeys(Object.keys(variants), categories) &&
    categories.every((category) => validText(variants[category]))
  );
}

function validatedParams(params: unknown, definition: MessageDefinition): MessageParams | null {
  if (params === null || typeof params !== "object" || Array.isArray(params)) return null;
  const names = Reflect.ownKeys(params);
  if (
    names.some((name) => typeof name !== "string") ||
    !sameKeys(names as string[], Object.keys(definition.params))
  )
    return null;
  const descriptors = Object.getOwnPropertyDescriptors(params);
  const values: Record<string, string | number> = {};
  for (const [name, type] of Object.entries(definition.params)) {
    const descriptor = descriptors[name];
    if (!descriptor || !("value" in descriptor)) return null;
    const value: unknown = descriptor.value;
    if (type === "nonNegativeInteger") {
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
    } else if (typeof value !== "string") return null;
    values[name] = value as string | number;
  }
  return values;
}

export function hasIntlCapability(
  intl: typeof Intl | null,
  locale: UiLocale,
  capability: "PluralRules" | "NumberFormat" | "Collator",
): boolean {
  try {
    if (typeof intl?.[capability] !== "function") return false;
    const constructor = intl[capability] as unknown as {
      supportedLocalesOf(locales: string[], options: { localeMatcher: "lookup" }): string[];
    };
    return constructor.supportedLocalesOf([locale], { localeMatcher: "lookup" }).length === 1;
  } catch {
    return false;
  }
}

export function createLocalizer(requestedLocale: unknown, options: LocalizerOptions = {}) {
  const locale = canonicalUiLocale(requestedLocale) ?? "en";
  const catalogs = options.catalogs ?? LOCALE_CATALOGS;
  const intl =
    options.intl === undefined ? (typeof Intl === "undefined" ? null : Intl) : options.intl;
  const definitions: Readonly<Record<string, MessageDefinition>> = MESSAGE_DEFINITIONS;
  const generic = en.messages["feedback.generic"];
  const formatInteger = (value: number, formatLocale: UiLocale): string | null => {
    try {
      if (!hasIntlCapability(intl, formatLocale, "NumberFormat")) return null;
      const result = new intl!.NumberFormat(formatLocale).format(value);
      return typeof result === "string" && result.trim() ? result : null;
    } catch {
      return null;
    }
  };
  const format = (key: string, rawParams: MessageParams = {}): string => {
    try {
      const definition = Object.prototype.hasOwnProperty.call(definitions, key)
        ? definitions[key]
        : undefined;
      if (!definition) return generic;
      const params = validatedParams(rawParams, definition);
      if (!params) return generic;
      const attempt = (
        formatLocale: UiLocale,
        catalog: LocaleCatalog | undefined,
        deterministic = false,
      ): string | null => {
        try {
          let categories: readonly string[] = ["one", "other"];
          let category =
            definition.pluralParam && params[definition.pluralParam] === 1 ? "one" : "other";
          if (!deterministic) {
            if (
              !hasIntlCapability(intl, formatLocale, "PluralRules") ||
              !hasIntlCapability(intl, formatLocale, "NumberFormat")
            )
              return null;
            const rules = new intl!.PluralRules(formatLocale, { type: "cardinal" });
            categories = rules.resolvedOptions().pluralCategories;
            if (
              !Array.isArray(categories) ||
              !categories.includes("other") ||
              categories.some(
                (value) => !["zero", "one", "two", "few", "many", "other"].includes(value),
              )
            )
              return null;
            if (definition.pluralParam)
              category = rules.select(params[definition.pluralParam] as number);
            if (!categories.includes(category)) return null;
          }
          const template = catalog?.messages[key];
          if (!validMessageTemplate(template, definition, categories)) return null;
          const text =
            typeof template === "string" ? template : template[category as keyof typeof template];
          if (typeof text !== "string") return null;
          const replacements: Record<string, string> = {};
          for (const [name, type] of Object.entries(definition.params)) {
            const value = params[name]!;
            if (type === "nonNegativeInteger") {
              const number = deterministic
                ? String(value)
                : formatInteger(value as number, formatLocale);
              if (number === null) return null;
              replacements[name] = number;
            } else
              replacements[name] = `${type === "technical" ? "\u2066" : "\u2068"}${value}\u2069`;
          }
          return text.replace(
            /\{([A-Za-z][A-Za-z0-9]*)\}/g,
            (_match, name: string) => replacements[name]!,
          );
        } catch {
          return null;
        }
      };
      return (
        attempt(locale, catalogs[locale]) ??
        attempt("en", en as LocaleCatalog) ??
        attempt("en", en as LocaleCatalog, true) ??
        generic
      );
    } catch {
      return generic;
    }
  };
  return {
    locale,
    format,
    number: (value: number): string =>
      Number.isSafeInteger(value) && value >= 0
        ? (formatInteger(value, locale) ?? formatInteger(value, "en") ?? String(value))
        : "—",
    colorName: (id: string): string => {
      const label = catalogs[locale]?.namedColorNames[id];
      return typeof label === "string" && label.trim() && !/<\/?[A-Za-z][^>]*>/.test(label)
        ? label
        : (en.namedColorNames[id as keyof typeof en.namedColorNames] ??
            en.messages["feedback.generic"]);
    },
    feedback: (value: LocalizedFeedback | null): string | null =>
      value === null ? null : format(value.messageKey, value.params),
  };
}

export type OptionDirectoryKind = "targets" | "colors" | "services" | "models";
export interface NamedOptionSource {
  readonly id: string;
  readonly requestName: string;
  readonly messageKey?: string;
}
export interface OptionDirectory {
  readonly locale: UiLocale;
  readonly effectiveLocale: UiLocale;
  readonly options: readonly SelectableOptionView[];
}
const codepointCompare = (left: string, right: string): number => {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index++) {
    const comparison = leftPoints[index]! - rightPoints[index]!;
    if (comparison) return comparison;
  }
  return leftPoints.length - rightPoints.length;
};

export function createOptionDirectory(options: LocalizerOptions = {}) {
  const catalogs = options.catalogs ?? LOCALE_CATALOGS;
  const intl =
    options.intl === undefined ? (typeof Intl === "undefined" ? null : Intl) : options.intl;
  const cache = new Map<string, OptionDirectory>();
  const project = (
    requestedLocale: unknown,
    kind: OptionDirectoryKind,
    revision: string | number,
    items: readonly NamedOptionSource[],
  ): OptionDirectory => {
    const locale = canonicalUiLocale(requestedLocale) ?? "en";
    const cacheKey = JSON.stringify([locale, kind, revision]);
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    const attempt = (effectiveLocale: UiLocale, deterministic = false): OptionDirectory | null => {
      try {
        if (!deterministic && !hasIntlCapability(intl, effectiveLocale, "Collator")) return null;
        const compare = deterministic
          ? codepointCompare
          : new intl!.Collator(effectiveLocale, {
              usage: "sort",
              sensitivity: "variant",
              numeric: false,
            }).compare;
        const localizer = createLocalizer(effectiveLocale, { ...options, catalogs });
        const source = effectiveLocale === "en" ? (en as LocaleCatalog) : catalogs[effectiveLocale];
        const names =
          kind === "targets"
            ? source?.targetLanguageNames
            : kind === "colors"
              ? source?.namedColorNames
              : null;
        const englishNames =
          kind === "targets"
            ? en.targetLanguageNames
            : kind === "colors"
              ? en.namedColorNames
              : null;
        const views = items.map((item) => {
          const candidate = names?.[item.id];
          const displayName = names
            ? typeof candidate === "string" &&
              candidate.trim() &&
              !/<\/?[A-Za-z][^>]*>/.test(candidate)
              ? candidate
              : ((englishNames as Readonly<Record<string, string>> | null)?.[item.id] ??
                item.requestName)
            : item.messageKey
              ? localizer.format(item.messageKey)
              : item.requestName;
          return { id: item.id, displayName, label: displayName };
        });
        for (const view of views)
          if (
            views.some(
              (other) => view !== other && compare(view.displayName, other.displayName) === 0,
            )
          )
            view.label = `${view.displayName} [${view.id}]`;
        views.sort(
          (left, right) => compare(left.label, right.label) || codepointCompare(left.id, right.id),
        );
        return Object.freeze({
          locale,
          effectiveLocale,
          options: Object.freeze(views.map((view) => Object.freeze(view))),
        });
      } catch {
        return null;
      }
    };
    const result = attempt(locale) ?? attempt("en") ?? attempt("en", true)!;
    cache.set(cacheKey, result);
    return result;
  };
  const filter = (directory: OptionDirectory, query: string): readonly SelectableOptionView[] => {
    const normalize = (value: string): string =>
      value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase(directory.effectiveLocale);
    const search = normalize(query.trim());
    return search
      ? directory.options.filter(
          (option) =>
            normalize(option.label).includes(search) || normalize(option.id).includes(search),
        )
      : directory.options;
  };
  return { project, filter, clear: () => cache.clear() };
}

export function createLocalizationRuntime(initialLocale: unknown = "en") {
  let current = createLocalizer(initialLocale);
  const directory = createOptionDirectory();
  return {
    options(
      kind: OptionDirectoryKind,
      revision: string | number,
      items: readonly NamedOptionSource[],
    ) {
      return directory.project(current.locale, kind, revision, items).options;
    },
    clearDirectories() {
      directory.clear();
    },
    parseSnapshot(value: unknown) {
      try {
        return parseSidebarStateUpdate(value);
      } catch {
        console.warn("INVALID_SIDEBAR_LANGUAGE_SNAPSHOT");
        try {
          if (!value || typeof value !== "object" || Array.isArray(value)) return null;
          const snapshot = value as Record<string, unknown>;
          const context = snapshot.uiLanguage;
          if (!context || typeof context !== "object" || Array.isArray(context)) return null;
          const language = context as Record<string, unknown>;
          if (
            isUiLocale(language.locale) &&
            language.direction === (language.locale === "he" ? "rtl" : "ltr")
          )
            return null;
          return parseSidebarStateUpdate({
            ...snapshot,
            uiLanguage: {
              ...language,
              locale: "en",
              direction: "ltr",
              hostVersion: null,
              hostLocalization: null,
              fallbackReason: "unknownVersion",
            },
          });
        } catch {
          return null;
        }
      }
    },
    message(messageKey: string, params: MessageParams = {}): LocalizedFeedback {
      return { messageKey, params };
    },
    get locale() {
      return current.locale;
    },
    setLocale(locale: unknown) {
      current = createLocalizer(locale);
    },
    format(key: string, params: MessageParams = {}) {
      return current.format(key, params);
    },
    feedback(value: LocalizedFeedback | null) {
      return current.feedback(value);
    },
    colorName(id: string) {
      return current.colorName(id);
    },
    number(value: number) {
      return current.number(value);
    },
  };
}

if (typeof window !== "undefined") window.subtandemLocalization = createLocalizationRuntime();
