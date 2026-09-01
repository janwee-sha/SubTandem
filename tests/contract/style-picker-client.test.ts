import { describe, expect, it } from "vitest";
import {
  StylePickerClient,
  parseStylePickerReadyFrame,
  type StylePickerHttpBridge,
} from "../../src/adapters/iina/style-picker-client.js";

class FakeBridge implements StylePickerHttpBridge {
  readonly requests: Array<{
    method: "GET" | "POST";
    url: string;
    token: string;
    body?: unknown;
  }> = [];
  responses: unknown[] = [];

  async request<T>(method: "GET" | "POST", url: string, token: string, body?: unknown): Promise<T> {
    this.requests.push({ method, url, token, ...(body === undefined ? {} : { body }) });
    return this.responses.shift() as T;
  }
}

describe("style picker client", () => {
  it("accepts one exact ready frame and rejects leaked or malformed output", () => {
    expect(
      parseStylePickerReadyFrame('{"protocolVersion":1,"port":49152,"token":"abcdefgh"}\n'),
    ).toEqual({ protocolVersion: 1, port: 49152, token: "abcdefgh" });
    for (const output of [
      "{}\n",
      '{"protocolVersion":1,"port":49152,"token":"short"}\n',
      '{"protocolVersion":1,"port":49152,"token":"abcdefgh","text":"body"}\n',
      '{"protocolVersion":1,"port":49152,"token":"abcdefgh"}\nextra\n',
    ]) {
      expect(() => parseStylePickerReadyFrame(output)).toThrow("STYLE_PICKER_PROTOCOL");
    }
  });

  it("authenticates exact font open and availability requests", async () => {
    const bridge = new FakeBridge();
    bridge.responses.push({ status: "opened" }, { availability: "available", catalogRevision: 2 });
    const client = new StylePickerClient({ port: 49152, token: "opaque-token" }, bridge);
    await expect(
      client.openFont({
        requestId: "picker.1",
        fontFamily: null,
        fontSize: 40,
        bold: false,
        italic: false,
      }),
    ).resolves.toBe("opened");
    await expect(client.fontStatus("Avenir Next")).resolves.toEqual({
      availability: "available",
      catalogRevision: 2,
    });
    expect(bridge.requests).toEqual([
      {
        method: "POST",
        url: "http://127.0.0.1:49152/v1/font/open",
        token: "opaque-token",
        body: {
          requestId: "picker.1",
          fontFamily: null,
          fontSize: 40,
          bold: false,
          italic: false,
        },
      },
      {
        method: "POST",
        url: "http://127.0.0.1:49152/v1/font/status",
        token: "opaque-token",
        body: { fontFamily: "Avenir Next" },
      },
    ]);
  });

  it("parses only ordered exact events and detects revision gaps", async () => {
    const bridge = new FakeBridge();
    bridge.responses.push({
      events: [{ revision: 4, requestId: "picker.1", type: "font-confirmed", fontFamily: "Inter" }],
      earliestRevision: 4,
      latestRevision: 4,
    });
    const client = new StylePickerClient({ port: 49152, token: "opaque-token" }, bridge);
    await expect(client.events(3)).resolves.toEqual({
      events: [{ revision: 4, requestId: "picker.1", type: "font-confirmed", fontFamily: "Inter" }],
      latestRevision: 4,
      gap: false,
    });

    bridge.responses.push({ events: [], earliestRevision: 8, latestRevision: 9 });
    await expect(client.events(4)).resolves.toMatchObject({ gap: true, latestRevision: 9 });
  });

  it("supports exact cancel and shutdown without exposing raw failures", async () => {
    const bridge = new FakeBridge();
    bridge.responses.push({ status: "cancelled" }, { status: "shutting-down" });
    const client = new StylePickerClient({ port: 49152, token: "opaque-token" }, bridge);
    await expect(client.cancel("picker.2")).resolves.toBe("cancelled");
    await expect(client.shutdown()).resolves.toBeUndefined();
    expect(bridge.requests.map((request) => request.url)).toEqual([
      "http://127.0.0.1:49152/v1/cancel",
      "http://127.0.0.1:49152/v1/shutdown",
    ]);
  });

  it("opens the system color panel with exact sRGB RGBA and preserves alpha", async () => {
    const bridge = new FakeBridge();
    bridge.responses.push({ status: "opened" });
    const client = new StylePickerClient({ port: 49152, token: "opaque-token" }, bridge);
    await expect(
      client.openColor({ requestId: "color.1", color: { r: 12, g: 34, b: 56, a: 78 } }),
    ).resolves.toBe("opened");
    expect(bridge.requests).toEqual([
      {
        method: "POST",
        url: "http://127.0.0.1:49152/v1/color/open",
        token: "opaque-token",
        body: { requestId: "color.1", color: { r: 12, g: 34, b: 56, a: 78 } },
      },
    ]);
  });

  it("accepts continuous color previews and changed or unchanged close events", async () => {
    const bridge = new FakeBridge();
    bridge.responses.push({
      events: [
        {
          revision: 1,
          requestId: "color.1",
          type: "color-preview",
          color: { r: 1, g: 2, b: 3, a: 4 },
        },
        {
          revision: 2,
          requestId: "color.1",
          type: "color-preview",
          color: { r: 5, g: 6, b: 7, a: 8 },
        },
        {
          revision: 3,
          requestId: "color.1",
          type: "color-closed",
          changed: true,
          color: { r: 5, g: 6, b: 7, a: 8 },
        },
      ],
      earliestRevision: 1,
      latestRevision: 3,
    });
    const client = new StylePickerClient({ port: 49152, token: "opaque-token" }, bridge);
    const batch = await client.events(0);
    expect(batch.gap).toBe(false);
    expect(batch.events.map((event) => event.type)).toEqual([
      "color-preview",
      "color-preview",
      "color-closed",
    ]);
    expect(batch.events.at(-1)).toMatchObject({ changed: true, color: { a: 8 } });

    bridge.responses.push({
      events: [
        {
          revision: 4,
          requestId: "color.2",
          type: "color-closed",
          changed: false,
          color: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
      earliestRevision: 4,
      latestRevision: 4,
    });
    await expect(client.events(3)).resolves.toMatchObject({
      gap: false,
      events: [{ type: "color-closed", changed: false }],
    });
  });

  it("rejects malformed color events and exposes gaps for safe session recovery", async () => {
    const bridge = new FakeBridge();
    const client = new StylePickerClient({ port: 49152, token: "opaque-token" }, bridge);
    bridge.responses.push({ events: [], earliestRevision: 7, latestRevision: 9 });
    await expect(client.events(2)).resolves.toMatchObject({ gap: true, latestRevision: 9 });
    bridge.responses.push({
      events: [
        {
          revision: 10,
          requestId: "color.1",
          type: "color-preview",
          color: { r: 0, g: 0, b: 0, a: 256 },
        },
      ],
      earliestRevision: 10,
      latestRevision: 10,
    });
    await expect(client.events(9)).rejects.toThrow("STYLE_PICKER_PROTOCOL");
  });

  it("rejects unknown response fields and subtitle-bearing request values", async () => {
    const bridge = new FakeBridge();
    bridge.responses.push({ status: "opened", text: "body" });
    const client = new StylePickerClient({ port: 49152, token: "opaque-token" }, bridge);
    await expect(
      client.openFont({
        requestId: "picker.3",
        fontFamily: null,
        fontSize: 40,
        bold: false,
        italic: false,
      }),
    ).rejects.toThrow("STYLE_PICKER_PROTOCOL");
    await expect(
      client.openFont({
        requestId: "picker.4",
        fontFamily: "invalid\u0000body",
        fontSize: 40,
        bold: false,
        italic: false,
      }),
    ).rejects.toThrow("STYLE_PICKER_PROTOCOL");
  });
});
