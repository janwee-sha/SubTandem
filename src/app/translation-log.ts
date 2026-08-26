export interface TranslationComparison {
  contextBefore?: string;
  source: string;
  contextAfter?: string;
  translation: string;
}

function formatField(label: string, value: string | undefined): string {
  const lines = (value ?? "(none)").replace(/\r\n?/g, "\n").split("\n");
  return `${label}:\n${lines.map((line) => `  ${line}`).join("\n")}`;
}

export function formatTranslationComparison(comparison: TranslationComparison): string {
  return [
    "\n--------------------------------------------",
    formatField("Context before", comparison.contextBefore),
    formatField("Source cue", comparison.source),
    formatField("Context after", comparison.contextAfter),
    formatField("Translation", comparison.translation),
    "--------------------------------------------",
  ].join("\n");
}
