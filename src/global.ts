import { identityHash, sha256Hex } from "./domain/identity.js";
import { normalizeProviderError } from "./domain/errors.js";
import {
  parseProfileSelection,
  parseOverlayPositionGet,
  parseOverlayPositionPreview,
  parseOverlayPositionSave,
  parseProviderModelsPreviewRequest,
  parseProviderModelsRequest,
  parseSecretSet,
  parseTargetLanguageSave,
  parseTranslationBatchProgress,
  sanitizedProfileView,
} from "./domain/messages.js";
import { HelperCredentialStore, CredentialStoreError } from "./credentials/store.js";
import { createDeferredPlayerPost } from "./adapters/iina/deferred-post.js";
import { IinaLocalHttpBridge, IinaProcessLauncher } from "./adapters/iina/provider-transport.js";
import { discoverHelperExecutable, TransportProcess } from "./adapters/iina/transport-process.js";
import { ProviderBroker } from "./providers/broker.js";
import { ProviderConnectionTests } from "./providers/connection-tests.js";
import { CredentialScopedProviderCache } from "./providers/provider-cache.js";
import { OllamaProvider } from "./providers/ollama.js";
import { OpenAICompatibleProvider } from "./providers/openai.js";
import { DeepSeekProvider } from "./providers/deepseek.js";
import { ProviderProfiles } from "./providers/profiles.js";
import { normalizeProviderEndpoint } from "./providers/profiles.js";
import { discoverProviderModels } from "./providers/model-discovery.js";
import type { ConfiguredProvider } from "./providers/provider.js";
import type { ProviderProfileSnapshot, TranslationBatchRequest } from "./providers/types.js";
import { HelperProviderTransport as ProviderTransportAdapter } from "./adapters/iina/provider-transport.js";
import { TransportClient } from "./transport/client.js";
import { TransportSupervisor } from "./transport/supervisor.js";
import {
  TargetLanguagePreferenceError,
  TargetLanguagePreferences,
} from "./adapters/iina/target-language-preferences.js";
import { OverlayPositionPreferences } from "./adapters/iina/overlay-position-preferences.js";
import { OverlayPositionAuthority } from "./adapters/iina/overlay-position-sync.js";

let idSequence = 0;
function localUuid(): string {
  const hex = sha256Hex(`subtandem:${Date.now()}:${++idSequence}`);
  const variant = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const profiles = new ProviderProfiles(localUuid);
const providerConnectionTests = new ProviderConnectionTests(localUuid);
const modelCredentialEpochs = new Map<string, number>();
const modelCatalogs = new Map<string, string[]>();
const modelCatalogKeysByProfile = new Map<string, Set<string>>();
const targetLanguagePreferences = new TargetLanguagePreferences(iina.preferences);
const overlayPositionPreferences = new OverlayPositionPreferences(iina.preferences);
const overlayPositionAuthority = new OverlayPositionAuthority(
  overlayPositionPreferences.read().position,
);

function advanceCredentialEpoch(profileId: string): number {
  const next = (modelCredentialEpochs.get(profileId) ?? 0) + 1;
  modelCredentialEpochs.set(profileId, next);
  return next;
}

try {
  targetLanguagePreferences.clearLegacySourcePreferences();
} catch (error) {
  void error;
}

function restoreProfileMetadata(): void {
  const raw = iina.preferences.get("providerProfilesJson");
  if (typeof raw !== "string") return;
  try {
    const saved: unknown = JSON.parse(raw);
    if (!Array.isArray(saved)) return;
    for (const item of saved) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const value = item as Record<string, unknown>;
      if (
        typeof value.profileId !== "string" ||
        !value.profileId ||
        typeof value.displayName !== "string" ||
        (value.kind !== "openai" && value.kind !== "deepseek" && value.kind !== "ollama") ||
        typeof value.endpoint !== "string" ||
        typeof value.model !== "string"
      )
        continue;
      try {
        profiles.save({
          profileId: value.profileId,
          expectedRevision: 0,
          displayName: value.displayName,
          kind: value.kind,
          endpoint: value.endpoint,
          model: value.model,
          proxyMode: value.proxyMode === "direct" ? "direct" : "system",
          ...(value.kind === "openai" &&
          (value.capability === "strict-json-schema" ||
            value.capability === "json-object" ||
            value.capability === "prompt-json")
            ? { capability: value.capability }
            : {}),
        });
      } catch {
        /* Ignore one invalid preference entry without losing valid profiles. */
      }
    }
  } catch {
    /* Corrupt non-secret metadata is equivalent to no saved profiles. */
  }
}

