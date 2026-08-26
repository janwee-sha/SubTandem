export type LanguageEquivalence = "base" | "exact-script" | "exact-region";

export interface TargetLanguageOption {
  readonly id: string;
  readonly displayName: string;
  readonly providerLabel: string;
  readonly detectorCode?: string;
  readonly equivalence: LanguageEquivalence;
  readonly order: number;
}

const entries = [
  ["ab", "Abkhazian"],
  ["sq", "Albanian"],
  ["aa", "Afar"],
  ["ak", "Akan"],
  ["ar", "Arabic", "arb"],
  ["am", "Amharic", "amh"],
  ["as", "Assamese"],
  ["az", "Azerbaijani", "azj"],
  ["ee", "Ewe"],
  ["ay", "Aymara"],
  ["ga", "Irish"],
  ["et", "Estonian"],
  ["oc", "Occitan"],
  ["or", "Odia"],
  ["om", "Oromo"],
  ["os", "Ossetian"],
  ["ba", "Bashkir"],
  ["eu", "Basque"],
  ["be", "Belarusian", "bel"],
  ["pam", "Kapampangan"],
  ["bg", "Bulgarian", "bul"],
  ["nso", "Northern Sotho"],
  ["is", "Icelandic"],
  ["pl", "Polish", "pol"],
  ["bs", "Bosnian", "bos"],
  ["fa", "Persian", "pes"],
  ["bho", "Bhojpuri", "bho"],
  ["br", "Breton"],
  ["bo", "Tibetan"],
  ["tn", "Tswana"],
  ["ts", "Tsonga"],
  ["tt", "Tatar"],
  ["da", "Danish"],
  ["de", "German", "deu"],
  ["dv", "Dhivehi"],
  ["ru", "Russian", "rus"],
  ["fo", "Faroese"],
  ["fr", "French", "fra"],
  ["sa", "Sanskrit"],
  ["fil", "Filipino", "tgl"],
  ["fj", "Fijian"],
  ["fi", "Finnish"],
  ["km", "Khmer"],
  ["kl", "Greenlandic"],
  ["ka", "Georgian"],
  ["gu", "Gujarati", "guj"],
  ["gn", "Guarani"],
  ["kk", "Kazakh", "kaz"],
  ["ht", "Haitian Creole"],
  ["ko", "Korean", "kor"],
  ["ha", "Hausa", "hau"],
  ["nl", "Dutch", "nld"],
  ["ky", "Kyrgyz"],
  ["gl", "Galician"],
  ["ca", "Catalan"],
  ["gaa", "Ga"],
  ["cs", "Czech", "ces"],
  ["kn", "Kannada", "kan"],
  ["kha", "Khasi"],
  ["xh", "Xhosa"],
  ["co", "Corsican"],
  ["hr", "Croatian", "hrv"],
  ["qu", "Quechua", "qug"],
  ["ku", "Kurdish", "ckb"],
  ["la", "Latin"],
  ["lv", "Latvian"],
  ["lo", "Lao"],
  ["lt", "Lithuanian"],
  ["ln", "Lingala", "lin"],
  ["rn", "Rundi", "run"],
  ["luo", "Luo"],
  ["lua", "Luba-Lulua"],
  ["lg", "Luganda"],
  ["lb", "Luxembourgish"],
  ["rw", "Kinyarwanda", "kin"],
  ["ro", "Romanian", "ron"],
  ["gv", "Manx"],
  ["mt", "Maltese"],
  ["mr", "Marathi", "mar"],
  ["mg", "Malagasy", "plt"],
  ["ml", "Malayalam", "mal"],
  ["ms", "Malay", "zlm"],
  ["mk", "Macedonian"],
  ["mfe", "Mauritian Creole"],
  ["mi", "Maori"],
  ["mn", "Mongolian"],
  ["bn", "Bengali", "ben"],
  ["my", "Burmese", "mya"],
  ["hmn", "Hmong", "hnj"],
  ["af", "Afrikaans"],
  ["st", "Southern Sotho"],
  ["ne", "Nepali", "npi"],
  ["new", "Newari"],
  ["no", "Norwegian"],
  ["pa", "Punjabi", "pan"],
  ["pt", "Portuguese", "por"],
  ["pt-PT", "Portuguese (Portugal)", "por", "exact-region"],
  ["ps", "Pashto", "pbu"],
  ["ny", "Chichewa", "nya"],
  ["ja", "Japanese", "jpn"],
  ["sv", "Swedish", "swe"],
  ["sm", "Samoan"],
  ["sr", "Serbian", "srp"],
  ["crs", "Seychellois Creole"],
  ["sg", "Sango"],
  ["si", "Sinhala", "sin"],
  ["sn", "Shona"],
  ["eo", "Esperanto"],
  ["sk", "Slovak"],
  ["sl", "Slovenian"],
  ["ss", "Swati"],
  ["sw", "Swahili", "swh"],
  ["gd", "Scottish Gaelic"],
  ["ceb", "Cebuano", "ceb"],
  ["so", "Somali", "som"],
  ["tg", "Tajik"],
  ["te", "Telugu", "tel"],
  ["ta", "Tamil", "tam"],
  ["th", "Thai", "tha"],
  ["to", "Tongan"],
  ["ti", "Tigrinya"],
  ["tum", "Tumbuka"],
  ["tr", "Turkish", "tur"],
  ["tk", "Turkmen"],
  ["war", "Waray"],
  ["cy", "Welsh"],
  ["ug", "Uyghur"],
  ["ve", "Venda"],
  ["wo", "Wolof"],
  ["ur", "Urdu", "urd"],
  ["uk", "Ukrainian", "ukr"],
  ["uz", "Uzbek", "uzn"],
  ["es", "Spanish", "spa"],
  ["fy", "Western Frisian"],
  ["he", "Hebrew"],
  ["el", "Greek", "ell"],
  ["haw", "Hawaiian"],
  ["sd", "Sindhi"],
  ["hu", "Hungarian", "hun"],
  ["su", "Sundanese", "sun"],
  ["hy", "Armenian"],
  ["ig", "Igbo", "ibo"],
  ["it", "Italian", "ita"],
  ["yi", "Yiddish"],
  ["iu", "Inuktitut"],
  ["hi", "Hindi", "hin"],
  ["id", "Indonesian", "ind"],
  ["en", "English", "eng"],
  ["yo", "Yoruba", "yor"],
  ["vi", "Vietnamese", "vie"],
  ["jv", "Javanese", "jav"],
  ["zh-Hant", "Chinese (Traditional)", "cmn", "exact-script"],
  ["zh-Hans", "Chinese (Simplified)", "cmn", "exact-script"],
  ["dz", "Dzongkha"],
  ["zu", "Zulu", "zul"],
  ["kri", "Krio"],
] as const satisfies readonly (readonly [string, string, string?, LanguageEquivalence?])[];

