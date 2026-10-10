import type { UiLocale } from "./locales.js";

export type UiSampleFailure =
  "legacyHost" | "unknownVersion" | "unavailable" | "readFailed" | "emptyResult" | "invalidResult";

export interface HostUiSample {
  readonly hostVersion: string | null;
  readonly preferredLocalization: string | null;
  readonly failure: UiSampleFailure | null;
}

export interface HostUiContext {
  readonly authorityId: string;
  readonly locale: UiLocale;
  readonly direction: "ltr" | "rtl";
  readonly hostVersion: string | null;
  readonly hostLocalization: string | null;
  readonly fallbackReason: UiSampleFailure | "unsupportedLocale" | null;
}

export type MessageParamType = "text" | "technical" | "nonNegativeInteger";
export type MessageParams = Readonly<Record<string, string | number>>;
export interface MessageDefinition {
  readonly params: Readonly<Record<string, MessageParamType>>;
  readonly pluralParam?: string;
  readonly surfaces: readonly ("sidebar" | "native" | "metadata")[];
}

export type CardinalCategory = "zero" | "one" | "two" | "few" | "many" | "other";
export type MessageTemplate = string | Partial<Record<CardinalCategory, string>>;
export interface LocaleCatalog {
  readonly locale: UiLocale;
  readonly messages: Readonly<Record<string, MessageTemplate>>;
  readonly targetLanguageNames: Readonly<Record<string, string>>;
  readonly namedColorNames: Readonly<Record<string, string>>;
}

export interface LocalizedFeedback {
  readonly messageKey: string;
  readonly params: MessageParams;
}

export interface SelectableOptionView {
  readonly id: string;
  readonly displayName: string;
  readonly label: string;
}
