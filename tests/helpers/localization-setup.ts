import { createLocalizationRuntime } from "../../src/ui/localization.js";
(globalThis as typeof globalThis & Window).subtandemLocalization = createLocalizationRuntime();
