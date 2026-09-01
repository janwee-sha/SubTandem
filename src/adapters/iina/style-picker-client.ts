import type { HelperExecutableLocator, ProcessLauncher } from "./transport-process.js";
import {
  isFontFamily,
  isRgbaColor,
  isSubtitleStyleValue,
  type RgbaColor,
} from "../../domain/subtitle-style.js";

export interface StylePickerSession {
  port: number;
  token: string;
}

export interface StylePickerReadyFrame extends StylePickerSession {
  protocolVersion: 1;
}

export interface StylePickerHttpBridge {
  request<T>(method: "GET" | "POST", url: string, bearerToken: string, body?: unknown): Promise<T>;
}

export type StylePickerEvent =
  | { revision: number; requestId: string; type: "color-preview"; color: RgbaColor }
  | {
      revision: number;
      requestId: string;
      type: "color-closed";
      changed: boolean;
      color: RgbaColor;
    }
  | { revision: number; requestId: string; type: "font-confirmed"; fontFamily: string | null }
  | { revision: number; requestId: string; type: "font-cancelled" }
  | { revision: number; requestId: string; type: "font-catalog-changed"; catalogRevision: number }
  | { revision: number; requestId: string; type: "picker-failed"; code: "PICKER_UNAVAILABLE" };

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");

const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);

const validRevision = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0;

export function parseStylePickerReadyFrame(output: string): StylePickerReadyFrame {
  try {
    if (output.split("\n").filter(Boolean).length !== 1) throw new Error();
    const value = JSON.parse(output.trim()) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const frame = value as Record<string, unknown>;
    if (
      !exactKeys(frame, ["protocolVersion", "port", "token"]) ||
      frame.protocolVersion !== 1 ||
      !Number.isInteger(frame.port) ||
      (frame.port as number) < 1024 ||
      (frame.port as number) > 65535 ||
      typeof frame.token !== "string" ||
      !/^[A-Za-z0-9_-]{8,512}$/.test(frame.token)
    )
      throw new Error();
    return frame as unknown as StylePickerReadyFrame;
  } catch {
    throw new Error("STYLE_PICKER_PROTOCOL");
  }
}

export class StylePickerProcess {
  static async bootstrap(
    launcher: ProcessLauncher,
    options: { parentPid?: number },
    executable: string,
  ): Promise<StylePickerSession> {
    let stdout = "";
    let exitStatus: number | null = null;
    const completion = launcher.launch(
      executable,
      [
        "serve",
        ...(options.parentPid === undefined ? [] : ["--parent-pid", String(options.parentPid)]),
      ],
      (data) => {
        stdout += data;
      },
    );
    void completion.then(
      (result) => {
        exitStatus = result.status;
      },
      () => {
        exitStatus = -1;
      },
    );
    for (let tries = 0; tries < 250 && !stdout.includes("\n"); tries += 1) {
      if (exitStatus !== null) throw new Error("STYLE_PICKER_START_FAILED");
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    if (!stdout.includes("\n")) throw new Error("STYLE_PICKER_START_FAILED");
    const frame = parseStylePickerReadyFrame(stdout.slice(0, stdout.indexOf("\n") + 1));
    return { port: frame.port, token: frame.token };
  }
}

export class StylePickerClient {
  private readonly baseUrl: string;

  constructor(
    private readonly session: StylePickerSession,
    private readonly bridge: StylePickerHttpBridge,
  ) {
    if (
      !Number.isInteger(session.port) ||
      session.port < 1024 ||
      session.port > 65535 ||
      !/^[A-Za-z0-9_-]{8,512}$/.test(session.token)
    )
      throw new Error("STYLE_PICKER_PROTOCOL");
    this.baseUrl = `http://127.0.0.1:${session.port}`;
  }

  async openFont(input: {
    requestId: string;
    fontFamily: string | null;
    fontSize: number;
    bold: boolean;
    italic: boolean;
  }): Promise<"opened" | "focused"> {
    if (
      !validId(input.requestId) ||
      !isFontFamily(input.fontFamily) ||
      !isSubtitleStyleValue("fontSize", input.fontSize) ||
      typeof input.bold !== "boolean" ||
      typeof input.italic !== "boolean"
    )
      throw new Error("STYLE_PICKER_PROTOCOL");
    return this.statusResponse(
      await this.bridge.request("POST", `${this.baseUrl}/v1/font/open`, this.session.token, input),
      ["opened", "focused"],
    );
  }

