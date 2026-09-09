import type { LanguageDetectionResult } from "../../src/subtitles/language-detection.js";
import { loadSubtitleSource } from "../../src/subtitles/source.js";
import { PlaybackController } from "../../src/app/controller.js";
import { LanguageDetectionCoordinator } from "../../src/app/language-detection.js";
import { shouldTranslate } from "../../src/domain/language.js";
import { selectNearbyCues } from "../../src/app/scheduler.js";
import { RecordingProvider } from "./fake-provider.js";
import type { LoadedSample } from "./language-corpus.js";

export async function translateCorpusSample(
  sample: LoadedSample,
  targetLanguage: string,
  trackLanguage: string | undefined,
  gate: "enabled" | "disabled" | "unselected" | "invalidated-profile" = "enabled",
) {
  const loaded = loadSubtitleSource(
    {
      id: 1,
      isExternal: true,
      title: `sample.${sample.format}`,
      ...(trackLanguage ? { lang: trackLanguage } : {}),
    },
    sample.bytes,
  );
  if (!loaded.ok) throw new Error("LANGUAGE_CORPUS_TRANSLATION_PARSE_FAILED");
  const provider = new RecordingProvider();
  const controller = new PlaybackController({
    playerId: "corpus-player",
    provider,
    overlay: { show: () => undefined, clear: () => undefined },
    targetLanguage,
    requiresProviderSelection: true,
  });
  if (gate !== "unselected")
    controller.setProviderSelection({
      profileId: "corpus-profile",
      revision: 1,
      endpointFingerprint: "corpus-endpoint",
      kind: "openai",
    });
  if (gate === "invalidated-profile") controller.clearProviderSelection();
  controller.setEnabled(gate !== "disabled");
  controller.setSource({
    cues: loaded.source.cues,
    contentHash: loaded.source.contentHash,
    format: loaded.source.format,
    language: null,
  });
  const position = loaded.source.cues[0]!.startMs;
  const nearbyIds = new Set(selectNearbyCues(loaded.source.cues, position).map((cue) => cue.id));
  controller.tick(position);
  let gatesPassed = provider.requests.length === 0;
  let result: LanguageDetectionResult = { state: "unknown" };
  const coordinator = new LanguageDetectionCoordinator();
  try {
    await coordinator.start(
      {
        playerId: "corpus-player",
        mediaEpoch: 1,
        trackIdentity: "corpus-track",
        contentHash: loaded.source.contentHash,
        cues: loaded.source.cues,
      },
      (detected) => {
        result =
          detected.state === "reliable"
            ? { state: "reliable", languageId: detected.languageId }
            : { state: detected.state };
        controller.setLanguageDetection(
          detected.state === "reliable" ? { languageId: detected.languageId } : detected.state,
        );
      },
    );
    controller.tick(position);
    await controller.whenIdle();
    const finalResult = result as LanguageDetectionResult;
    const shouldCall =
      gate === "enabled" &&
      finalResult.state === "reliable" &&
      shouldTranslate(finalResult.languageId, targetLanguage);
    gatesPassed &&= shouldCall ? provider.requests.length > 0 : provider.requests.length === 0;
    gatesPassed &&= provider.requests.every(
      (request) =>
        request.profileId === "corpus-profile" &&
        request.profileRevision === 1 &&
        request.items.every((item) => nearbyIds.has(item.id)),
    );
    const correctDirection =
      provider.requests.length > 0 &&
      provider.requests.every(
        (request) =>
          sample.truth.expectedLanguageIds.includes(request.sourceLanguage) &&
          request.targetLanguage === targetLanguage,
      );
    return { result: finalResult, calls: provider.requests.length, correctDirection, gatesPassed };
  } finally {
    coordinator.invalidate();
    controller.close();
  }
}
