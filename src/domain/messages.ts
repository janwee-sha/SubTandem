export interface RpcEnvelope<T = unknown> {
  requestId: string;
  revision: number;
  payload: T;
}

import { isTargetLanguageId } from "./target-languages.js";
import { isOverlayPosition, isOverlayRegion, type OverlayRegion } from "./overlay-position.js";
import {
  createFontResolution,
  isColorStyleField,
  isSubtitleStyleField,
  isSubtitleStyleValue,
  isSubtitleTextStyle,
  type FontResolution,
  type SubtitleStyleField,
  type SubtitleTextStyle,
} from "./subtitle-style.js";

export type OverlayPositionRequest = RpcEnvelope<{ position: number }>;

export interface OverlayPositionStateMessage {
  phase: "snapshot" | "preview" | "committed" | "reverted";
  position: number;
  committedPosition: number;
  intentSequence: number;
  committedRevision: number;
}

export type OverlayPositionSaveResult =
  | {
      requestId: string;
      ok: true;
      position: number;
      intentSequence: number;
      committedRevision: number;
    }
  | {
      requestId: string;
      ok: false;
      code: "OVERLAY_POSITION_SAVE_FAILED";
      userAction: "NONE";
      committedPosition: number;
      intentSequence: number;
      committedRevision: number;
    };

export interface OverlayLayoutMessage {
  renderRevision: number;
  position: number;
  region: OverlayRegion;
  style: SubtitleTextStyle;
}

export interface OverlayRenderMessage extends OverlayLayoutMessage {
  lines: string[];
}

export type SubtitleStyleEditMessage = RpcEnvelope<{
  interactionId: string;
  phase: "preview" | "commit";
  field: SubtitleStyleField;
  value: SubtitleTextStyle[SubtitleStyleField];
}>;

export type SubtitleStylePickerOpenMessage = RpcEnvelope<
  | { kind: "color"; field: "fontColor" | "borderColor" | "backgroundColor" }
  | { kind: "font"; field: "fontFamily" }
>;

export interface SubtitleStyleStateMessage {
  phase: "snapshot" | "preview" | "committed" | "reverted" | "availability";
  liveStyle: SubtitleTextStyle;
  committedStyle: SubtitleTextStyle;
  changedField: SubtitleStyleField | null;
  stateRevision: number;
  latestIntentSequence: number;
  committedRevision: number;
  fontResolution: FontResolution;
}

export type SubtitleStyleSaveResult =
  | {
      requestId: string;
      field: SubtitleStyleField;
      ok: true;
      outcome: "committed" | "superseded";
      intentSequence: number;
      authority: SubtitleStyleStateMessage;
    }
  | {
      requestId: string;
      field: SubtitleStyleField;
      ok: false;
      code: "SUBTITLE_STYLE_SAVE_FAILED";
      userAction: "EDIT_AGAIN";
      intentSequence: number;
      authority: SubtitleStyleStateMessage;
    };

export interface SubtitleStylePickerResult {
  requestId: string;
  outcome: "confirmed" | "cancelled" | "unchanged" | "busy" | "failed";
  authority: SubtitleStyleStateMessage;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).sort().join(",") === [...keys].sort().join(",");
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function parseOverlayPositionRequest(value: unknown): OverlayPositionRequest {
  const envelope = parseEnvelope(value);
  const payload = envelope.payload as Record<string, unknown>;
  if (!exactKeys(payload, ["position"]) || !isOverlayPosition(payload.position))
    throw new Error("INVALID_MESSAGE");
  return envelope as OverlayPositionRequest;
}

export const parseOverlayPositionPreview = parseOverlayPositionRequest;
export const parseOverlayPositionSave = parseOverlayPositionRequest;

export function parseOverlayPositionGet(value: unknown): RpcEnvelope<Record<string, never>> {
  const envelope = parseEnvelope(value);
  if (!exactKeys(envelope.payload as Record<string, unknown>, []))
    throw new Error("INVALID_MESSAGE");
  return envelope as RpcEnvelope<Record<string, never>>;
}

