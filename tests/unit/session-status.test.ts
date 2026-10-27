import { beforeAll, describe, expect, it } from "vitest";
import { createLocalizer } from "../../src/ui/localization.js";

const localizer = createLocalizer("en");

beforeAll(async () => {
  await import("../../src/ui/service-failure-message.js");
  await import("../../src/ui/session-status.js");
});

function failureMessage(error: {
  category?: string;
  statusCode?: number;
  providerCode?: string;
  retryable?: boolean;
  userAction?: string;
}) {
  return globalThis.subtandemLocalization.feedback(
    globalThis.subtandemSessionFailureFeedback(error),
  );
}

function expectFailureFeedback(
  error: Parameters<Window["subtandemSessionFailureFeedback"]>[0],
  messageKey: string,
) {
  const feedback = globalThis.subtandemSessionFailureFeedback(error);
  expect(feedback).toEqual({ messageKey, params: {} });
  expect(globalThis.subtandemLocalization.feedback(feedback)).toBe(localizer.format(messageKey));
}

function presentation(input: {
  status?:
    | "disabled"
    | "waitingForSubtitle"
    | "waitingForConfiguration"
    | "preparing"
    | "running"
    | "partialFailure"
    | "serviceUnavailable";
  providerError?: { category?: string; statusCode?: number; providerCode?: string } | null;
  sourceIssue?: string | null;
  sourcePreparation?: {
    state:
      | "preparing"
      | "ready"
      | "unsupportedType"
      | "remoteUnsupported"
      | "emptyOrUnreadable"
      | "timedOut"
      | "failed"
      | "invalidated";
  } | null;
}) {
  const value = globalThis.subtandemResolveSessionPresentation(input);
  return value
    ? { ...value, text: globalThis.subtandemLocalization.feedback(value.message) }
    : null;
}

describe("Session failure presentation", () => {
  it.each([
    ["srt", "SRT (SubRip)"],
    ["subrip", "SRT (SubRip)"],
    ["ass", "ASS (Advanced SubStation Alpha)"],
    ["ssa", "SSA (SubStation Alpha)"],
    ["mov_text", "MP4 timed text"],
    ["unknown", "Unknown subtitle format"],
  ])("maps subtitle format %s to %s", (format, expected) => {
    expect(globalThis.subtandemSubtitleFormatLabel(format)).toBe(expected);
  });

  it.each([
    [{ category: "authentication" }, "sidebar.authenticationFailedCheckTheProfilesAPIKey"],
    [{ category: "authentication", statusCode: 403 }, "sidebar.accessWasDeniedCheckTheProfilesAPI"],
    [{ category: "configuration" }, "sidebar.theProfileSettingsWereRejectedCheckThe"],
    [{ category: "network" }, "sidebar.couldntReachTheTranslationServiceCheckYour"],
    [{ category: "timeout" }, "sidebar.theTranslationServiceTimedOutTryAgain"],
    [{ category: "model" }, "sidebar.theModelIsUnavailableCheckTheProfiles"],
    [{ category: "quota" }, "sidebar.theServiceLimitWasReachedCheckThe"],
    [{ category: "refusal" }, "sidebar.theTranslationServiceRefusedThisRequestTry"],
    [
      { category: "protocol", providerCode: "PARTIAL_RESULT" },
      "sidebar.theTranslationServiceReturnedAnUnsupportedResponse",
    ],
    [{ category: "http", statusCode: 500 }, "sidebar.theTranslationServiceRejectedTheRequestCheck"],
    [{}, "sidebar.translationFailedTestTheProfileAndTry"],
  ])("maps %# to the expected localized feedback", (error, messageKey) => {
    expectFailureFeedback(error, messageKey);
  });

  it("uses the first matching signal and recognizes status-only failures", () => {
    for (const [input, messageKey] of [
      [
        { category: "quota", statusCode: 401 },
        "sidebar.authenticationFailedCheckTheProfilesAPIKey",
      ],
      [
        { category: "configuration", statusCode: 403 },
        "sidebar.accessWasDeniedCheckTheProfilesAPI",
      ],
      [
        { category: "network", statusCode: 504 },
        "sidebar.couldntReachTheTranslationServiceCheckYour",
      ],
      [
        { category: "configuration", statusCode: 429 },
        "sidebar.theProfileSettingsWereRejectedCheckThe",
      ],
      [{ category: "timeout", statusCode: 429 }, "sidebar.theTranslationServiceTimedOutTryAgain"],
      [{ category: "model", statusCode: 429 }, "sidebar.theModelIsUnavailableCheckTheProfiles"],
      [{ category: "quota", statusCode: 408 }, "sidebar.theTranslationServiceTimedOutTryAgain"],
      [{ category: "http", statusCode: 504 }, "sidebar.theTranslationServiceTimedOutTryAgain"],
      [{ category: "http", statusCode: 402 }, "sidebar.theServiceLimitWasReachedCheckThe"],
      [{ category: "http", statusCode: 429 }, "sidebar.theServiceLimitWasReachedCheckThe"],
    ] as const)
      expectFailureFeedback(input, messageKey);
  });

  it("treats the normalized unknown code as unknown and cancellation as no failure", () => {
    expectFailureFeedback(
      { category: "protocol", providerCode: "UNKNOWN_PROVIDER_ERROR" },
      "sidebar.translationFailedTestTheProfileAndTry",
    );
    expect(failureMessage({ category: "cancelled" })).toBeNull();
  });

  it("never reflects provider diagnostics or legacy wrappers", () => {
    const serialized = JSON.stringify({
      text: failureMessage({
        category: "protocol",
        statusCode: 502,
        providerCode: "PRIVATE_PROVIDER_CODE",
        retryable: false,
        userAction: "CHECK_ENDPOINT",
      }),
      rawBody: "private response body",
    });
    const message = JSON.parse(serialized).text as string;
    expect(message).not.toMatch(/HTTP 502|PRIVATE_PROVIDER_CODE|private response body/);
    expect(message).not.toContain("Some cues could not be translated");
    expect(message).not.toContain("Translation service unavailable");
    expect(message).not.toContain("playback continues");
  });
});