function persistProfileMetadata(): void {
  const saved = profiles.listLatest().map((profile) => ({
    profileId: profile.profileId,
    displayName: profile.displayName,
    kind: profile.kind,
    endpoint: profile.endpoint,
    model: profile.model ?? "",
    proxyMode: profile.proxyMode ?? "system",
    ...(profile.capability ? { capability: profile.capability } : {}),
  }));
  iina.preferences.set("providerProfilesJson", JSON.stringify(saved));
  iina.preferences.sync();
}

restoreProfileMetadata();

const transport = new TransportSupervisor(async () => {
  const session = await TransportProcess.bootstrap(
    new IinaProcessLauncher(iina.utils),
    { dataDirectory: iina.utils.resolvePath("@data/.") },
    discoverHelperExecutable({
      exists: (path) => iina.file.exists(path),
      resolvePath: (path) => iina.utils.resolvePath(path),
      list: (path) => iina.file.list(path, { includeSubDir: false }),
      read: (path) => iina.file.read(path) ?? null,
    }),
  );
  return new TransportClient(session, new IinaLocalHttpBridge(iina.http));
});

const credentials = new HelperCredentialStore(transport);
const modelTransport = new ProviderTransportAdapter(transport, localUuid);
const activeModelRequests = new Map<
  string,
  { requestId: string; jobId: string; profileId?: string }
>();

function clearProfileProviderCache(profileId: string): void {
  providerCache.clearProfile(profileId);
}

function clearProfileModelCatalogs(profileId: string): void {
  for (const key of modelCatalogKeysByProfile.get(profileId) ?? []) modelCatalogs.delete(key);
  modelCatalogKeysByProfile.delete(profileId);
}

async function cancelProfileModelRequests(profileId: string): Promise<void> {
  const matching = [...activeModelRequests].filter(
    ([, request]) => request.profileId === profileId,
  );
  for (const [playerId] of matching) activeModelRequests.delete(playerId);
  await Promise.allSettled(matching.map(([, request]) => modelTransport.cancel?.(request.jobId)));
}

function recordProfileModelCatalog(profileId: string, contextKey: string, models: string[]): void {
  modelCatalogs.set(contextKey, models);
  const keys = modelCatalogKeysByProfile.get(profileId) ?? new Set<string>();
  keys.add(contextKey);
  modelCatalogKeysByProfile.set(profileId, keys);
}

function modelContextKey(input: {
  kind: "openai" | "deepseek" | "ollama";
  endpoint: string;
  proxyMode: "system" | "direct";
  profileId?: string;
  profileRevision?: number;
  endpointFingerprint?: string;
  credentialEpoch: number;
}): string {
  return identityHash(input);
}

function profileModelContextKey(profile: ProviderProfileSnapshot): string {
  return modelContextKey({
    kind: profile.kind,
    endpoint: profile.endpoint,
    proxyMode: profile.proxyMode ?? "system",
    profileId: profile.profileId,
    profileRevision: profile.revision,
    endpointFingerprint: profile.endpointFingerprint,
    credentialEpoch: modelCredentialEpochs.get(profile.profileId) ?? 0,
  });
}