export function parseOverlayPositionState(value: unknown): OverlayPositionStateMessage {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_MESSAGE");
  const record = value as Record<string, unknown>;
  if (
    !exactKeys(record, [
      "phase",
      "position",
      "committedPosition",
      "intentSequence",
      "committedRevision",
    ]) ||
    !["snapshot", "preview", "committed", "reverted"].includes(String(record.phase)) ||
    !isOverlayPosition(record.position) ||
    !isOverlayPosition(record.committedPosition) ||
    !nonNegativeInteger(record.intentSequence) ||
    !nonNegativeInteger(record.committedRevision) ||
    ((record.phase === "committed" || record.phase === "reverted") &&
      record.position !== record.committedPosition)
  )
    throw new Error("INVALID_MESSAGE");
  return record as unknown as OverlayPositionStateMessage;
}

export function parseOverlayPositionSaveResult(value: unknown): OverlayPositionSaveResult {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_MESSAGE");
  const record = value as Record<string, unknown>;
  const baseValid =
    typeof record.requestId === "string" &&
    /^[A-Za-z0-9_.-]{1,128}$/.test(record.requestId) &&
    typeof record.ok === "boolean" &&
    nonNegativeInteger(record.intentSequence) &&
    nonNegativeInteger(record.committedRevision);
  if (!baseValid) throw new Error("INVALID_MESSAGE");
  if (
    record.ok === true &&
    exactKeys(record, ["requestId", "ok", "position", "intentSequence", "committedRevision"]) &&
    isOverlayPosition(record.position)
  )
    return record as unknown as OverlayPositionSaveResult;
  if (
    record.ok === false &&
    exactKeys(record, [
      "requestId",
      "ok",
      "code",
      "userAction",
      "committedPosition",
      "intentSequence",
      "committedRevision",
    ]) &&
    record.code === "OVERLAY_POSITION_SAVE_FAILED" &&
    record.userAction === "NONE" &&
    isOverlayPosition(record.committedPosition)
  )
    return record as unknown as OverlayPositionSaveResult;
  throw new Error("INVALID_MESSAGE");
}

export function parseOverlayReady(value: unknown): Record<string, never> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_MESSAGE");
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, [])) throw new Error("INVALID_MESSAGE");
  return record as Record<string, never>;
}

function parseOverlayLayoutBase(value: unknown): OverlayLayoutMessage {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_MESSAGE");
  const record = value as Record<string, unknown>;
  if (
    !nonNegativeInteger(record.renderRevision) ||
    !isOverlayPosition(record.position) ||
    !isOverlayRegion(record.region) ||
    !isSubtitleTextStyle(record.style)
  )
    throw new Error("INVALID_MESSAGE");
  return record as unknown as OverlayLayoutMessage;
}

export function parseOverlayLayout(value: unknown): OverlayLayoutMessage {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_MESSAGE");
  if (
    !exactKeys(value as Record<string, unknown>, ["renderRevision", "position", "region", "style"])
  )
    throw new Error("INVALID_MESSAGE");
  return parseOverlayLayoutBase(value);
}

export function parseOverlayRender(value: unknown): OverlayRenderMessage {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_MESSAGE");
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ["renderRevision", "lines", "position", "region", "style"]))
    throw new Error("INVALID_MESSAGE");
  const layout = parseOverlayLayoutBase(record);
  if (
    !Array.isArray(record.lines) ||
    record.lines.length === 0 ||
    record.lines.some((line) => typeof line !== "string" || !line.trim())
  )
    throw new Error("INVALID_MESSAGE");
  return { ...layout, lines: [...record.lines] as string[] };
}

export function parseOverlayClear(value: unknown): { renderRevision: number } {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_MESSAGE");
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ["renderRevision"]) || !nonNegativeInteger(record.renderRevision))
    throw new Error("INVALID_MESSAGE");
  return { renderRevision: record.renderRevision };
}

export function parseSubtitleStyleGet(value: unknown): RpcEnvelope<Record<string, never>> {
  const envelope = parseEnvelope(value);
  if (!exactKeys(envelope.payload as Record<string, unknown>, []))
    throw new Error("INVALID_MESSAGE");
  return envelope as RpcEnvelope<Record<string, never>>;
}

