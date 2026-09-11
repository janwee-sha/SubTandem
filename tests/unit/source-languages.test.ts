import { describe, expect, it } from "vitest";
import {
  getSourceLanguage,
  getSourceLanguageForDetector,
  getSourceProviderLabel,
  isSourceLanguageId,
  SOURCE_LANGUAGES,
} from "../../src/domain/source-languages.js";

const expected =
  `afr:af als:sq amh:am arb:ar ayr:ay azj:az bel:be ben:bn bho:bho bod:bo bos:bs bul:bg cat:ca ceb:ceb ces:cs ckb:ku cmn:zh dan:da deu:de ekk:et ell:el eng:en epo:eo ewe:ee fin:fi fra:fr gaa:gaa glg:gl guj:gu hat:ht hau:ha heb:he hin:hi hms:hmn hnj:hmn hrv:hr hun:hu hye:hy ibo:ig ind:id ita:it jav:jv jpn:ja kan:kn kat:ka kaz:kk khk:mn khm:km kin:rw kir:ky kor:ko lao:lo lin:ln lit:lt lua:lua lug:lg lvs:lv mal:ml mar:mr min:ms mkd:mk mya:my nld:nl nno:no nob:no npi:ne nso:nso nya:ny pam:pam pan:pa pbu:ps pes:fa plt:mg pol:pl por:pt prs:fa qug:qu quy:qu quz:qu ron:ro run:rn rus:ru sag:sg sin:si slk:sk slv:sl sna:sn som:so sot:st spa:es srp:sr ssw:ss sun:su swe:sv swh:sw tam:ta tat:tt tel:te tgk:tg tgl:fil tha:th tir:ti tsn:tn tso:ts tuk:tk tur:tr uig:ug ukr:uk urd:ur uzn:uz ven:ve vie:vi war:war wol:wo xho:xh ydd:yi yor:yo zlm:ms zul:zu`
    .split(" ")
    .map((pair) => pair.split(":"));

describe("source language catalog", () => {
  it("maps the fixed 119 model codes to 113 distinct identities", () => {
    expect(expected).toHaveLength(119);
    expect(SOURCE_LANGUAGES).toHaveLength(113);
    expect(new Set(SOURCE_LANGUAGES.map((source) => source.id)).size).toBe(113);
    for (const [code, id] of expected) expect(getSourceLanguageForDetector(code!)?.id).toBe(id);
  });
  it("normalizes macro-language members without inferring script or region", () => {
    for (const codes of [
      ["nob", "nno"],
      ["hms", "hnj"],
      ["min", "zlm"],
      ["pes", "prs"],
      ["qug", "quy", "quz"],
    ])
      expect(new Set(codes.map((code) => getSourceLanguageForDetector(code)?.id)).size).toBe(1);
    expect(getSourceLanguageForDetector("cmn")?.id).toBe("zh");
    expect(getSourceLanguageForDetector("por")?.id).toBe("pt");
    expect(getSourceLanguageForDetector("tgl")?.id).toBe("fil");
  });
  it("keeps unsupported model identities outside product source identity", () => {
    for (const code of ["und", "sco", "toi", "xyz", ""])
      expect(getSourceLanguageForDetector(code)).toBeNull();
    for (const id of [
      null,
      undefined,
      "",
      "und",
      "auto",
      "zh-Hant",
      "zh-Hans",
      "pt-PT",
      "tl",
      " en ",
      "EN",
    ])
      expect(isSourceLanguageId(id)).toBe(false);
    expect(isSourceLanguageId("zh")).toBe(true);
    expect(getSourceLanguage("missing")).toBeNull();
    expect(getSourceProviderLabel("missing")).toBeNull();
  });
  it("provides stable English source labels independently of the target catalog", () => {
    for (const source of SOURCE_LANGUAGES) {
      expect(source.providerLabel).toBe(`${source.displayName} [${source.id}]`);
      expect(source.displayName).toMatch(/^[A-Za-z][A-Za-z ()-]+$/);
    }
    expect(getSourceProviderLabel("zh")).toBe("Chinese [zh]");
    expect(getSourceProviderLabel("pt")).toBe("Portuguese [pt]");
    expect(getSourceProviderLabel("bo")).toBe("Tibetan [bo]");
    expect(getSourceProviderLabel("hy")).toBe("Armenian [hy]");
  });
});