async function buildProvider(profile: ProviderProfileSnapshot): Promise<ConfiguredProvider> {
  const providerTransport = new ProviderTransportAdapter(transport, localUuid);
  switch (profile.kind) {
    case "openai": {
      if (!profile.model)
        throw {
          category: "model",
          retryable: false,
          providerCode: "MODEL_REQUIRED",
          userAction: "CHECK_MODEL",
        };
      const secret = await credentials.getSecret(profile.profileId);
      const openai = new OpenAICompatibleProvider(
        {
          endpoint: profile.endpoint,
          model: profile.model,
          ...(secret?.apiKey ? { apiKey: secret.apiKey } : {}),
          ...(profile.capability ? { capability: profile.capability } : {}),
          proxyMode: profile.proxyMode ?? "system",
          sessionId: localUuid(),
        },
        providerTransport,
      );
      return openai;
    }
    case "ollama": {
      if (!profile.model)
        throw {
          category: "model",
          retryable: false,
          providerCode: "MODEL_REQUIRED",
          userAction: "CHECK_MODEL",
        };
      const secret = await credentials.getSecret(profile.profileId);
      return new OllamaProvider(
        {
          endpoint: profile.endpoint,
          model: profile.model,
          ...(secret?.apiKey ? { apiKey: secret.apiKey } : {}),
          proxyMode: profile.proxyMode ?? "system",
        },
        providerTransport,
      );
    }
    case "deepseek": {
      if (!profile.model)
        throw {
          category: "model",
          retryable: false,
          providerCode: "MODEL_REQUIRED",
          userAction: "CHECK_MODEL",
        };
      const secret = await credentials.getSecret(profile.profileId);
      return new DeepSeekProvider(
        {
          endpoint: profile.endpoint,
          model: profile.model,
          ...(secret?.apiKey ? { apiKey: secret.apiKey } : {}),
          proxyMode: profile.proxyMode ?? "system",
        },
        providerTransport,
      );
    }
  }
  throw new Error("UNSUPPORTED_PROVIDER_KIND");
}

const providerCache = new CredentialScopedProviderCache(
  (profileId) => modelCredentialEpochs.get(profileId) ?? 0,
  buildProvider,
);

function providerFor(profile: ProviderProfileSnapshot): Promise<ConfiguredProvider> {
  return providerCache.get(profile);
}

const broker = new ProviderBroker(profiles, providerFor);

function credentialFailure(error: unknown): {
  state: "unavailable";
  code: string;
  category: string;
  userAction: string;
} {
  if (error instanceof CredentialStoreError) {
    return {
      state: "unavailable",
      code: error.code,
      category: "configuration",
      userAction: "RESTART_IINA",
    };
  }
  const safe = normalizeProviderError(error);
  if (safe.providerCode && safe.providerCode !== "UNKNOWN_PROVIDER_ERROR") {
    return {
      state: "unavailable",
      code: safe.providerCode,
      category: safe.category,
      userAction: safe.userAction,
    };
  }
  return {
    state: "unavailable",
    code: "CREDENTIAL_STORE_UNAVAILABLE",
    category: "protocol",
    userAction: "RESTART_IINA",
  };
}

function payload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("INVALID_MESSAGE");
  const value = (raw as Record<string, unknown>).payload;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_MESSAGE");
  return value as Record<string, unknown>;
}

function requestId(raw: unknown): string {
  const value =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>).requestId : undefined;
  return typeof value === "string" ? value : localUuid();
}

function supportedProviderKind(value: unknown): "openai" | "deepseek" | "ollama" {
  if (value === "openai" || value === "deepseek" || value === "ollama") return value;
  throw new Error("UNSUPPORTED_PROVIDER_KIND");
}

// IINA 1.4.4 traps when a global handler synchronously posts back through
// JavascriptAPIGlobalController. Crossing a timer boundary also keeps every
// reply outside the originating JavaScriptCore callback.
const postToPlayer = createDeferredPlayerPost(
  (playerId, name, data) => iina.global.postMessage(playerId, name, data),
  setTimeout,
);

async function profileViews(): Promise<unknown[]> {
  return Promise.all(
    profiles.listLatest().map(async (profile) => {
      let credential: Record<string, string> | null = null;
      try {
        credential = await credentials.getSecret(profile.profileId);
      } catch {
        credential = null;
      }
      const contextKey = profileModelContextKey(profile);
      const models = modelCatalogs.get(contextKey);
      return sanitizedProfileView({
        ...profile,
        ...(credential ? { credential } : {}),
        ...(models ? { modelCatalog: { contextKey, models } } : {}),
      });
    }),
  );
}

iina.global.onMessage("defaults:save", (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  try {
    const message = parseTargetLanguageSave(raw);
    targetLanguagePreferences.save(message.payload.targetLanguage);
    postToPlayer(playerId, "defaults:saved", {
      requestId: message.requestId,
      targetLanguage: message.payload.targetLanguage,
    });
  } catch (error) {
    const code =
      error instanceof TargetLanguagePreferenceError ? error.code : "TARGET_LANGUAGE_SAVE_FAILED";
    postToPlayer(playerId, "operation:error", {
      requestId: requestId(raw),
      code,
      userAction: "NONE",
    });
  }
});