export function parseSubtitleStyleEdit(value: unknown): SubtitleStyleEditMessage {
  const envelope = parseEnvelope(value);
  const payload = envelope.payload as Record<string, unknown>;
  if (
    !exactKeys(payload, ["interactionId", "phase", "field", "value"]) ||
    typeof payload.interactionId !== "string" ||
    !/^[A-Za-z0-9_.:-]{1,128}$/.test(payload.interactionId) ||
    (payload.phase !== "preview" && payload.phase !== "commit") ||
    !isSubtitleStyleField(payload.field) ||
    !isSubtitleStyleValue(payload.field, payload.value)
  )
    throw new Error("INVALID_MESSAGE");
  return envelope as SubtitleStyleEditMessage;
}

export function parseSubtitleStylePickerOpen(value: unknown): SubtitleStylePickerOpenMessage {
  const envelope = parseEnvelope(value);
  const payload = envelope.payload as Record<string, unknown>;
  if (!exactKeys(payload, ["kind", "field"])) throw new Error("INVALID_MESSAGE");
  if (
    (payload.kind === "color" && isColorStyleField(payload.field)) ||
    (payload.kind === "font" && payload.field === "fontFamily")
  )
    return envelope as SubtitleStylePickerOpenMessage;
  throw new Error("INVALID_MESSAGE");
}

export function parseSubtitleStyleState(value: unknown): SubtitleStyleStateMessage {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_MESSAGE");
  const record = value as Record<string, unknown>;
  if (
    !exactKeys(record, [
      "phase",
      "liveStyle",
      "committedStyle",
      "changedField",
      "stateRevision",
      "latestIntentSequence",
      "committedRevision",
      "fontResolution",
    ]) ||
    !["snapshot", "preview", "committed", "reverted", "availability"].includes(
      String(record.phase),
    ) ||
    !isSubtitleTextStyle(record.liveStyle) ||
    !isSubtitleTextStyle(record.committedStyle) ||
    (record.changedField !== null && !isSubtitleStyleField(record.changedField)) ||
    !nonNegativeInteger(record.stateRevision) ||
    !nonNegativeInteger(record.latestIntentSequence) ||
    !nonNegativeInteger(record.committedRevision) ||
    !isFontResolution(record.fontResolution)
  )
    throw new Error("INVALID_MESSAGE");
  return record as unknown as SubtitleStyleStateMessage;
}

export function serializeSubtitleStyleState(
  state: SubtitleStyleStateMessage,
): SubtitleStyleStateMessage {
  const parsed = parseSubtitleStyleState(state);
  return JSON.parse(JSON.stringify(parsed)) as SubtitleStyleStateMessage;
}

export function parseSubtitleStyleSaveResult(value: unknown): SubtitleStyleSaveResult {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_MESSAGE");
  const record = value as Record<string, unknown>;
  const validBase =
    typeof record.requestId === "string" &&
    /^[A-Za-z0-9_.:-]{1,128}$/.test(record.requestId) &&
    isSubtitleStyleField(record.field) &&
    typeof record.ok === "boolean" &&
    nonNegativeInteger(record.intentSequence);
  if (!validBase) throw new Error("INVALID_MESSAGE");
  if (
    record.ok === true &&
    exactKeys(record, ["requestId", "field", "ok", "outcome", "intentSequence", "authority"]) &&
    (record.outcome === "committed" || record.outcome === "superseded")
  ) {
    parseSubtitleStyleState(record.authority);
    return record as unknown as SubtitleStyleSaveResult;
  }
  if (
    record.ok === false &&
    exactKeys(record, [
      "requestId",
      "field",
      "ok",
      "code",
      "userAction",
      "intentSequence",
      "authority",
    ]) &&
    record.code === "SUBTITLE_STYLE_SAVE_FAILED" &&
    record.userAction === "EDIT_AGAIN"
  ) {
    parseSubtitleStyleState(record.authority);
    return record as unknown as SubtitleStyleSaveResult;
  }
  throw new Error("INVALID_MESSAGE");
}

export function parseSubtitleStylePickerResult(value: unknown): SubtitleStylePickerResult {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_MESSAGE");
  const record = value as Record<string, unknown>;
  if (
    !exactKeys(record, ["requestId", "outcome", "authority"]) ||
    typeof record.requestId !== "string" ||
    !/^[A-Za-z0-9_.:-]{1,128}$/.test(record.requestId) ||
    !["confirmed", "cancelled", "unchanged", "busy", "failed"].includes(String(record.outcome))
  )
    throw new Error("INVALID_MESSAGE");
  parseSubtitleStyleState(record.authority);
  return record as unknown as SubtitleStylePickerResult;
}