  async openColor(input: {
    requestId: string;
    color: RgbaColor;
  }): Promise<"opened" | "focused"> {
    if (!validId(input.requestId) || !isRgbaColor(input.color))
      throw new Error("STYLE_PICKER_PROTOCOL");
    return this.statusResponse(
      await this.bridge.request("POST", `${this.baseUrl}/v1/color/open`, this.session.token, input),
      ["opened", "focused"],
    );
  }

  async activate(requestId: string): Promise<"activated" | "unchanged"> {
    if (!validId(requestId)) throw new Error("STYLE_PICKER_PROTOCOL");
    return this.statusResponse(
      await this.bridge.request("POST", `${this.baseUrl}/v1/activate`, this.session.token, {
        requestId,
      }),
      ["activated", "unchanged"],
    );
  }

  async fontStatus(fontFamily: string | null): Promise<{
    availability: "available" | "unavailable";
    catalogRevision: number;
  }> {
    if (!isFontFamily(fontFamily)) throw new Error("STYLE_PICKER_PROTOCOL");
    const value = await this.bridge.request<unknown>(
      "POST",
      `${this.baseUrl}/v1/font/status`,
      this.session.token,
      { fontFamily },
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("STYLE_PICKER_PROTOCOL");
    const record = value as Record<string, unknown>;
    if (
      !exactKeys(record, ["availability", "catalogRevision"]) ||
      (record.availability !== "available" && record.availability !== "unavailable") ||
      !validRevision(record.catalogRevision)
    )
      throw new Error("STYLE_PICKER_PROTOCOL");
    return record as { availability: "available" | "unavailable"; catalogRevision: number };
  }

  async events(after: number): Promise<{
    events: StylePickerEvent[];
    latestRevision: number;
    gap: boolean;
  }> {
    if (!validRevision(after)) throw new Error("STYLE_PICKER_PROTOCOL");
    const value = await this.bridge.request<unknown>(
      "GET",
      `${this.baseUrl}/v1/events?after=${after}`,
      this.session.token,
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("STYLE_PICKER_PROTOCOL");
    const record = value as Record<string, unknown>;
    if (
      !exactKeys(record, ["events", "earliestRevision", "latestRevision"]) ||
      !Array.isArray(record.events) ||
      !validRevision(record.earliestRevision) ||
      !validRevision(record.latestRevision)
    )
      throw new Error("STYLE_PICKER_PROTOCOL");
    const events = record.events.map(parseEvent);
    const latestRevision = record.latestRevision as number;
    if (
      events.some((event, index) => index > 0 && event.revision <= events[index - 1]!.revision) ||
      events.some((event) => event.revision <= after || event.revision > latestRevision)
    )
      throw new Error("STYLE_PICKER_PROTOCOL");
    return {
      events,
      latestRevision,
      gap: record.earliestRevision > after + 1,
    };
  }

  async cancel(requestId: string): Promise<"cancelled" | "unchanged"> {
    if (!validId(requestId)) throw new Error("STYLE_PICKER_PROTOCOL");
    return this.statusResponse(
      await this.bridge.request("POST", `${this.baseUrl}/v1/cancel`, this.session.token, {
        requestId,
      }),
      ["cancelled", "unchanged"],
    );
  }

  async shutdown(): Promise<void> {
    this.statusResponse(
      await this.bridge.request("POST", `${this.baseUrl}/v1/shutdown`, this.session.token, {}),
      ["shutting-down"],
    );
  }

  private statusResponse<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("STYLE_PICKER_PROTOCOL");
    const record = value as Record<string, unknown>;
    if (!exactKeys(record, ["status"]) || !allowed.includes(record.status as T[number]))
      throw new Error("STYLE_PICKER_PROTOCOL");
    return record.status as T[number];
  }
}

export class IinaStylePickerHttpBridge implements StylePickerHttpBridge {
  constructor(private readonly http: IINA.API.HTTP) {}