iina.global.onMessage("overlay-position:get", (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  try {
    parseOverlayPositionGet(raw);
    postToPlayer(playerId, "overlay-position:state", overlayPositionAuthority.snapshot());
  } catch {
    return;
  }
});

iina.global.onMessage("overlay-position:preview", (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  try {
    const message = parseOverlayPositionPreview(raw);
    const state = overlayPositionAuthority.preview(message.payload.position);
    postToPlayer(null, "overlay-position:state", state);
  } catch {
    return;
  }
});

iina.global.onMessage("overlay-position:save", (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  let requestId = "overlay-position.invalid";
  try {
    const message = parseOverlayPositionSave(raw);
    requestId = message.requestId;
    const intent = overlayPositionAuthority.beginSave(message.payload.position);
    try {
      overlayPositionPreferences.save(message.payload.position);
      const state = overlayPositionAuthority.commit(intent);
      postToPlayer(null, "overlay-position:state", state);
      postToPlayer(playerId, "overlay-position:save-result", {
        requestId,
        ok: true,
        position: state.position,
        intentSequence: state.intentSequence,
        committedRevision: state.committedRevision,
      });
    } catch {
      const state = overlayPositionAuthority.fail(intent);
      postToPlayer(null, "overlay-position:state", state);
      postToPlayer(playerId, "overlay-position:save-result", {
        requestId,
        ok: false,
        code: "OVERLAY_POSITION_SAVE_FAILED",
        userAction: "NONE",
        committedPosition: state.committedPosition,
        intentSequence: state.intentSequence,
        committedRevision: state.committedRevision,
      });
    }
  } catch {
    return;
  }
});

iina.global.onMessage("profiles:list", async (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  postToPlayer(playerId, "profiles:result", {
    requestId: requestId(raw),
    profiles: await profileViews(),
  });
});

iina.global.onMessage("provider:models", async (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  let externalRequestId = requestId(raw);
  let contextKey = "invalid";
  let owner: { requestId: string; jobId: string; profileId?: string } | null = null;
  try {
    const message = parseProviderModelsRequest(raw);
    externalRequestId = message.requestId;
    const values = message.payload;
    const endpoint = normalizeProviderEndpoint(values.kind, values.endpoint);
    const profile = values.profileId
      ? profiles.get(values.profileId, values.profileRevision)
      : null;
    const authorized = Boolean(
      profile &&
      profile!.revision === values.profileRevision &&
      profile!.kind === values.kind &&
      profile!.endpoint === endpoint &&
      (profile!.proxyMode ?? "system") === values.proxyMode &&
      profile!.endpointFingerprint === values.endpointFingerprint,
    );
    const credentialEpoch =
      authorized && profile ? (modelCredentialEpochs.get(profile.profileId) ?? 0) : 0;
    contextKey = modelContextKey({
      kind: values.kind,
      endpoint,
      proxyMode: values.proxyMode,
      ...(authorized && profile
        ? {
            profileId: profile.profileId,
            profileRevision: profile.revision,
            endpointFingerprint: profile.endpointFingerprint,
          }
        : {}),
      credentialEpoch,
    });
    const previous = activeModelRequests.get(playerId);
    if (previous) await modelTransport.cancel?.(previous.jobId);
    const jobId = `models-${localUuid()}`;
    owner = {
      requestId: message.requestId,
      jobId,
      ...(authorized && profile ? { profileId: profile.profileId } : {}),
    };
    activeModelRequests.set(playerId, owner);
    let apiKey: string | undefined;
    if (authorized && profile) {
      const secret = await credentials.getSecret(profile.profileId);
      apiKey = secret?.apiKey;
    }
    const models = await discoverProviderModels(
      {
        jobId,
        kind: values.kind,
        endpoint,
        ...(apiKey ? { apiKey } : {}),
        proxyMode: values.proxyMode,
      },
      modelTransport,
    );
    if (activeModelRequests.get(playerId) !== owner) return;
    activeModelRequests.delete(playerId);
    if (authorized && profile) recordProfileModelCatalog(profile.profileId, contextKey, models);
    else modelCatalogs.set(contextKey, models);
    postToPlayer(playerId, "provider:models-result", {
      requestId: message.requestId,
      ok: true,
      contextKey,
      models,
    });
  } catch (error) {
    const active = activeModelRequests.get(playerId);
    if (owner && active !== owner) return;
    if (active && active.requestId !== externalRequestId) return;
    if (active?.requestId === externalRequestId) activeModelRequests.delete(playerId);
    const safe = normalizeProviderError(error);
    postToPlayer(playerId, "provider:models-result", {
      requestId: externalRequestId,
      ok: false,
      contextKey,
      category: safe.category,
      retryable: safe.retryable,
      ...(safe.statusCode === undefined ? {} : { statusCode: safe.statusCode }),
      ...(safe.providerCode ? { code: safe.providerCode } : {}),
      ...(safe.retryAfterMs === undefined ? {} : { retryAfterMs: safe.retryAfterMs }),
      userAction: safe.userAction,
    });
  }
});