function isFontResolution(value: unknown): value is FontResolution {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const resolution = value as Record<string, unknown>;
  if (
    !exactKeys(resolution, [
      "preferredFamily",
      "availability",
      "effectiveFamily",
      "fallbackActive",
      "catalogRevision",
    ]) ||
    (resolution.availability !== "available" &&
      resolution.availability !== "unavailable" &&
      resolution.availability !== "unknown") ||
    typeof resolution.fallbackActive !== "boolean" ||
    !nonNegativeInteger(resolution.catalogRevision)
  )
    return false;
  try {
    const expected = createFontResolution(
      resolution.preferredFamily as string | null,
      resolution.availability,
      resolution.catalogRevision,
    );
    return (
      resolution.effectiveFamily === expected.effectiveFamily &&
      resolution.fallbackActive === expected.fallbackActive
    );
  } catch {
    return false;
  }
}

export type TargetLanguageSaveMessage = RpcEnvelope<{ targetLanguage: string }>;

export function parseTargetLanguageSave(value: unknown): TargetLanguageSaveMessage {
  const envelope = parseEnvelope(value);
  const payload = envelope.payload as Record<string, unknown>;
  if (
    Object.keys(payload).sort().join(",") !== "targetLanguage" ||
    !isTargetLanguageId(payload.targetLanguage)
  )
    throw new Error("INVALID_TARGET_LANGUAGE");
  return envelope as TargetLanguageSaveMessage;
}

export function parseTargetLanguageSaved(value: unknown): {
  requestId: string;
  targetLanguage: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_MESSAGE");
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "requestId,targetLanguage" ||
    typeof record.requestId !== "string" ||
    !isTargetLanguageId(record.targetLanguage)
  )
    throw new Error("INVALID_MESSAGE");
  return { requestId: record.requestId, targetLanguage: record.targetLanguage };
}

export function parseLanguageOperationResult(value: unknown): {
  requestId: string;
  ok: boolean;
  action: "languages";
  targetLanguage?: string;
  targetLanguageRevision?: number;
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_MESSAGE");
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "requestId",
    "ok",
    "action",
    "targetLanguage",
    "targetLanguageRevision",
  ]);
  if (
    Object.keys(record).some((key) => !allowed.has(key)) ||
    typeof record.requestId !== "string" ||
    typeof record.ok !== "boolean" ||
    record.action !== "languages" ||
    (record.targetLanguage !== undefined && !isTargetLanguageId(record.targetLanguage)) ||
    (record.targetLanguageRevision !== undefined &&
      (!Number.isInteger(record.targetLanguageRevision) ||
        (record.targetLanguageRevision as number) < 1))
  )
    throw new Error("INVALID_MESSAGE");
  return record as ReturnType<typeof parseLanguageOperationResult>;
}

export function parseLanguageOperationError(value: unknown): {
  requestId: string;
  code: "INVALID_TARGET_LANGUAGE" | "TARGET_LANGUAGE_SAVE_FAILED";
  userAction: "NONE";
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_MESSAGE");
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "code,requestId,userAction" ||
    typeof record.requestId !== "string" ||
    (record.code !== "INVALID_TARGET_LANGUAGE" && record.code !== "TARGET_LANGUAGE_SAVE_FAILED") ||
    record.userAction !== "NONE"
  )
    throw new Error("INVALID_MESSAGE");
  return record as ReturnType<typeof parseLanguageOperationError>;
}

export const SIDEBAR_MESSAGE_NAMES = [
  "ui:ready",
  "ui:poll",
  "defaults:save",
  "profile:save",
  "secret:set",
  "profile:select",
  "profile:delete-request",
  "provider:test",
  "provider:models",
  "provider:models-preview",
  "translation:set-enabled",
  "subtitle:retry-preparation",
] as const;

export interface RetrySubtitlePreparationPayload {
  requestId: string;
  revision: number;
  payload: Record<string, never>;
}

export interface SafeSourcePreparationMessage {
  state:
    | "preparing"
    | "ready"
    | "unsupportedType"
    | "remoteUnsupported"
    | "emptyOrUnreadable"
    | "timedOut"
    | "failed"
    | "invalidated";
  origin: "embedded";
  codec?: "subrip" | "ass" | "ssa" | "mov_text";
  cueCount?: number;
  canRetry: boolean;
  canReselect: boolean;
}

