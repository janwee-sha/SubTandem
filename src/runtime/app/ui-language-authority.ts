import { canonicalUiLocale } from "../../shared/localization/locales.js";
import type { HostUiContext } from "../../shared/localization/types.js";
import { parseHostUiSample } from "../domain/messages.js";

export class UiLanguageAuthority {
  private resolved: HostUiContext | null = null;

  constructor(private readonly authorityId: string) {}

  get context(): HostUiContext | null {
    return this.resolved;
  }

  resolve(value: unknown): HostUiContext {
    const sample = parseHostUiSample(value);
    if (this.resolved) return this.resolved;
    const match = sample.failure === null ? canonicalUiLocale(sample.preferredLocalization) : null;
    const locale = match ?? "en";
    this.resolved = Object.freeze({
      authorityId: this.authorityId,
      locale,
      direction: locale === "he" ? "rtl" : "ltr",
      hostVersion: sample.hostVersion,
      hostLocalization: sample.preferredLocalization,
      fallbackReason: sample.failure ?? (match ? null : "unsupportedLocale"),
    });
    return this.resolved;
  }
}