iina.global.onMessage("provider:models-preview", async (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  let externalRequestId = requestId(raw);
  let contextKey = "invalid";
  let owner: { requestId: string; jobId: string } | null = null;
  try {
    const message = parseProviderModelsPreviewRequest(raw);
    externalRequestId = message.requestId;
    const values = message.payload;
    const endpoint = normalizeProviderEndpoint(values.kind, values.endpoint);
    contextKey = identityHash({
      playerId,
      requestId: message.requestId,
      kind: values.kind,
      endpoint,
      proxyMode: values.proxyMode,
      draftCredentialEpoch: values.draftCredentialEpoch,
    });
    const previous = activeModelRequests.get(playerId);
    if (previous) await modelTransport.cancel?.(previous.jobId);
    const jobId = `models-${localUuid()}`;
    owner = { requestId: message.requestId, jobId };
    activeModelRequests.set(playerId, owner);
    const models = await discoverProviderModels(
      {
        jobId,
        kind: values.kind,
        endpoint,
        apiKey: values.credential.apiKey,
        proxyMode: values.proxyMode,
      },
      modelTransport,
    );
    if (activeModelRequests.get(playerId) !== owner) return;
    activeModelRequests.delete(playerId);
    postToPlayer(playerId, "provider:models-result", {
      requestId: message.requestId,
      ok: true,
      contextKey,
      models,
    });
  } catch (error) {
    const active = activeModelRequests.get(playerId);
    if (owner && active !== owner) return;
    if (active && active.requestId !== externalRequestId) return;
    if (active?.requestId === externalRequestId) activeModelRequests.delete(playerId);
    const safe = normalizeProviderError(error);
    postToPlayer(playerId, "provider:models-result", {
      requestId: externalRequestId,
      ok: false,
      contextKey,
      category: safe.category,
      retryable: safe.retryable,
      ...(safe.statusCode === undefined ? {} : { statusCode: safe.statusCode }),
      ...(safe.providerCode ? { code: safe.providerCode } : {}),
      ...(safe.retryAfterMs === undefined ? {} : { retryAfterMs: safe.retryAfterMs }),
      userAction: safe.userAction,
    });
  }
});

