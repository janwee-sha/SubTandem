import { beforeAll, describe, expect, it } from "vitest";

beforeAll(async () => {
  await import("../../ui/service-failure-message.js");
  await import("../../ui/session-status.js");
});

function failureMessage(error: {
  category?: string;
  statusCode?: number;
  providerCode?: string;
  retryable?: boolean;
  userAction?: string;
}) {
  return globalThis.subtandemSessionFailureMessage(error);
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
  return globalThis.subtandemResolveSessionPresentation(input);
}

describe("Session failure presentation", () => {
  it.each([
    [{ category: "authentication" }, "Authentication failed. Check the Profile’s API key."],
    [
      { category: "authentication", statusCode: 403 },
      "Access was denied. Check the Profile’s API key and model access.",
    ],
    [
      { category: "configuration" },
      "The Profile settings were rejected. Check the Endpoint and Model ID.",
    ],
    [
      { category: "network" },
      "Couldn’t reach the translation service. Check your connection and Network route.",
    ],
    [{ category: "timeout" }, "The translation service timed out. Try again."],
    [{ category: "model" }, "The model is unavailable. Check the Profile’s Model ID."],
    [
      { category: "quota" },
      "The service limit was reached. Check the account quota or try again later.",
    ],
    [
      { category: "refusal" },
      "The translation service refused this request. Try another model or Profile.",
    ],
    [
      { category: "protocol", providerCode: "PARTIAL_RESULT" },
      "The translation service returned an unsupported response. Check the Profile’s service type and model.",
    ],
    [
      { category: "http", statusCode: 500 },
      "The translation service rejected the request. Check the Profile settings and try again.",
    ],
    [{}, "Translation failed. Test the Profile and try again."],
  ])("maps %# to one exact actionable message", (error, expected) => {
    expect(failureMessage(error)).toBe(expected);
  });

  it("uses the first matching signal and recognizes status-only failures", () => {
    for (const [input, expected] of [
      [
        { category: "quota", statusCode: 401 },
        "Authentication failed. Check the Profile’s API key.",
      ],
      [
        { category: "configuration", statusCode: 403 },
        "Access was denied. Check the Profile’s API key and model access.",
      ],
      [
        { category: "network", statusCode: 504 },
        "Couldn’t reach the translation service. Check your connection and Network route.",
      ],
      [
        { category: "configuration", statusCode: 429 },
        "The Profile settings were rejected. Check the Endpoint and Model ID.",
      ],
      [{ category: "timeout", statusCode: 429 }, "The translation service timed out. Try again."],
      [
        { category: "model", statusCode: 429 },
        "The model is unavailable. Check the Profile’s Model ID.",
      ],
      [{ category: "quota", statusCode: 408 }, "The translation service timed out. Try again."],
      [{ category: "http", statusCode: 504 }, "The translation service timed out. Try again."],
      [
        { category: "http", statusCode: 402 },
        "The service limit was reached. Check the account quota or try again later.",
      ],
      [
        { category: "http", statusCode: 429 },
        "The service limit was reached. Check the account quota or try again later.",
      ],
    ] as const)
      expect(failureMessage(input)).toBe(expected);
  });

  it("treats the normalized unknown code as unknown and cancellation as no failure", () => {
    expect(failureMessage({ category: "protocol", providerCode: "UNKNOWN_PROVIDER_ERROR" })).toBe(
      "Translation failed. Test the Profile and try again.",
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
      "Couldn’t reach the translation service. Check your connection and Network route.",
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

    expect(first?.signature).toBe("running\u0000Translations are running");
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

    expect(first).toEqual({
      text: "Subtitle type not supported. Select a text subtitle in IINA.",
      state: "unsupportedType",
      signature:
        "unsupportedType\u0000Subtitle type not supported. Select a text subtitle in IINA.",
    });
    expect(equivalent?.signature).toBe(first?.signature);
    expect(presentation({ status: "waitingForSubtitle", sourceIssue: "unreadable" })?.text).toBe(
      "IINA has not exposed readable subtitle data yet; reselect the external subtitle.",
    );
  });

  it("keeps the no-service message stable while preserving disabled and subtitle priority", () => {
    const noService = presentation({ status: "waitingForConfiguration" });

    expect(noService).toEqual({
      text: "No translation service enabled. Enable one to translate.",
      state: "waitingForConfiguration",
      signature:
        "waitingForConfiguration\u0000No translation service enabled. Enable one to translate.",
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