export function parseRetrySubtitlePreparation(value: unknown): RetrySubtitlePreparationPayload {
  const envelope = parseEnvelope(value);
  if (Object.keys(envelope.payload as Record<string, unknown>).length !== 0)
    throw new Error("INVALID_MESSAGE");
  return envelope as RetrySubtitlePreparationPayload;
}

export const GLOBAL_MESSAGE_NAMES = [
  "defaults:save",
  "profiles:list",
  "profile:create-revision",
  "profile:delete",
  "profile:select",
  "credential:set",
  "provider:test",
  "provider:models",
  "provider:models-preview",
  "provider:attempt",
  "provider:cancel",
  "profile:release",
] as const;

export const PROVIDER_ATTEMPT_EVENT_NAMES = [
  "provider:attempt-progress",
  "provider:attempt-result",
  "provider:attempt-error",
] as const;

export function parseTranslationBatchProgress(value: unknown): TranslationBatchProgress {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_PROVIDER_PROGRESS");
  const record = value as Record<string, unknown>;
  const allowed = new Set(["translations", "providerRequestId", "usage"]);
  if (Object.keys(record).some((key) => !allowed.has(key)) || !Array.isArray(record.translations))
    throw new Error("INVALID_PROVIDER_PROGRESS");
  const translations = record.translations.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("INVALID_PROVIDER_PROGRESS");
    const translation = item as Record<string, unknown>;
    if (
      Object.keys(translation).sort().join(",") !== "id,text" ||
      typeof translation.id !== "string" ||
      !translation.id ||
      typeof translation.text !== "string" ||
      !translation.text.trim()
    )
      throw new Error("INVALID_PROVIDER_PROGRESS");
    return { id: translation.id, text: translation.text };
  });
  if (translations.length === 0) throw new Error("INVALID_PROVIDER_PROGRESS");
  if (
    record.providerRequestId !== undefined &&
    (typeof record.providerRequestId !== "string" ||
      !/^[\x20-\x7E]{1,256}$/.test(record.providerRequestId))
  )
    throw new Error("INVALID_PROVIDER_PROGRESS");
  let usage: TranslationBatchProgress["usage"];
  if (record.usage !== undefined) {
    if (!record.usage || typeof record.usage !== "object" || Array.isArray(record.usage))
      throw new Error("INVALID_PROVIDER_PROGRESS");
    const rawUsage = record.usage as Record<string, unknown>;
    if (Object.keys(rawUsage).some((key) => !["input", "output", "characters"].includes(key)))
      throw new Error("INVALID_PROVIDER_PROGRESS");
    for (const amount of Object.values(rawUsage))
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0)
        throw new Error("INVALID_PROVIDER_PROGRESS");
    usage = {
      ...(typeof rawUsage.input === "number" ? { input: rawUsage.input } : {}),
      ...(typeof rawUsage.output === "number" ? { output: rawUsage.output } : {}),
      ...(typeof rawUsage.characters === "number" ? { characters: rawUsage.characters } : {}),
    };
  }
  return {
    translations,
    ...(typeof record.providerRequestId === "string"
      ? { providerRequestId: record.providerRequestId }
      : {}),
    ...(usage ? { usage } : {}),
  };
}

export function parseEnvelope(value: unknown): RpcEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_MESSAGE");
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "payload,requestId,revision" ||
    typeof record.requestId !== "string" ||
    !/^[A-Za-z0-9_.-]{1,128}$/.test(record.requestId) ||
    !Number.isInteger(record.revision) ||
    (record.revision as number) < 1 ||
    !record.payload ||
    typeof record.payload !== "object" ||
    Array.isArray(record.payload)
  ) {
    throw new Error("INVALID_MESSAGE");
  }
  return record as unknown as RpcEnvelope;
}

export interface ProviderModelsRequestPayload {
  trigger: "open" | "endpoint" | "profile" | "credential" | "manual";
  kind: "openai" | "claude" | "deepseek" | "ollama";
  endpoint: string;
  proxyMode: "system" | "direct";
  profileId?: string;
  profileRevision?: number;
  endpointFingerprint?: string;
}