describe("Session presentation priority", () => {
  it.each([
    [
      {
        status: "disabled" as const,
        sourcePreparation: { state: "failed" as const },
        sourceIssue: "unreadable",
        providerError: { category: "authentication" },
      },
      "Translation is off",
      "disabled",
    ],
    [
      {
        status: "waitingForSubtitle" as const,
        sourcePreparation: { state: "preparing" as const },
        sourceIssue: "unreadable",
      },
      "Preparing the selected embedded subtitle…",
      "preparing",
    ],
    [
      { status: "waitingForConfiguration" as const, sourceIssue: "not-external" },
      "Select an external SRT or ASS subtitle track.",
      "waitingForSubtitle",
    ],
    [
      { status: "waitingForConfiguration" as const },
      "No translation service enabled. Enable one to translate.",
      "waitingForConfiguration",
    ],
    [
      { status: "serviceUnavailable" as const, providerError: { category: "network" } },
      localizer.format("sidebar.couldntReachTheTranslationServiceCheckYour"),
      "serviceUnavailable",
    ],
    [{ status: "running" as const }, "Translations are running", "running"],
    [{ status: "preparing" as const }, "Preparing nearby translations…", "preparing"],
  ])("resolves %# as the only visible state", (input, text, state) => {
    expect(presentation(input)).toMatchObject({ text, state });
  });

  it("creates a stable signature from only visible text and state", () => {
    const first = presentation({ status: "running" });
    const equivalent = presentation({ status: "running", sourcePreparation: { state: "ready" } });
    const changed = presentation({
      status: "serviceUnavailable",
      providerError: { category: "network" },
    });

    expect(first?.signature).toBe("running\u0000sidebar.translationsAreRunning\u0000{}");
    expect(equivalent?.signature).toBe(first?.signature);
    expect(changed?.signature).not.toBe(first?.signature);
  });

  it("uses the one exact unsupported subtitle message with a stable presentation signature", () => {
    const first = presentation({
      status: "waitingForSubtitle",
      sourcePreparation: { state: "unsupportedType" },
    });
    const equivalent = presentation({
      status: "serviceUnavailable",
      providerError: { category: "network" },
      sourcePreparation: { state: "unsupportedType" },
    });

    expect(first).toMatchObject({
      text: "Subtitle type not supported. Select a text subtitle in IINA.",
      state: "unsupportedType",
      signature: "unsupportedType\u0000sidebar.subtitleTypeNotSupportedSelectAText\u0000{}",
    });
    expect(equivalent?.signature).toBe(first?.signature);
    expect(presentation({ status: "waitingForSubtitle", sourceIssue: "unreadable" })?.text).toBe(
      "IINA has not exposed readable subtitle data yet; reselect the external subtitle.",
    );
  });

  it("keeps the no-service message stable while preserving disabled and subtitle priority", () => {
    const noService = presentation({ status: "waitingForConfiguration" });

    expect(noService).toMatchObject({
      text: "No translation service enabled. Enable one to translate.",
      state: "waitingForConfiguration",
      signature:
        "waitingForConfiguration\u0000sidebar.noTranslationServiceEnabledEnableOneTo\u0000{}",
    });
    expect(presentation({ status: "waitingForConfiguration" })?.signature).toBe(
      noService?.signature,
    );
    expect(
      presentation({
        status: "waitingForConfiguration",
        sourcePreparation: { state: "preparing" },
      })?.state,
    ).toBe("preparing");
    expect(
      presentation({ status: "waitingForConfiguration", sourceIssue: "unreadable" })?.state,
    ).toBe("waitingForSubtitle");
    expect(presentation({ status: "disabled" })?.text).toBe("Translation is off");
    expect(presentation({ status: "running" })?.text).not.toContain(
      "No translation service enabled",
    );
  });
});
