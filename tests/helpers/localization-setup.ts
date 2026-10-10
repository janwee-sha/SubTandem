import { createLocalizationRuntime } from "../../ui/localization.js";
(globalThis as typeof globalThis & Window).subtandemLocalization = createLocalizationRuntime();
