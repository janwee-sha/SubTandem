export interface SourceLanguage {
  readonly languageId: string;
  readonly detectorCode: string;
}

export const SOURCE_LANGUAGES: readonly SourceLanguage[] = Object.freeze(
  [
    ["am", "amh"],
    ["ar", "arb"],
    ["az", "azj"],
    ["be", "bel"],
    ["bg", "bul"],
    ["bho", "bho"],
    ["bn", "ben"],
    ["bs", "bos"],
    ["ceb", "ceb"],
    ["cs", "ces"],
    ["de", "deu"],
    ["el", "ell"],
    ["en", "eng"],
    ["es", "spa"],
    ["fa", "pes"],
    ["fil", "tgl"],
    ["fr", "fra"],
    ["gu", "guj"],
    ["ha", "hau"],
    ["hi", "hin"],
    ["hmn", "hnj"],
    ["hr", "hrv"],
    ["hu", "hun"],
    ["id", "ind"],
    ["ig", "ibo"],
    ["it", "ita"],
    ["ja", "jpn"],
    ["jv", "jav"],
    ["kk", "kaz"],
    ["kn", "kan"],
    ["ko", "kor"],
    ["ku", "ckb"],
    ["ln", "lin"],
    ["mg", "plt"],
    ["ml", "mal"],
    ["mr", "mar"],
    ["ms", "zlm"],
    ["my", "mya"],
    ["ne", "npi"],
    ["nl", "nld"],
    ["ny", "nya"],
    ["pa", "pan"],
    ["pl", "pol"],
    ["ps", "pbu"],
    ["pt", "por"],
    ["qu", "qug"],
    ["rn", "run"],
    ["ro", "ron"],
    ["ru", "rus"],
    ["rw", "kin"],
    ["si", "sin"],
    ["so", "som"],
    ["sr", "srp"],
    ["su", "sun"],
    ["sv", "swe"],
    ["sw", "swh"],
    ["ta", "tam"],
    ["te", "tel"],
    ["th", "tha"],
    ["tr", "tur"],
    ["uk", "ukr"],
    ["ur", "urd"],
    ["uz", "uzn"],
    ["vi", "vie"],
    ["yo", "yor"],
    ["zh", "cmn"],
    ["zu", "zul"],
  ].map(([languageId, detectorCode]) =>
    Object.freeze({ languageId: languageId!, detectorCode: detectorCode! }),
  ),
);

export const SOURCE_DETECTOR_CODES = SOURCE_LANGUAGES.map((language) => language.detectorCode);

const sourcesByDetectorCode = new Map(
  SOURCE_LANGUAGES.map((language) => [language.detectorCode, language]),
);

export function getSourceLanguage(code: string): SourceLanguage | null {
  return sourcesByDetectorCode.get(code) ?? null;
}