export const TARGET_LANGUAGES: readonly TargetLanguageOption[] = Object.freeze(
  [...entries]
    .sort((left, right) => (left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0))
    .map(([id, displayName, detectorCode, equivalence], index) =>
      Object.freeze({
        id,
        displayName,
        providerLabel: `${displayName} [${id}]`,
        ...(detectorCode ? { detectorCode } : {}),
        equivalence: equivalence ?? "base",
        order: index + 1,
      }),
    ),
);

const targetLanguagesById = new Map(TARGET_LANGUAGES.map((option) => [option.id, option]));
const targetLanguagesByDetectorCode = new Map<string, TargetLanguageOption>();

for (const option of TARGET_LANGUAGES) {
  if (option.detectorCode && !targetLanguagesByDetectorCode.has(option.detectorCode))
    targetLanguagesByDetectorCode.set(option.detectorCode, option);
}

export function isTargetLanguageId(value: unknown): value is string {
  return typeof value === "string" && targetLanguagesById.has(value);
}

export function getTargetLanguage(value: string): TargetLanguageOption | null {
  return targetLanguagesById.get(value) ?? null;
}

export function getProviderLanguageLabel(value: string): string | null {
  if (value === "zh") return "Chinese [zh]";
  return getTargetLanguage(value)?.providerLabel ?? null;
}

export function getDetectorLanguage(detectorCode: string): TargetLanguageOption | null {
  return targetLanguagesByDetectorCode.get(detectorCode) ?? null;
}