iina.global.onMessage("profile:create-revision", async (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  try {
    const values = payload(raw);
    const kind = supportedProviderKind(values.kind);
    const profileId = typeof values.profileId === "string" ? values.profileId : undefined;
    const expectedRevision =
      typeof values.expectedRevision === "number" ? values.expectedRevision : undefined;
    const currentProfile = profileId ? profiles.get(profileId) : null;
    const endpoint = normalizeProviderEndpoint(kind, String(values.endpoint ?? ""));
    const model = typeof values.model === "string" ? values.model.trim() : "";
    if (!model) throw new Error("MODEL_REQUIRED");
    if (currentProfile && currentProfile.revision !== expectedRevision)
      throw new Error("STALE_PROFILE_REVISION");
    const kindChanged = Boolean(currentProfile && currentProfile.kind !== kind);
    if (kindChanged && profileId) {
      await Promise.all([
        broker.cancelProfile(profileId),
        providerConnectionTests.cancelProfile(profileId),
        cancelProfileModelRequests(profileId),
      ]);
      await credentials.deleteSecret(profileId);
      advanceCredentialEpoch(profileId);
      clearProfileProviderCache(profileId);
      clearProfileModelCatalogs(profileId);
    }
    const previousSelection = profiles.selection(playerId);
    const profile = profiles.save({
      ...(profileId ? { profileId } : {}),
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
      editingWindowId: playerId,
      displayName: String(values.displayName ?? "Provider"),
      kind,
      endpoint,
      proxyMode: values.proxyMode === "direct" ? "direct" : "system",
      model,
    });
    if (!kindChanged)
      await Promise.all([
        broker.cancelProfile(profile.profileId),
        providerConnectionTests.cancelProfile(profile.profileId),
        cancelProfileModelRequests(profile.profileId),
      ]);
    clearProfileProviderCache(profile.profileId);
    clearProfileModelCatalogs(profile.profileId);
    persistProfileMetadata();
    postToPlayer(playerId, "profile:revision-created", {
      requestId: requestId(raw),
      profile: sanitizedProfileView(profile),
      selectionInvalidated:
        previousSelection?.profileId === profile.profileId && profile.revision > 1,
    });
  } catch {
    postToPlayer(playerId, "operation:error", {
      requestId: requestId(raw),
      code: "PROFILE_SAVE_FAILED",
      userAction: "CHECK_ENDPOINT",
    });
  }
});

iina.global.onMessage("profile:delete", async (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  try {
    const values = payload(raw);
    const profileId = String(values.profileId ?? "");
    const expectedRevision = Number(values.expectedRevision);
    const profile = profiles.get(profileId);
    if (!profile || profile.revision !== expectedRevision)
      throw new Error("STALE_PROFILE_REVISION");
    await broker.cancelProfile(profileId);
    await providerConnectionTests.cancelProfile(profileId);
    await cancelProfileModelRequests(profileId);
    await credentials.deleteSecret(profileId);
    advanceCredentialEpoch(profileId);
    const affectedPlayerIds = profiles.delete(profileId);
    clearProfileProviderCache(profileId);
    clearProfileModelCatalogs(profileId);
    persistProfileMetadata();
    for (const target of new Set([playerId, ...affectedPlayerIds]))
      postToPlayer(target, "profile:deleted", {
        requestId: requestId(raw),
        profileId,
        selectionInvalidated: affectedPlayerIds.includes(target),
      });
  } catch {
    postToPlayer(playerId, "operation:error", {
      requestId: requestId(raw),
      code: "PROFILE_DELETE_FAILED",
      userAction: "NONE",
    });
  }
});

iina.global.onMessage("credential:set", async (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  try {
    const secret = parseSecretSet(payload(raw));
    const profile = profiles.get(secret.profileId);
    if (!profile || profile.revision !== secret.expectedRevision)
      throw new Error("STALE_PROFILE_REVISION");
    await credentials.setSecret(secret.profileId, secret.fields);
    await Promise.all([
      broker.cancelProfile(secret.profileId),
      providerConnectionTests.cancelProfile(secret.profileId),
      cancelProfileModelRequests(secret.profileId),
    ]);
    advanceCredentialEpoch(secret.profileId);
    clearProfileProviderCache(secret.profileId);
    clearProfileModelCatalogs(secret.profileId);
    postToPlayer(playerId, "credential:result", {
      requestId: requestId(raw),
      state: "ready",
      profileId: secret.profileId,
    });
  } catch (error) {
    const failure = credentialFailure(error);
    postToPlayer(playerId, "credential:state", {
      requestId: requestId(raw),
      ...failure,
    });
  }
});

iina.global.onMessage("profile:select", (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  try {
    const selection = parseProfileSelection(payload(raw));
    const authorized = broker.select(
      playerId,
      selection.profileId,
      selection.revision,
      selection.endpointFingerprint,
    );
    broker.lease(playerId, selection.profileId, selection.revision);
    postToPlayer(playerId, "profile:selected", {
      requestId: requestId(raw),
      selection: authorized,
    });
  } catch {
    postToPlayer(playerId, "operation:error", {
      requestId: requestId(raw),
      code: "PROFILE_SELECTION_FAILED",
      userAction: "SELECT_PROFILE",
    });
  }
});