export type ProviderModelsRequest = RpcEnvelope<ProviderModelsRequestPayload>;

export interface ProviderModelsPreviewRequestPayload {
  trigger: "manual";
  kind: "openai" | "claude" | "deepseek" | "ollama";
  endpoint: string;
  proxyMode: "system" | "direct";
  draftCredentialEpoch: number;
  credential: { apiKey: string };
}

export type ProviderModelsPreviewRequest = RpcEnvelope<ProviderModelsPreviewRequestPayload>;

export function parseProviderModelsRequest(value: unknown): ProviderModelsRequest {
  const envelope = parseEnvelope(value);
  const payload = envelope.payload as Record<string, unknown>;
  const allowed = new Set([
    "trigger",
    "kind",
    "endpoint",
    "proxyMode",
    "profileId",
    "profileRevision",
    "endpointFingerprint",
  ]);
  const profileFields = [payload.profileId, payload.profileRevision, payload.endpointFingerprint];
  const profileFieldCount = profileFields.filter((field) => field !== undefined).length;
  if (
    Object.keys(payload).some((key) => !allowed.has(key)) ||
    !["open", "endpoint", "profile", "credential", "manual"].includes(String(payload.trigger)) ||
    (payload.kind !== "openai" &&
      payload.kind !== "claude" &&
      payload.kind !== "deepseek" &&
      payload.kind !== "ollama") ||
    typeof payload.endpoint !== "string" ||
    !payload.endpoint ||
    (payload.proxyMode !== "system" && payload.proxyMode !== "direct") ||
    (profileFieldCount !== 0 && profileFieldCount !== 3) ||
    (payload.profileId !== undefined &&
      (typeof payload.profileId !== "string" || !payload.profileId)) ||
    (payload.profileRevision !== undefined &&
      (!Number.isInteger(payload.profileRevision) || (payload.profileRevision as number) < 1)) ||
    (payload.endpointFingerprint !== undefined &&
      (typeof payload.endpointFingerprint !== "string" || !payload.endpointFingerprint))
  )
    throw new Error("INVALID_MESSAGE");
  return envelope as ProviderModelsRequest;
}

export function parseProviderModelsPreviewRequest(value: unknown): ProviderModelsPreviewRequest {
  const envelope = parseEnvelope(value);
  const payload = envelope.payload as Record<string, unknown>;
  const credential = payload.credential as Record<string, unknown> | undefined;
  if (
    Object.keys(payload).sort().join(",") !==
      "credential,draftCredentialEpoch,endpoint,kind,proxyMode,trigger" ||
    payload.trigger !== "manual" ||
    (payload.kind !== "openai" &&
      payload.kind !== "claude" &&
      payload.kind !== "deepseek" &&
      payload.kind !== "ollama") ||
    typeof payload.endpoint !== "string" ||
    !payload.endpoint ||
    (payload.proxyMode !== "system" && payload.proxyMode !== "direct") ||
    !Number.isInteger(payload.draftCredentialEpoch) ||
    (payload.draftCredentialEpoch as number) < 1 ||
    !credential ||
    typeof credential !== "object" ||
    Array.isArray(credential) ||
    Object.keys(credential).join(",") !== "apiKey" ||
    typeof credential.apiKey !== "string" ||
    !credential.apiKey.trim() ||
    credential.apiKey.length > 8_192
  )
    throw new Error("INVALID_MESSAGE");
  return envelope as ProviderModelsPreviewRequest;
}

export type ProviderModelsResult =
  | { requestId: string; ok: true; contextKey: string; models: string[] }
  | {
      requestId: string;
      ok: false;
      contextKey: string;
      category: string;
      retryable: boolean;
      statusCode?: number;
      code?: string;
      retryAfterMs?: number;
      userAction: string;
    };