  async request<T>(
    method: "GET" | "POST",
    url: string,
    bearerToken: string,
    body?: unknown,
  ): Promise<T> {
    try {
      const options = {
        params: {},
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/json",
        },
        data: (body ?? {}) as Record<string, unknown>,
      };
      const response =
        method === "GET" ? await this.http.get(url, options) : await this.http.post(url, options);
      if (response.statusCode < 200 || response.statusCode >= 300)
        throw new Error("STYLE_PICKER_UNAVAILABLE");
      if (response.data && typeof response.data === "object") return response.data as T;
      return JSON.parse(response.text) as T;
    } catch {
      throw new Error("STYLE_PICKER_UNAVAILABLE");
    }
  }
}

export function discoverStylePickerExecutable(
  locator: HelperExecutableLocator,
  pluginId = "io.subtandem.iina",
): string {
  const dataDirectory = locator.resolvePath("@data/.").replace(/\/+$/, "");
  const suffix = `/.data/${pluginId}`;
  if (!dataDirectory.endsWith(suffix)) throw new Error("PLUGIN_DATA_PATH_UNEXPECTED");
  const pluginsDirectory = dataDirectory.slice(0, -suffix.length);
  const executableName = "subtandem-style-picker";
  const candidate = `${pluginsDirectory}/${pluginId}.iinaplugin/dist/native/${executableName}`;
  try {
    if (locator.exists(candidate)) return candidate;
  } catch {
    void 0;
  }
  if (locator.list && locator.read) {
    let entries: Array<{ filename: string; path: string; isDir: boolean }> = [];
    try {
      entries = locator.list(pluginsDirectory);
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (!/^[^/]+\.iinaplugin(?:-dev)?$/.test(entry.filename)) continue;
      const root = `${pluginsDirectory}/${entry.filename}`;
      try {
        const metadataText = locator.read(`${root}/Info.json`);
        if (!metadataText) continue;
        const metadata = JSON.parse(metadataText) as Record<string, unknown>;
        if (metadata.identifier !== pluginId) continue;
        const helper = `${root}/dist/native/${executableName}`;
        if (locator.exists(helper)) return helper;
      } catch {
        void 0;
      }
    }
  }
  throw new Error("STYLE_PICKER_NOT_FOUND");
}

function parseEvent(value: unknown): StylePickerEvent {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("STYLE_PICKER_PROTOCOL");
  const event = value as Record<string, unknown>;
  const base = validRevision(event.revision) && event.revision > 0 && validId(event.requestId);
  if (!base) throw new Error("STYLE_PICKER_PROTOCOL");
  if (
    event.type === "color-preview" &&
    exactKeys(event, ["revision", "requestId", "type", "color"]) &&
    isRgbaColor(event.color)
  )
    return event as unknown as StylePickerEvent;
  if (
    event.type === "color-closed" &&
    exactKeys(event, ["revision", "requestId", "type", "changed", "color"]) &&
    typeof event.changed === "boolean" &&
    isRgbaColor(event.color)
  )
    return event as unknown as StylePickerEvent;
  if (
    event.type === "font-confirmed" &&
    exactKeys(event, ["revision", "requestId", "type", "fontFamily"]) &&
    isFontFamily(event.fontFamily)
  )
    return event as unknown as StylePickerEvent;
  if (event.type === "font-cancelled" && exactKeys(event, ["revision", "requestId", "type"]))
    return event as unknown as StylePickerEvent;
  if (
    event.type === "font-catalog-changed" &&
    exactKeys(event, ["revision", "requestId", "type", "catalogRevision"]) &&
    validRevision(event.catalogRevision)
  )
    return event as unknown as StylePickerEvent;
  if (
    event.type === "picker-failed" &&
    exactKeys(event, ["revision", "requestId", "type", "code"]) &&
    event.code === "PICKER_UNAVAILABLE"
  )
    return event as unknown as StylePickerEvent;
  throw new Error("STYLE_PICKER_PROTOCOL");
}
