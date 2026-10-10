import type { createLocalizationRuntime } from "./localization.js";
import type { LocalizedFeedback as SharedLocalizedFeedback } from "../shared/localization/types.js";

declare global {
  interface Window {
    iina?: {
      postMessage(name: string, data: unknown): void;
      onMessage(name: string, callback: (data: unknown) => void): void;
    };
    subtandemLocalization: ReturnType<typeof createLocalizationRuntime>;
    subtandemProviderEndpoint: SubtandemProviderEndpointApi;
  }
  type LocalizedFeedback = SharedLocalizedFeedback;
}