export function parseProviderModelsResult(value: unknown): ProviderModelsResult {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_MESSAGE");
  const record = value as Record<string, unknown>;
  const commonValid =
    typeof record.requestId === "string" &&
    /^[A-Za-z0-9_.-]{1,128}$/.test(record.requestId) &&
    typeof record.ok === "boolean" &&
    typeof record.contextKey === "string" &&
    Boolean(record.contextKey);
  if (!commonValid) throw new Error("INVALID_MESSAGE");
  if (record.ok) {
    if (
      Object.keys(record).sort().join(",") !== "contextKey,models,ok,requestId" ||
      !Array.isArray(record.models) ||
      record.models.some((model) => typeof model !== "string" || !model.trim())
    )
      throw new Error("INVALID_MESSAGE");
    return record as ProviderModelsResult;
  }
  const allowed = new Set([
    "requestId",
    "ok",
    "contextKey",
    "category",
    "retryable",
    "statusCode",
    "code",
    "retryAfterMs",
    "userAction",
  ]);
  if (
    Object.keys(record).some((key) => !allowed.has(key)) ||
    typeof record.category !== "string" ||
    typeof record.retryable !== "boolean" ||
    typeof record.userAction !== "string" ||
    (record.statusCode !== undefined && !Number.isInteger(record.statusCode)) ||
    (record.retryAfterMs !== undefined &&
      (!Number.isInteger(record.retryAfterMs) || (record.retryAfterMs as number) < 0)) ||
    (record.code !== undefined &&
      (typeof record.code !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(record.code)))
  )
    throw new Error("INVALID_MESSAGE");
  return record as ProviderModelsResult;
}

export function sanitizedProfileView(profile: {
  profileId: string;
  revision: number;
  displayName: string;
  kind: "openai" | "claude" | "deepseek" | "ollama";
  endpoint: string;
  endpointFingerprint: string;
  proxyMode?: "system" | "direct";
  model?: string;
  credential?: Record<string, string>;
  modelCatalog?: { contextKey: string; models: string[] };
}): {
  profileId: string;
  revision: number;
  displayName: string;
  kind: "openai" | "claude" | "deepseek" | "ollama";
  endpoint: string;
  endpointFingerprint: string;
  proxyMode: "system" | "direct";
  model?: string;
  credentialConfigured: boolean;
  modelCatalog?: { contextKey: string; models: string[] };
} {
  return {
    profileId: profile.profileId,
    revision: profile.revision,
    displayName: profile.displayName,
    kind: profile.kind,
    endpoint: profile.endpoint,
    endpointFingerprint: profile.endpointFingerprint,
    proxyMode: profile.proxyMode ?? "system",
    ...(profile.model === undefined ? {} : { model: profile.model }),
    credentialConfigured: Boolean(
      profile.credential && Object.values(profile.credential).some(Boolean),
    ),
    ...(profile.modelCatalog
      ? {
          modelCatalog: {
            contextKey: profile.modelCatalog.contextKey,
            models: [...profile.modelCatalog.models],
          },
        }
      : {}),
  };
}

export function parseSecretSet(value: unknown): {
  profileId: string;
  expectedRevision: number;
  fields: Record<string, string>;
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_SECRET_SET");
  const input = value as Record<string, unknown>;
  if (
    typeof input.profileId !== "string" ||
    !Number.isInteger(input.expectedRevision) ||
    !input.fields ||
    typeof input.fields !== "object" ||
    Array.isArray(input.fields)
  ) {
    throw new Error("INVALID_SECRET_SET");
  }
  const fields = input.fields as Record<string, unknown>;
  if (
    Object.keys(fields).length === 0 ||
    Object.values(fields).some((field) => typeof field !== "string" || !field)
  )
    throw new Error("INVALID_SECRET_SET");
  if (Object.values(fields).some((field) => /[•●]{3,}|\*{4,}/.test(field as string)))
    throw new Error("MASKED_SECRET");
  return {
    profileId: input.profileId,
    expectedRevision: input.expectedRevision as number,
    fields: fields as Record<string, string>,
  };
}

export function parseProfileSelection(value: unknown): {
  profileId: string;
  revision: number;
  endpointFingerprint: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_SELECTION");
  const input = value as Record<string, unknown>;
  if (
    typeof input.profileId !== "string" ||
    !Number.isInteger(input.revision) ||
    (input.revision as number) < 1 ||
    typeof input.endpointFingerprint !== "string" ||
    !input.endpointFingerprint
  ) {
    throw new Error("INVALID_SELECTION");
  }
  return {
    profileId: input.profileId,
    revision: input.revision as number,
    endpointFingerprint: input.endpointFingerprint,
  };
}
import type { TranslationBatchProgress } from "../providers/types.js";