iina.global.onMessage("provider:test", async (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  const externalRequestId = requestId(raw);
  let testId: string | null = null;
  try {
    const values = payload(raw);
    const profile = profiles.get(String(values.profileId));
    if (!profile || profile.revision !== Number(values.revision))
      throw new Error("PROFILE_NOT_FOUND");
    const provider = await providerFor(profile);
    if (profiles.get(profile.profileId)?.revision !== profile.revision)
      throw new Error("PROFILE_NOT_FOUND");
    const task = providerConnectionTests.start({
      playerId,
      requestId: externalRequestId,
      profileId: profile.profileId,
      profileRevision: profile.revision,
      provider,
    });
    testId = task.testId;
    const result = await provider.testConnection(task.testId);
    const completed = providerConnectionTests.complete(task.testId);
    if (!completed) return;
    testId = null;
    postToPlayer(completed.playerId, "provider:test-result", {
      requestId: completed.requestId,
      ok: true,
      result,
    });
  } catch (error) {
    const completed = testId ? providerConnectionTests.complete(testId) : null;
    if (testId && !completed) return;
    const safe = normalizeProviderError(error);
    postToPlayer(completed?.playerId ?? playerId, "provider:test-result", {
      requestId: completed?.requestId ?? externalRequestId,
      ok: false,
      category: safe.category,
      retryable: safe.retryable,
      ...(safe.statusCode === undefined ? {} : { statusCode: safe.statusCode }),
      ...(safe.providerCode ? { code: safe.providerCode } : {}),
      ...(safe.retryAfterMs === undefined ? {} : { retryAfterMs: safe.retryAfterMs }),
      userAction: safe.userAction,
    });
  }
});

iina.global.onMessage("provider:attempt", async (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  const id = requestId(raw);
  try {
    const request = payload(raw) as unknown as TranslationBatchRequest;
    if (request.requestId !== id) throw new Error("REQUEST_ID_MISMATCH");
    const result = await broker.attempt(playerId, request, (progress) => {
      try {
        postToPlayer(playerId, "provider:attempt-progress", {
          requestId: id,
          progress: parseTranslationBatchProgress(progress),
        });
      } catch {
        return;
      }
    });
    postToPlayer(playerId, "provider:attempt-result", { requestId: id, result });
  } catch (error) {
    const safe = normalizeProviderError(error);
    postToPlayer(playerId, "provider:attempt-error", {
      requestId: id,
      error: safe,
    });
  }
});

iina.global.onMessage("provider:cancel", async (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  const values = payload(raw);
  await broker.cancel(playerId, String(values.requestId ?? requestId(raw)));
  postToPlayer(playerId, "provider:cancelled", { requestId: requestId(raw) });
});

iina.global.onMessage("profile:release", async (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  const values = payload(raw);
  await providerConnectionTests.cancelPlayer(playerId);
  broker.release(playerId, String(values.profileId), Number(values.revision));
});

async function prefetchProfileModels(profile: ProviderProfileSnapshot): Promise<void> {
  const credentialEpoch = modelCredentialEpochs.get(profile.profileId) ?? 0;
  const contextKey = profileModelContextKey(profile);
  let apiKey: string | undefined;
  try {
    const secret = await credentials.getSecret(profile.profileId);
    apiKey = secret?.apiKey;
  } catch {
    apiKey = undefined;
  }
  const models = await discoverProviderModels(
    {
      jobId: `models-startup-${localUuid()}`,
      kind: profile.kind,
      endpoint: profile.endpoint,
      ...(apiKey ? { apiKey } : {}),
      proxyMode: profile.proxyMode ?? "system",
    },
    modelTransport,
  );
  const current = profiles.get(profile.profileId);
  if (
    !current ||
    current.revision !== profile.revision ||
    (modelCredentialEpochs.get(profile.profileId) ?? 0) !== credentialEpoch
  )
    return;
  recordProfileModelCatalog(profile.profileId, contextKey, models);
}

setTimeout(() => {
  for (const profile of profiles.listLatest())
    void prefetchProfileModels(profile).catch(() => undefined);
}, 0);
