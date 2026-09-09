import { data } from "franc-all/data.js";
import { expressions } from "franc-all/expressions.js";
import { asTuples } from "trigram-utils";

const scripts = Object.entries(expressions);
const models = new Map(
  Object.entries(data).map(([script, languages]) => {
    const codes = Object.keys(languages);
    const postings = new Map<string, number[]>();
    for (let index = 0; index < codes.length; index += 1) {
      const trigrams = languages[codes[index]!]!.split("|");
      for (let rank = 0; rank < trigrams.length; rank += 1) {
        const trigram = trigrams[rank]!;
        const values = postings.get(trigram) ?? [];
        values.push(index, rank);
        postings.set(trigram, values);
      }
    }
    return [script, { codes, postings }] as const;
  }),
);

export function queryLanguageModel(
  value: string,
  options: { readonly only?: readonly string[]; readonly minLength: 0 },
): Array<[string, number]> {
  const text = value.slice(0, 2048);
  if (!text) return [["und", 1]];
  let script = "";
  let count = -1;
  for (const [name, expression] of scripts) {
    const matches = text.match(expression)?.length ?? 0;
    if (matches > count) {
      script = name;
      count = matches;
    }
  }
  const allowed = options.only?.length ? new Set(options.only) : null;
  const model = models.get(script);
  if (!model) return [[count > 0 && (!allowed || allowed.has(script)) ? script : "und", 1]];
  const trigrams = asTuples(text);
  const distances = new Float64Array(model.codes.length).fill(trigrams.length * 300);
  for (const [trigram, frequency] of trigrams) {
    const values = model.postings.get(trigram);
    if (!values) continue;
    for (let index = 0; index < values.length; index += 2) {
      const language = values[index]!;
      distances[language] =
        distances[language]! + Math.abs(frequency - values[index + 1]! - 1) - 300;
    }
  }
  const ranked: Array<[string, number]> = model.codes.flatMap((code, index) =>
    !allowed || allowed.has(code) ? [[code, distances[index]!] as [string, number]] : [],
  );
  if (!ranked.length) return [["und", 1]];
  ranked.sort((a, b) => a[1] - b[1]);
  const minimum = ranked[0]![1];
  const maximum = text.length * 300 - minimum;
  return ranked.map(([code, distance]) => [code, 1 - (distance - minimum) / maximum || 0]);
}
