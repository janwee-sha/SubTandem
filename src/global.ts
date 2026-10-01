import type {
  CredentialReference,
  CredentialOwner,
  DraftOperationReference,
} from "../shared/credential-protocol.js";
import { CredentialChannelRelay } from "./adapters/iina/global-rpc.js";
import {
  parseCredentialSource,
  parseDraftOperationReference,
  credentialAssert,
} from "../shared/credential-protocol.js";
import { RequestLifecycle, type RequestOwner } from "./providers/request-lifecycle.js";
import { identityHash, sha256Hex } from "./domain/identity.js";
import { normalizeProviderError } from "./domain/errors.js";
import {
  parseOverlayPositionGet,
  parseOverlayPositionPreview,
  parseOverlayPositionSave,
  parseSubtitleStyleEdit,
  parseSubtitleStyleGet,
  parseSubtitleStylePickerOpen,
  parseProviderModelsRequest,
  parseProviderModelsCancelRequest,
  type ProviderModelsRequest,
  parseProviderTestCancelRequest,
  parseProviderTestRequest,
  parseProviderAttempt,
  parseProfileActivationGet,
  parseProfileActivationSet,
  parseProfileDeleteRequest,
  parseProfileSaveRequest,
  parseTargetLanguageSave,
  parseTranslationBatchProgress,
  sanitizedProfileView,
  parseProviderDraftRequest,
  providerDraftSnapshot,
  type ProviderDraftRequest,
} from "./domain/messages.js";
import { HelperProfileStateStore } from "./credentials/store.js";
import { hostClock, hostTimers } from "./adapters/iina/host-timers.js";
import { GlobalMailbox, IinaGlobalMailboxFileStore } from "./adapters/iina/global-mailbox.js";
import {
  IinaFileRpcBridge,
  IinaProcessLauncher,
  IinaReadyFileStore,
} from "./adapters/iina/provider-transport.js";
import { discoverHelperExecutable, TransportProcess } from "./adapters/iina/transport-process.js";
import { ProviderBroker } from "./providers/broker.js";
import { ProviderConnectionTests } from "./providers/connection-tests.js";
import { CredentialScopedProviderCache } from "./providers/provider-cache.js";
import { OllamaProvider } from "./providers/ollama.js";
import { OpenAICompatibleProvider } from "./providers/openai.js";
import { DeepSeekProvider } from "./providers/deepseek.js";
import { ClaudeProvider } from "./providers/claude.js";
import { ProviderProfiles, normalizeLegacyProviderProfiles } from "./providers/profiles.js";
import { restoreProfileActivationAuthority } from "./providers/profile-activation.js";
import type { ProfileActivationAuthority } from "./providers/profile-activation.js";
import { normalizeProviderEndpoint, sameProviderService } from "./providers/profiles.js";
import { discoverProviderModels } from "./providers/model-discovery.js";
import type { ConfiguredProvider } from "./providers/provider.js";
import type { ProviderTransport } from "./providers/transport.js";
import type { ProviderConnectionTestTask } from "./providers/connection-tests.js";
import type { ProviderProfileSnapshot } from "./providers/types.js";
import { HelperProviderTransport as ProviderTransportAdapter } from "./adapters/iina/provider-transport.js";
import { TransportClient } from "./transport/client.js";
import { TransportSupervisor } from "./transport/supervisor.js";
import {
  TargetLanguagePreferenceError,
  TargetLanguagePreferences,
} from "./adapters/iina/target-language-preferences.js";
import { OverlayPositionPreferences } from "./adapters/iina/overlay-position-preferences.js";
import { OverlayPositionAuthority } from "./adapters/iina/overlay-position-sync.js";
import { SubtitleStylePreferences } from "./adapters/iina/subtitle-style-preferences.js";
import { SubtitleStyleAuthority } from "./adapters/iina/subtitle-style-sync.js";
import {
  discoverStylePickerExecutable,
  IinaStylePickerHttpBridge,
  IinaStylePickerProcessLauncher,
  StylePickerClient,
  StylePickerProcess,
  type StylePickerEvent,
} from "./adapters/iina/style-picker-client.js";
import {
  createFontResolution,
  type ColorStyleField,
  type RgbaColor,
} from "./domain/subtitle-style.js";

if (iina.global) iina.global.onMessage("runtime:tick", () => hostClock.pulse());

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
const subtitleStylePreferences = new SubtitleStylePreferences(iina.preferences);
const subtitleStyleAuthority = new SubtitleStyleAuthority(subtitleStylePreferences.read().style);

function advanceCredentialEpoch(profileId: string): number {
  const next = (modelCredentialEpochs.get(profileId) ?? 0) + 1;
  modelCredentialEpochs.set(profileId, next);
  return next;
}

function legacyProfileMetadata(required = false): ProviderProfileSnapshot[] {
  const raw = iina.preferences.get("providerProfilesJson");
  if (required && typeof raw !== "string") throw new Error("LEGACY_METADATA_UNAVAILABLE");
  return normalizeLegacyProviderProfiles(raw);
}

function clearLegacyProfilePreferences(): boolean {
  try {
    iina.preferences.set("providerProfilesJson", "");
    iina.preferences.sync();
    const remaining = iina.preferences.get("providerProfilesJson");
    return remaining === undefined || remaining === null || remaining === "";
  } catch {
    return false;
  }
}

const transport = new TransportSupervisor(async () => {
  const dataDirectory = iina.utils.resolvePath("@data/.");
  const launcher = new IinaProcessLauncher(iina.utils);
  const files = new IinaReadyFileStore(iina.file);
  const executable = discoverHelperExecutable({
    exists: (path) => iina.file.exists(path),
    resolvePath: (path) => iina.utils.resolvePath(path),
    list: (path) => iina.file.list(path, { includeSubDir: false }),
    read: (path) => iina.file.read(path) ?? null,
  });
  const session = await TransportProcess.bootstrap(
    launcher,
    files,
    { dataDirectory, fileDirectory: "@data", mailboxDirectory: iina.utils.resolvePath("@tmp/.") },
    executable,
  );
  return new TransportClient(
    session,
    new IinaFileRpcBridge(files, {
      helper: "transport",
      fileDirectory: session.rpcDirectory,
      maxRequestBytes: 2_097_152,
      maxResponseBytes: 4_194_304,
      maxConcurrentRequests: 8,
    }),
  );
});

const profileStateStore = new HelperProfileStateStore(transport);
const modelTransport = new ProviderTransportAdapter(transport, localUuid);
interface ModelRequestContext {
  jobId: string;
  contextKey: string;
  kind: "openai" | "claude" | "deepseek" | "ollama";
  endpoint: string;
  proxyMode: "system" | "direct";
  profileId?: string;
  profileRevision?: number;
  endpointFingerprint?: string;
  credentialEpoch: number;
}
type ActiveModelRequest = RequestOwner<ModelRequestContext>;
const modelRequests = new RequestLifecycle<ModelRequestContext>();

function assertSavedModelOwner(owner: ActiveModelRequest): void {
  modelRequests.assertActive(owner);
  const context = owner.context;
  if (!context.profileId) return;
  const current = profiles.get(context.profileId);
  if (
    !current ||
    current.revision !== context.profileRevision ||
    current.endpointFingerprint !== context.endpointFingerprint ||
    (modelCredentialEpochs.get(context.profileId) ?? 0) !== context.credentialEpoch
  ) {
    throw { category: "cancelled", retryable: false, userAction: "RETRY" };
  }
}

function clearProfileProviderCache(profileId: string): void {
  providerCache.clearProfile(profileId);
}

function clearProfileModelCatalogs(profileId: string): void {
  for (const key of modelCatalogKeysByProfile.get(profileId) ?? []) modelCatalogs.delete(key);
  modelCatalogKeysByProfile.delete(profileId);
}

async function cancelProfileModelRequests(profileId: string): Promise<void> {
  await modelRequests.cancelWhere((owner) => owner.context.profileId === profileId);
}

function recordProfileModelCatalog(profileId: string, contextKey: string, models: string[]): void {
  modelCatalogs.set(contextKey, models);
  const keys = modelCatalogKeysByProfile.get(profileId) ?? new Set<string>();
  keys.add(contextKey);
  modelCatalogKeysByProfile.set(profileId, keys);
}

function modelContextKey(input: {
  kind: "openai" | "claude" | "deepseek" | "ollama";
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

function savedCredentialReference(profile: ProviderProfileSnapshot): CredentialReference {
  return {
    source: "saved",
    profileId: profile.profileId,
    profileRevision: profile.revision,
    kind: profile.kind,
    endpointFingerprint: profile.endpointFingerprint,
  };
}

async function buildProvider(
  profile: ProviderProfileSnapshot,
  senderId: string,
): Promise<ConfiguredProvider> {
  if (!profile.model)
    throw {
      category: "model",
      retryable: false,
      providerCode: "MODEL_REQUIRED",
      userAction: "CHECK_MODEL",
    };
  const epoch = modelCredentialEpochs.get(profile.profileId) ?? 0;
  const guard = () => {
    const current = profiles.get(profile.profileId);
    if (
      !current ||
      current.revision !== profile.revision ||
      current.endpointFingerprint !== profile.endpointFingerprint ||
      (modelCredentialEpochs.get(profile.profileId) ?? 0) !== epoch
    )
      throw {
        category: "cancelled",
        retryable: false,
        providerCode: "CREDENTIAL_CONTEXT_CHANGED",
        userAction: "NONE",
      };
  };
  guard();
  const credential = savedCredentialReference(profile);
  const providerTransport = new ProviderTransportAdapter(transport, localUuid);
  switch (profile.kind) {
    case "openai": {
      const openai = new OpenAICompatibleProvider(
        {
          endpoint: profile.endpoint,
          model: profile.model,
          credential,
          senderId,
          ...(profile.capability ? { capability: profile.capability } : {}),
          proxyMode: profile.proxyMode ?? "system",
          sessionId: localUuid(),
        },
        providerTransport,
      );
      return openai;
    }
    case "ollama": {
      return new OllamaProvider(
        {
          endpoint: profile.endpoint,
          model: profile.model,
          credential,
          senderId,
          proxyMode: profile.proxyMode ?? "system",
        },
        providerTransport,
      );
    }
    case "claude": {
      return new ClaudeProvider(
        {
          endpoint: profile.endpoint,
          model: profile.model,
          credential,
          senderId,
          proxyMode: profile.proxyMode ?? "system",
        },
        providerTransport,
      );
    }
    case "deepseek": {
      return new DeepSeekProvider(
        {
          endpoint: profile.endpoint,
          model: profile.model,
          credential,
          senderId,
          proxyMode: profile.proxyMode ?? "system",
        },
        providerTransport,
      );
    }
  }
  throw new Error("UNSUPPORTED_PROVIDER_KIND");
}

function assertActiveDraftTestOwner(owner: ProviderConnectionTestTask): void {
  if (!providerConnectionTests.isActive(owner))
    throw {
      category: "cancelled",
      retryable: false,
      providerCode: "REQUEST_CANCELLED",
      userAction: "RETRY",
    };
}

function assertDraftTestOwner(owner: ProviderConnectionTestTask): void {
  assertActiveDraftTestOwner(owner);
  const source = owner.sourceProfile;
  if (!source) return;
  const current = profiles.get(source.profileId);
  if (
    !current ||
    current.revision !== source.profileRevision ||
    current.endpointFingerprint !== source.endpointFingerprint ||
    (modelCredentialEpochs.get(source.profileId) ?? 0) !== owner.credentialEpoch
  )
    throw {
      category: "configuration",
      retryable: false,
      providerCode: "CREDENTIAL_CONTEXT_CHANGED",
      userAction: "RETRY",
    };
}

function draftTestTransport(owner: ProviderConnectionTestTask): ProviderTransport {
  const base = new ProviderTransportAdapter(transport, localUuid);
  return {
    request: async (request) => {
      assertDraftTestOwner(owner);
      const response = await base.request({
        ...request,
        assertActive: () => {
          assertDraftTestOwner(owner);
          request.assertActive?.();
        },
      });
      assertDraftTestOwner(owner);
      return response;
    },
    cancel: (jobId) => base.cancel(jobId),
  };
}

function buildDraftProvider(
  input: {
    kind: "openai" | "claude" | "deepseek" | "ollama";
    endpoint: string;
    model: string;
    proxyMode: "system" | "direct";
    credential: CredentialReference;
    senderId: string;
  },
  providerTransport: ProviderTransport,
): ConfiguredProvider {
  switch (input.kind) {
    case "openai":
      return new OpenAICompatibleProvider(
        {
          endpoint: input.endpoint,
          model: input.model,
          credential: input.credential,
          senderId: input.senderId,
          proxyMode: input.proxyMode,
          sessionId: localUuid(),
        },
        providerTransport,
      );
    case "claude":
      return new ClaudeProvider(
        {
          endpoint: input.endpoint,
          model: input.model,
          credential: input.credential,
          senderId: input.senderId,
          proxyMode: input.proxyMode,
        },
        providerTransport,
      );
    case "deepseek":
      return new DeepSeekProvider(
        {
          endpoint: input.endpoint,
          model: input.model,
          credential: input.credential,
          senderId: input.senderId,
          proxyMode: input.proxyMode,
        },
        providerTransport,
      );
    case "ollama":
      return new OllamaProvider(
        {
          endpoint: input.endpoint,
          model: input.model,
          credential: input.credential,
          senderId: input.senderId,
          proxyMode: input.proxyMode,
        },
        providerTransport,
      );
  }
}

function providerTestCode(category: string, providerCode?: string): string {
  if (
    providerCode &&
    [
      "CREDENTIAL_REQUIRED",
      "MODEL_REQUIRED",
      "PROFILE_NOT_FOUND",
      "CREDENTIAL_CONTEXT_CHANGED",
      "REQUEST_CANCELLED",
      "TEST_INVALIDATED",
      "UNKNOWN_PROVIDER_ERROR",
    ].includes(providerCode)
  )
    return providerCode;
  if (category === "authentication") return "CREDENTIAL_REQUIRED";
  if (category === "model") return "MODEL_REQUIRED";
  if (category === "cancelled") return "REQUEST_CANCELLED";
  return "PROVIDER_TEST_FAILED";
}

async function invalidateProfileConnectionTests(profileId: string): Promise<void> {
  await providerConnectionTests.invalidateProfile(profileId, (invalidated) => {
    for (const identity of invalidated) {
      postToPlayer(identity.senderId, "provider:test-result", {
        requestId: identity.requestId,
        drawerId: identity.drawerId,
        draftRevision: identity.draftRevision,
        ok: false,
        category: "cancelled",
        retryable: false,
        code: "TEST_INVALIDATED",
        userAction: "RETRY",
      });
    }
  });
}

const providerCache = new CredentialScopedProviderCache(
  (profileId) => modelCredentialEpochs.get(profileId) ?? 0,
  buildProvider,
);

function providerFor(
  profile: ProviderProfileSnapshot,
  senderId: string,
): Promise<ConfiguredProvider> {
  return providerCache.get(profile, senderId);
}

let profileAuthority!: ProfileActivationAuthority;
let broker!: ProviderBroker;
const profilePlayers = new Set<string>();
interface TranslationContext {
  sessionId: string;
  sessionEpoch: number;
  windowEpoch: number;
}
const translationRequests = new RequestLifecycle<TranslationContext>();
const translationSessions = new Map<string, TranslationContext>();

let profileStorageStatus: string | null = null;
const profileReady = (async () => {
  profileAuthority = await restoreProfileActivationAuthority({
    authorityId: localUuid(),
    profiles,
    store: profileStateStore,
    createCommitId: localUuid,
    loadLegacyProfiles: legacyProfileMetadata,
    clearLegacyPreferences: clearLegacyProfilePreferences,
    onStorageStatus: (code) => {
      profileStorageStatus = code;
    },
  });
  broker = new ProviderBroker(profiles, profileAuthority, providerFor);
})();

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

const globalMailbox = new GlobalMailbox(new IinaGlobalMailboxFileStore(iina.file));
interface DraftContext {
  message: ProviderDraftRequest;
  identity: CredentialOwner;
  reference?: DraftOperationReference;
}
const draftRequests = new RequestLifecycle<DraftContext>();
async function closeNativeDraft(owner: RequestOwner<DraftContext>, action: "finish" | "cancel") {
  const { identity, reference, message } = owner.context;
  await transport
    .draftOperation(action, {
      owner: identity,
      ...(reference ? { reference } : { frame: message.payload.frame }),
    })
    .catch(() => undefined);
}
async function cancelDraftRequests(predicate: (owner: RequestOwner<DraftContext>) => boolean) {
  await Promise.allSettled(
    draftRequests
      .owners()
      .filter(predicate)
      .map((owner) => {
        const cancelled = draftRequests.invalidate(owner);
        return Promise.allSettled([cancelled, closeNativeDraft(owner, "cancel")]);
      }),
  );
}
const credentialChannels = new CredentialChannelRelay({
  onClose: (owner) => {
    profileAuthority?.cancelProfileSave(owner);
    void cancelDraftRequests(
      (draft) =>
        draft.context.identity.senderId === owner.senderId &&
        draft.context.identity.sidebarInstanceId === owner.sidebarInstanceId &&
        draft.context.identity.drawerId === owner.drawerId,
    );
  },
  send: (senderId, name, data) => globalMailbox.postMessage(senderId, name, data),
  call: (action, payload) => transport.credentialChannel(action, payload),
  authorizeSource: async (raw) => {
    const source = parseCredentialSource(raw);
    if (source === null) return;
    await profileReady;
    const current = profiles.get(source.profileId);
    if (
      !current ||
      current.revision !== source.profileRevision ||
      current.endpointFingerprint !== source.endpointFingerprint
    )
      throw new Error("CREDENTIAL_OWNER_MISMATCH");
  },
});
for (const action of ["open", "confirm", "operation", "close"]) {
  const name = `credential-channel:${action}`;
  globalMailbox.onMessage(name, (raw: unknown, senderId?: string) => {
    if (senderId) return credentialChannels.receive(senderId, name, raw);
  });
}
globalMailbox.onSessionClose((playerId, reason) => {
  const permanent = reason !== "expired";
  void cancelDraftRequests((owner) => owner.senderId === playerId);
  void draftRequests.releaseSender(playerId, permanent);
  credentialChannels.close(playerId);
  profilePlayers.delete(playerId);
  translationSessions.delete(playerId);
  void translationRequests.releaseSender(playerId, permanent);
  void broker?.releaseSender(playerId, permanent);
  void modelRequests.releaseSender(playerId, permanent);
  void providerConnectionTests.releaseSender(playerId, permanent);
});

function assertEncryptedDraft(owner: RequestOwner<DraftContext>): void {
  draftRequests.assertActive(owner);
  const { message } = owner.context;
  credentialChannels.ownerFor(owner.senderId, message.payload, message.payload.frame);
  credentialAssert(
    message.payload.frame.context.expiresAtMs > Date.now(),
    "credential-channel-expired",
  );
  const source = message.payload.frame.context.sourceProfile;
  if (source) {
    const current = profiles.get(source.profileId);
    credentialAssert(
      current &&
        current.revision === source.profileRevision &&
        current.endpointFingerprint === source.endpointFingerprint,
      "credential-owner-mismatch",
    );
  }
}

async function runEncryptedDraft(
  raw: unknown,
  senderId: string,
  purpose: "draft-test" | "draft-models",
): Promise<void> {
  let owner: RequestOwner<DraftContext> | null = null;
  let rejectedMessage: ReturnType<typeof parseProviderDraftRequest> | null = null;
  let completed = false;
  const operation = purpose === "draft-test" ? "test" : "models";
  const event = operation === "test" ? "provider:test-result" : "provider:models-result";
  try {
    const message = parseProviderDraftRequest(raw, purpose);
    rejectedMessage = message;
    const identity = credentialChannels.ownerFor(senderId, message.payload, message.payload.frame);
    void cancelDraftRequests(
      (previous) => previous.senderId === senderId && previous.operation === operation,
    );
    owner = draftRequests.begin(
      { senderId, operation, requestId: message.requestId, context: { message, identity } },
      true,
    );
    if (!owner) return;
    assertEncryptedDraft(owner);
    await profileReady;
    assertEncryptedDraft(owner);
    const snapshot = providerDraftSnapshot(message);
    credentialAssert(
      normalizeProviderEndpoint(snapshot.kind, snapshot.endpoint) === snapshot.endpoint &&
        (snapshot.model === null || snapshot.model === snapshot.model.trim()),
    );
    const reference = parseDraftOperationReference(
      await transport.draftOperation("begin", { owner: identity, frame: message.payload.frame }),
    );
    owner.context.reference = reference;
    credentialAssert(
      reference.channelId === message.payload.frame.channelId &&
        reference.requestId === message.requestId &&
        reference.purpose === purpose &&
        reference.snapshotDigest === message.payload.frame.context.snapshotDigest &&
        reference.deadlineMs === message.payload.frame.context.expiresAtMs &&
        identityHash(reference.owner) === identityHash(identity),
    );
    assertEncryptedDraft(owner);
    const current = owner;
    const base = new ProviderTransportAdapter(transport, localUuid);
    const bound: ProviderTransport = {
      request: async (request) => {
        assertEncryptedDraft(current);
        const remaining = reference.deadlineMs - Date.now();
        const response = await base.request({
          ...request,
          credential: reference,
          owner: { senderId, requestId: message.requestId },
          timeoutMs: Math.min(request.timeoutMs, remaining),
          assertActive: () => {
            assertEncryptedDraft(current);
            request.assertActive?.();
          },
        });
        assertEncryptedDraft(current);
        return response;
      },
      cancel: (jobId) => base.cancel(jobId),
    };
    const ownedTransport = draftRequests.transport(owner, bound);
    let models: string[] | undefined;
    if (operation === "test") {
      credentialAssert(snapshot.model);
      const provider = buildDraftProvider(
        {
          kind: snapshot.kind,
          endpoint: snapshot.endpoint,
          model: snapshot.model,
          proxyMode: snapshot.proxyMode,
          credential: reference,
          senderId,
        },
        ownedTransport,
      );
      await provider.testConnection(localUuid());
    } else {
      models = await discoverProviderModels(
        {
          jobId: `models-${localUuid()}`,
          kind: snapshot.kind,
          endpoint: snapshot.endpoint,
          proxyMode: snapshot.proxyMode,
          ...(snapshot.model === null ? {} : { model: snapshot.model }),
          credential: reference,
          owner: { senderId, requestId: message.requestId },
          assertActive: () => assertEncryptedDraft(current),
        },
        ownedTransport,
      );
    }
    assertEncryptedDraft(owner);
    completed = true;
    postToPlayer(senderId, event, {
      requestId: message.requestId,
      ok: true,
      ...(operation === "test"
        ? {
            drawerId: message.payload.drawerId,
            draftRevision: message.payload.frame.context.draftRevision,
          }
        : { contextKey: message.payload.frame.context.snapshotDigest, models }),
    });
  } catch (error) {
    if (!owner) {
      if (rejectedMessage)
        postToPlayer(senderId, event, {
          requestId: rejectedMessage.requestId,
          ok: false,
          ...(operation === "test"
            ? {
                drawerId: rejectedMessage.payload.drawerId,
                draftRevision: rejectedMessage.payload.frame.context.draftRevision,
              }
            : { contextKey: rejectedMessage.payload.frame.context.snapshotDigest }),
          category: "configuration",
          retryable: false,
          code: "TEST_INVALIDATED",
          userAction: "NONE",
        });
      return;
    }
    if (!draftRequests.isActive(owner)) return;
    const safe = normalizeProviderError(error);
    if (safe.category === "cancelled") return;
    const { message } = owner.context;
    postToPlayer(senderId, event, {
      requestId: owner.requestId,
      ok: false,
      ...(operation === "test"
        ? {
            drawerId: message.payload.drawerId,
            draftRevision: message.payload.frame.context.draftRevision,
          }
        : { contextKey: message.payload.frame.context.snapshotDigest }),
      category: safe.category,
      retryable: safe.retryable,
      ...(safe.statusCode === undefined ? {} : { statusCode: safe.statusCode }),
      code: providerTestCode(safe.category, safe.providerCode),
      userAction: safe.userAction,
    });
    const code = (error as { code?: string })?.code;
    if (code === "HELPER_UNAVAILABLE" || code === "CREDENTIAL_OPERATION_REJECTED") {
      credentialChannels.close(senderId);
      postToPlayer(senderId, "credential-channel:revoked", {
        sidebarInstanceId: message.payload.sidebarInstanceId,
        drawerId: message.payload.drawerId,
      });
    }
  } finally {
    if (owner) {
      const action = completed && draftRequests.isActive(owner) ? "finish" : "cancel";
      draftRequests.finish(owner);
      await closeNativeDraft(owner, action);
    }
  }
}
for (const purpose of ["draft-test", "draft-models"] as const) {
  globalMailbox.onMessage(`provider:${purpose}`, (raw, senderId) => {
    if (senderId) return runEncryptedDraft(raw, senderId, purpose);
  });
}
const postToPlayer = (playerId: null | number | string, name: string, data: unknown): void =>
  globalMailbox.postMessage(playerId, name, data);

interface ActiveStylePickerSession {
  requestId: string;
  playerId: string;
  interactionId: string;
  kind: "font" | "color";
  field: "fontFamily" | ColorStyleField;
  lastPreviewColor: RgbaColor | null;
}

let activeStylePicker: ActiveStylePickerSession | null = null;
let stylePickerClient: StylePickerClient | null = null;
let stylePickerStartup: Promise<StylePickerClient> | null = null;
let stylePickerPolling = false;
let stylePickerEventRevision = 0;

function stylePickerLocator() {
  return {
    exists: (path: string) => iina.file.exists(path),
    resolvePath: (path: string) => iina.utils.resolvePath(path),
    list: (path: string) => iina.file.list(path, { includeSubDir: false }),
    read: (path: string) => iina.file.read(path) ?? null,
  };
}

async function ensureStylePickerClient(): Promise<StylePickerClient> {
  if (stylePickerClient) return stylePickerClient;
  if (stylePickerStartup) return stylePickerStartup;
  stylePickerStartup = (async () => {
    const executable = discoverStylePickerExecutable(stylePickerLocator());
    const dataDirectory = iina.utils.resolvePath("@data/.");
    const files = new IinaReadyFileStore(iina.file);
    const session = await StylePickerProcess.bootstrap(
      new IinaStylePickerProcessLauncher(iina.utils),
      files,
      { dataDirectory, fileDirectory: "@data" },
      executable,
    );
    const client = new StylePickerClient(session, new IinaStylePickerHttpBridge(iina.http));
    stylePickerClient = client;
    startStylePickerPolling(client);
    await refreshFontAvailability(client);
    return client;
  })();
  try {
    return await stylePickerStartup;
  } finally {
    stylePickerStartup = null;
  }
}

async function refreshFontAvailability(client: StylePickerClient): Promise<void> {
  const preferredFamily = subtitleStyleAuthority.snapshot().committedStyle.fontFamily;
  const status = await client.fontStatus(preferredFamily);
  const state = subtitleStyleAuthority.updateFontResolution(
    createFontResolution(preferredFamily, status.availability, status.catalogRevision),
  );
  postToPlayer(null, "subtitle-style:state", state);
}

function sendStylePickerResult(
  session: ActiveStylePickerSession,
  outcome: "confirmed" | "cancelled" | "unchanged" | "focused" | "failed",
): void {
  postToPlayer(session.playerId, "subtitle-style:picker-result", {
    requestId: session.requestId,
    outcome,
    authority: subtitleStyleAuthority.snapshot(),
  });
}

function failActiveStylePicker(): void {
  const session = activeStylePicker;
  activeStylePicker = null;
  if (!session) return;
  if (session.kind === "color" && session.lastPreviewColor) {
    const pending = subtitleStyleAuthority.beginCommit(
      session.interactionId,
      session.field as ColorStyleField,
      session.lastPreviewColor,
    );
    if (pending.outcome === "pending") {
      const failed = subtitleStyleAuthority.fail(pending.intent);
      postToPlayer(null, "subtitle-style:state", failed.state);
    }
  }
  sendStylePickerResult(session, "failed");
}

async function acceptFontPickerFamily(
  session: ActiveStylePickerSession,
  fontFamily: string | null,
): Promise<void> {
  const pending = subtitleStyleAuthority.beginCommit(
    session.interactionId,
    "fontFamily",
    fontFamily,
  );
  if (pending.outcome === "superseded") {
    sendStylePickerResult(session, "confirmed");
    return;
  }
  try {
    subtitleStylePreferences.save(pending.candidateStyle);
    const completed = subtitleStyleAuthority.commit(pending.intent);
    postToPlayer(null, "subtitle-style:state", completed.state);
    sendStylePickerResult(session, "confirmed");
  } catch {
    const failed = subtitleStyleAuthority.fail(pending.intent);
    postToPlayer(null, "subtitle-style:state", failed.state);
    sendStylePickerResult(session, "failed");
  }
}

async function acceptColorPickerClose(
  session: ActiveStylePickerSession,
  changed: boolean,
  color: RgbaColor,
): Promise<void> {
  const field = session.field as ColorStyleField;
  if (!changed) {
    if (session.lastPreviewColor) {
      const pending = subtitleStyleAuthority.beginCommit(
        session.interactionId,
        field,
        session.lastPreviewColor,
      );
      if (pending.outcome === "pending") {
        const reverted = subtitleStyleAuthority.fail(pending.intent);
        postToPlayer(null, "subtitle-style:state", reverted.state);
      }
      sendStylePickerResult(session, "cancelled");
    } else {
      sendStylePickerResult(session, "unchanged");
    }
    return;
  }
  if (
    !session.lastPreviewColor ||
    JSON.stringify(session.lastPreviewColor) !== JSON.stringify(color)
  ) {
    const preview = subtitleStyleAuthority.preview(session.interactionId, field, color);
    session.lastPreviewColor = color;
    postToPlayer(null, "subtitle-style:state", preview.state);
  }
  const pending = subtitleStyleAuthority.beginCommit(session.interactionId, field, color);
  if (pending.outcome === "superseded") {
    sendStylePickerResult(session, "confirmed");
    return;
  }
  try {
    subtitleStylePreferences.save(pending.candidateStyle);
    const completed = subtitleStyleAuthority.commit(pending.intent);
    postToPlayer(null, "subtitle-style:state", completed.state);
    sendStylePickerResult(session, "confirmed");
  } catch {
    const failed = subtitleStyleAuthority.fail(pending.intent);
    postToPlayer(null, "subtitle-style:state", failed.state);
    sendStylePickerResult(session, "failed");
  }
}

async function handleStylePickerEvent(
  client: StylePickerClient,
  event: StylePickerEvent,
): Promise<void> {
  if (event.type === "font-catalog-changed") {
    await refreshFontAvailability(client);
    return;
  }
  const session = activeStylePicker;
  if (!session || event.requestId !== session.requestId) return;
  if (event.type === "color-preview" && session.kind === "color") {
    const preview = subtitleStyleAuthority.preview(
      session.interactionId,
      session.field as ColorStyleField,
      event.color,
    );
    session.lastPreviewColor = event.color;
    postToPlayer(null, "subtitle-style:state", preview.state);
  } else if (event.type === "color-closed" && session.kind === "color") {
    activeStylePicker = null;
    await acceptColorPickerClose(session, event.changed, event.color);
  } else if (event.type === "font-confirmed" && session.kind === "font") {
    activeStylePicker = null;
    await acceptFontPickerFamily(session, event.fontFamily);
  } else if (event.type === "font-cancelled" && session.kind === "font") {
    activeStylePicker = null;
    sendStylePickerResult(session, "cancelled");
  } else if (event.type === "picker-failed") {
    failActiveStylePicker();
  }
}

function startStylePickerPolling(client: StylePickerClient): void {
  if (stylePickerPolling) return;
  stylePickerPolling = true;
  const poll = async (): Promise<void> => {
    if (stylePickerClient !== client) {
      stylePickerPolling = false;
      return;
    }
    try {
      const batch = await client.events(stylePickerEventRevision);
      if (batch.gap) {
        stylePickerEventRevision = batch.latestRevision;
        failActiveStylePicker();
        await refreshFontAvailability(client);
      } else {
        for (const event of batch.events) {
          stylePickerEventRevision = event.revision;
          await handleStylePickerEvent(client, event);
        }
      }
      hostTimers.setTimeout(() => void poll(), 100);
    } catch {
      stylePickerClient = null;
      stylePickerPolling = false;
      failActiveStylePicker();
      const preferredFamily = subtitleStyleAuthority.snapshot().committedStyle.fontFamily;
      const state = subtitleStyleAuthority.updateFontResolution(
        createFontResolution(preferredFamily, "unknown", 0),
      );
      postToPlayer(null, "subtitle-style:state", state);
    }
  };
  void poll();
}

async function profileViews(): Promise<unknown[]> {
  await profileReady;
  return profileAuthority.snapshot.profiles.map((authorityProfile) => {
    const profile = profiles.get(authorityProfile.profileId, authorityProfile.revision);
    if (!profile) return authorityProfile;
    const contextKey = profileModelContextKey(profile);
    const models = modelCatalogs.get(contextKey);
    return {
      ...authorityProfile,
      ...(models ? { modelCatalog: { contextKey, models } } : {}),
    };
  });
}

async function reconcileProfileAuthority(): Promise<void> {
  const before = profileAuthority.snapshot.profiles.map((profile) => profile.profileId);
  if (!(await profileAuthority.reconcile())) return;
  const affected = new Set([
    ...before,
    ...profileAuthority.snapshot.profiles.map((profile) => profile.profileId),
  ]);
  for (const profileId of affected) {
    advanceCredentialEpoch(profileId);
    credentialChannels.closeProfile(profileId);
    clearProfileProviderCache(profileId);
    clearProfileModelCatalogs(profileId);
  }
  publishProfileAuthority();
  await Promise.all([
    broker.cancelAll(),
    ...[...affected].flatMap((profileId) => [
      invalidateProfileConnectionTests(profileId),
      cancelProfileModelRequests(profileId),
    ]),
  ]);
}

function publishProfileAuthority(playerId: string | null = null): void {
  const snapshot = profileAuthority.snapshot;
  if (playerId !== null) {
    postToPlayer(playerId, "profile-activation:state", snapshot);
    return;
  }
  for (const target of profilePlayers) postToPlayer(target, "profile-activation:state", snapshot);
}

globalMailbox.onMessage("defaults:save", (raw: unknown, playerId?: string) => {
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

globalMailbox.onMessage("overlay-position:get", (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  try {
    parseOverlayPositionGet(raw);
    postToPlayer(playerId, "overlay-position:state", overlayPositionAuthority.snapshot());
  } catch {
    return;
  }
});

globalMailbox.onMessage("overlay-position:preview", (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  try {
    const message = parseOverlayPositionPreview(raw);
    const state = overlayPositionAuthority.preview(message.payload.position);
    postToPlayer(null, "overlay-position:state", state);
  } catch {
    return;
  }
});

globalMailbox.onMessage("overlay-position:save", (raw: unknown, playerId?: string) => {
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

globalMailbox.onMessage("subtitle-style:get", (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  try {
    parseSubtitleStyleGet(raw);
    postToPlayer(playerId, "subtitle-style:state", subtitleStyleAuthority.snapshot());
  } catch {
    return;
  }
});

globalMailbox.onMessage("subtitle-style:edit", (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  try {
    const message = parseSubtitleStyleEdit(raw);
    const edit = message.payload;
    if (edit.phase === "preview") {
      const preview = subtitleStyleAuthority.preview(edit.interactionId, edit.field, edit.value);
      postToPlayer(null, "subtitle-style:state", preview.state);
      return;
    }
    const pending = subtitleStyleAuthority.beginCommit(edit.interactionId, edit.field, edit.value);
    if (pending.outcome === "superseded") {
      postToPlayer(playerId, "subtitle-style:save-result", {
        requestId: message.requestId,
        field: edit.field,
        ok: true,
        outcome: "superseded",
        intentSequence: pending.intent.intentSequence,
        authority: pending.state,
      });
      return;
    }
    try {
      subtitleStylePreferences.save(pending.candidateStyle);
      const completed = subtitleStyleAuthority.commit(pending.intent);
      postToPlayer(null, "subtitle-style:state", completed.state);
      postToPlayer(playerId, "subtitle-style:save-result", {
        requestId: message.requestId,
        field: edit.field,
        ok: true,
        outcome: completed.outcome,
        intentSequence: pending.intent.intentSequence,
        authority: completed.state,
      });
    } catch {
      const failed = subtitleStyleAuthority.fail(pending.intent);
      postToPlayer(null, "subtitle-style:state", failed.state);
      postToPlayer(playerId, "subtitle-style:save-result", {
        requestId: message.requestId,
        field: edit.field,
        ok: false,
        code: "SUBTITLE_STYLE_SAVE_FAILED",
        userAction: "EDIT_AGAIN",
        intentSequence: pending.intent.intentSequence,
        authority: failed.state,
      });
    }
  } catch {
    return;
  }
});

globalMailbox.onMessage("subtitle-style:picker-open", async (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  let request: ActiveStylePickerSession | null = null;
  try {
    const message = parseSubtitleStylePickerOpen(raw);
    request = {
      requestId: message.requestId,
      playerId,
      interactionId: `picker:${message.requestId}`,
      kind: message.payload.kind,
      field: message.payload.field,
      lastPreviewColor: null,
    };
    if (activeStylePicker) {
      const activeRequestId = activeStylePicker.requestId;
      if (stylePickerClient) await stylePickerClient.activate(activeRequestId);
      sendStylePickerResult(request, "focused");
      return;
    }
    activeStylePicker = request;
    const client = await ensureStylePickerClient();
    if (activeStylePicker !== request) return;
    const style = subtitleStyleAuthority.snapshot().liveStyle;
    const status =
      request.kind === "font"
        ? await client.openFont({
            requestId: request.requestId,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            bold: style.bold,
            italic: style.italic,
          })
        : await client.openColor({
            requestId: request.requestId,
            color: style[request.field as ColorStyleField],
          });
    if (status === "focused") {
      activeStylePicker = null;
      sendStylePickerResult(request, "focused");
    }
  } catch {
    if (activeStylePicker === request) activeStylePicker = null;
    if (request) sendStylePickerResult(request, "failed");
  }
});

globalMailbox.onMessage("subtitle-style:picker-focus", async (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  try {
    parseSubtitleStyleGet(raw);
    const session = activeStylePicker;
    const client = stylePickerClient;
    if (session && client) await client.activate(session.requestId);
  } catch {
    return;
  }
});

globalMailbox.onMessage("subtitle-style:picker-cancel", async (raw: unknown, playerId?: string) => {
  if (!playerId || !activeStylePicker || activeStylePicker.playerId !== playerId) return;
  try {
    const message = parseSubtitleStyleGet(raw);
    void message;
    const session = activeStylePicker;
    const client = stylePickerClient;
    if (!client) {
      activeStylePicker = null;
      sendStylePickerResult(session, "cancelled");
      return;
    }
    await client.cancel(session.requestId);
  } catch {
    failActiveStylePicker();
  }
});

globalMailbox.onMessage("profiles:list", async (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  await profileReady;
  await reconcileProfileAuthority();
  const authority = profileAuthority.snapshot;
  postToPlayer(playerId, "profiles:result", {
    requestId: requestId(raw),
    authorityId: authority.authorityId,
    stateVersion: authority.stateVersion,
    profiles: await profileViews(),
    storageStatus: profileStorageStatus,
  });
});

globalMailbox.onMessage("profile-activation:get", async (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  try {
    const message = parseProfileActivationGet(raw);
    profilePlayers.add(playerId);
    await profileReady;
    await reconcileProfileAuthority();
    postToPlayer(playerId, "profile-activation:state", {
      requestId: message.requestId,
      authority: profileAuthority.snapshot,
    });
  } catch {
    return;
  }
});

globalMailbox.onMessage("profile-activation:set", async (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  let message: ReturnType<typeof parseProfileActivationSet>;
  try {
    message = parseProfileActivationSet(raw);
  } catch {
    return;
  }
  try {
    await profileReady;
    const result = await profileAuthority.set({
      senderId: playerId,
      requestId: message.requestId,
      ...message.payload,
    });
    const cancellation = result.outcome === "changed" ? broker.cancelAll() : null;
    postToPlayer(playerId, "profile-activation:result", result);
    if (result.outcome === "changed") publishProfileAuthority();
    else if (result.outcome === "unchanged") publishProfileAuthority(playerId);
    await cancellation;
    if (result.outcome === "pending") await reconcileProfileAuthority();
  } catch {
    await profileReady;
    postToPlayer(playerId, "profile-activation:result", {
      requestId: message.requestId,
      outcome: "failed",
      authority: profileAuthority.snapshot,
      error: { code: "PROFILE_ACTIVATION_FAILED", userAction: "RETRY" },
    });
  }
});

async function runModelRequest(message: ProviderModelsRequest, playerId: string): Promise<void> {
  const values = message.payload;
  const profileId = values.profileId;
  void cancelDraftRequests(
    (previous) => previous.senderId === playerId && previous.operation === "models",
  );
  const owner = modelRequests.begin(
    {
      operation: "models",
      senderId: playerId,
      requestId: message.requestId,
      context: {
        jobId: `models-${localUuid()}`,
        contextKey: "invalid",
        kind: values.kind,
        endpoint: values.endpoint,
        proxyMode: values.proxyMode,
        ...(profileId && "profileRevision" in values
          ? {
              profileId,
              profileRevision: values.profileRevision!,
              endpointFingerprint: values.endpointFingerprint!,
            }
          : {}),
        credentialEpoch: profileId ? (modelCredentialEpochs.get(profileId) ?? 0) : 0,
      },
    },
    true,
  );
  if (!owner) return;
  const context = owner.context;
  try {
    await profileReady;
    assertSavedModelOwner(owner);
    const endpoint = normalizeProviderEndpoint(values.kind, values.endpoint);
    const profile = profileId ? profiles.get(profileId) : null;
    const matchingService = Boolean(
      profile &&
      sameProviderService({ ...profile, proxyMode: profile.proxyMode ?? "system" }, values),
    );
    const savedCredentialEligible = Boolean(profile && profile.kind === values.kind);
    context.contextKey = modelContextKey({
      kind: context.kind,
      endpoint,
      proxyMode: context.proxyMode,
      ...(profile && matchingService
        ? {
            profileId: profile.profileId,
            profileRevision: profile.revision,
            endpointFingerprint: profile.endpointFingerprint,
          }
        : {}),
      credentialEpoch: context.credentialEpoch,
    });
    if (profileId && !matchingService) throw new Error("CREDENTIAL_CHANNEL_REQUIRED");
    const credential =
      savedCredentialEligible && profile
        ? savedCredentialReference(profile)
        : { source: "none" as const };
    const models = await discoverProviderModels(
      {
        jobId: context.jobId,
        kind: values.kind,
        endpoint: credential.source === "saved" ? profile!.endpoint : endpoint,
        proxyMode: values.proxyMode,
        credential,
        ...(profile?.model ? { model: profile.model } : {}),
        owner: { senderId: playerId, requestId: message.requestId },
        assertActive: () => assertSavedModelOwner(owner),
      },
      modelRequests.transport(owner, modelTransport, () => {
        assertSavedModelOwner(owner);
        return true;
      }),
    );
    assertSavedModelOwner(owner);
    {
      if (matchingService && profile)
        recordProfileModelCatalog(profile.profileId, context.contextKey, models);
      else modelCatalogs.set(context.contextKey, models);
    }
    postToPlayer(playerId, "provider:models-result", {
      requestId: message.requestId,
      ok: true,
      contextKey: context.contextKey,
      models,
    });
  } catch (error) {
    if (!modelRequests.isActive(owner)) return;
    const safe = normalizeProviderError(error);
    if (safe.category === "cancelled") return;
    postToPlayer(playerId, "provider:models-result", {
      requestId: message.requestId,
      ok: false,
      contextKey: context.contextKey,
      category: safe.category,
      retryable: safe.retryable,
      ...(safe.statusCode === undefined ? {} : { statusCode: safe.statusCode }),
      ...(safe.providerCode ? { code: safe.providerCode } : {}),
      ...(safe.retryAfterMs === undefined ? {} : { retryAfterMs: safe.retryAfterMs }),
      userAction: safe.userAction,
    });
  } finally {
    modelRequests.finish(owner);
  }
}

globalMailbox.onMessage("provider:models", (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  try {
    return runModelRequest(parseProviderModelsRequest(raw), playerId);
  } catch {
    postToPlayer(playerId, "operation:error", {
      requestId: requestId(raw),
      code: "INVALID_MESSAGE",
      userAction: "NONE",
    });
  }
});

globalMailbox.onMessage("provider:models-cancel", async (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  try {
    const message = parseProviderModelsCancelRequest(raw);
    await cancelDraftRequests(
      (owner) =>
        owner.senderId === playerId &&
        owner.operation === "models" &&
        (!("modelRequestId" in message.payload) ||
          owner.requestId === message.payload.modelRequestId),
    );
    if ("modelRequestId" in message.payload)
      await modelRequests.cancel(playerId, "models", message.payload.modelRequestId);
    else await modelRequests.releaseSender(playerId);
  } catch {
    return;
  }
});

for (const stage of ["prepare", "commit"] as const) {
  globalMailbox.onMessage(`profile:save-${stage}`, async (raw: unknown, playerId?: string) => {
    if (!playerId) return;
    let identity: { sidebarInstanceId: string; drawerId: string } | undefined;
    try {
      const message = parseProfileSaveRequest(raw, stage);
      identity = {
        sidebarInstanceId: message.payload.sidebarInstanceId,
        drawerId: message.payload.drawerId,
      };
      await profileReady;
      const owner = credentialChannels.ownerFor(
        playerId,
        identity,
        "frame" in message.payload ? message.payload.frame : undefined,
      );
      if ("input" in message.payload) {
        const reservation = await profileAuthority.reserveProfileSave(
          message.payload.input!,
          owner,
          message.requestId,
        );
        credentialChannels.ownerFor(playerId, identity);
        postToPlayer(playerId, "profile:save-result", {
          requestId: message.requestId,
          ok: true,
          ...identity,
          payload: reservation,
        });
        return;
      }
      const wasActive = profileAuthority.snapshot.activation?.profileId;
      const mutation = await profileAuthority.completeProfileSave(
        message.payload.reservationId!,
        owner,
        message.payload.frame!,
        (target, frame) => profileStateStore.save(target, frame),
      );
      if (mutation.outcome === "pending") await reconcileProfileAuthority();
      publishProfileAuthority();
      if (mutation.outcome !== "changed" || !mutation.profile)
        throw new Error("PROFILE_SAVE_FAILED");
      const profile = mutation.profile;
      advanceCredentialEpoch(profile.profileId);
      credentialChannels.closeProfile(profile.profileId);
      credentialChannels.close(playerId);
      await Promise.all([
        broker.cancelProfile(profile.profileId),
        invalidateProfileConnectionTests(profile.profileId),
        cancelProfileModelRequests(profile.profileId),
      ]);
      clearProfileProviderCache(profile.profileId);
      clearProfileModelCatalogs(profile.profileId);
      const view = mutation.authority.profiles.find(
        (candidate) => candidate.profileId === profile.profileId,
      );
      postToPlayer(playerId, "profile:save-result", {
        requestId: message.requestId,
        ok: true,
        ...identity,
        payload: {
          profile: view ?? sanitizedProfileView(profile),
          selectionInvalidated: wasActive === profile.profileId,
        },
      });
    } catch {
      if (identity) profileAuthority?.cancelProfileSave({ senderId: playerId, ...identity });
      postToPlayer(playerId, "profile:save-result", {
        requestId: requestId(raw),
        ok: false,
        ...identity,
      });
    }
  });
}

globalMailbox.onMessage("profile:delete", async (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  await profileReady;
  try {
    const message = parseProfileDeleteRequest(raw);
    const { profileId, expectedRevision } = message.payload;
    const wasActive = profileAuthority.snapshot.activation?.profileId === profileId;
    const mutation = await profileAuthority.deleteProfile(profileId, expectedRevision);
    if (mutation.outcome === "pending") await reconcileProfileAuthority();
    if (mutation.outcome !== "changed") throw new Error("PROFILE_DELETE_FAILED");
    advanceCredentialEpoch(profileId);
    credentialChannels.closeProfile(profileId);
    await Promise.all([
      broker.cancelProfile(profileId),
      invalidateProfileConnectionTests(profileId),
      cancelProfileModelRequests(profileId),
    ]);
    clearProfileProviderCache(profileId);
    clearProfileModelCatalogs(profileId);
    publishProfileAuthority();
    postToPlayer(playerId, "profile:deleted", {
      requestId: message.requestId,
      profileId,
      selectionInvalidated: wasActive,
    });
  } catch {
    postToPlayer(playerId, "operation:error", {
      requestId: requestId(raw),
      code: "PROFILE_DELETE_FAILED",
      userAction: "NONE",
    });
  }
});

globalMailbox.onMessage("provider:test", async (raw: unknown, senderId?: string) => {
  if (!senderId) return;
  let owner: ProviderConnectionTestTask | null = null;
  try {
    const message = parseProviderTestRequest(raw);
    void cancelDraftRequests(
      (previous) => previous.senderId === senderId && previous.operation === "test",
    );
    const source = message.payload.sourceProfile;
    const started = providerConnectionTests.begin({
      senderId,
      requestId: message.requestId,
      drawerId: message.payload.drawerId,
      draftRevision: message.payload.draftRevision,
      ...(source ? { sourceProfile: source } : {}),
      credentialEpoch: source ? (modelCredentialEpochs.get(source.profileId) ?? 0) : 0,
    });
    if (!started) return;
    owner = started.owner;
    assertActiveDraftTestOwner(owner);
    await profileReady;
    assertDraftTestOwner(owner);

    normalizeProviderEndpoint(message.payload.kind, message.payload.endpoint);
    if (!source) throw new Error("CREDENTIAL_CHANNEL_REQUIRED");
    const current = profiles.get(source.profileId);
    if (
      !current ||
      current.revision !== source.profileRevision ||
      current.endpointFingerprint !== source.endpointFingerprint ||
      current.kind !== message.payload.kind ||
      (message.payload.credential.source === "none" &&
        profileAuthority.snapshot.profiles.find(
          (profile) => profile.profileId === current.profileId,
        )?.credentialConfigured !== false) ||
      current.model !== message.payload.model.trim() ||
      !sameProviderService(
        { ...current, proxyMode: current.proxyMode ?? "system" },
        message.payload,
      )
    )
      throw new Error("CREDENTIAL_CONTEXT_CHANGED");
    const credential = savedCredentialReference(current);

    const provider = buildDraftProvider(
      {
        kind: message.payload.kind,
        endpoint: current.endpoint,
        model: message.payload.model.trim(),
        proxyMode: message.payload.proxyMode,
        credential,
        senderId,
      },
      draftTestTransport(owner),
    );
    if (!providerConnectionTests.attachProvider(owner, provider)) return;
    assertDraftTestOwner(owner);
    await provider.testConnection(owner.testId);
    assertDraftTestOwner(owner);
    const completed = providerConnectionTests.complete(owner);
    if (!completed) return;
    postToPlayer(completed.senderId, "provider:test-result", {
      requestId: completed.requestId,
      drawerId: completed.drawerId,
      draftRevision: completed.draftRevision,
      ok: true,
    });
  } catch (error) {
    if (!owner) return;
    const completed = providerConnectionTests.complete(owner);
    if (!completed) return;
    const safe = normalizeProviderError(error);
    postToPlayer(completed.senderId, "provider:test-result", {
      requestId: completed.requestId,
      drawerId: completed.drawerId,
      draftRevision: completed.draftRevision,
      ok: false,
      category: safe.category,
      retryable: safe.retryable,
      ...(safe.statusCode === undefined ? {} : { statusCode: safe.statusCode }),
      code: providerTestCode(safe.category, safe.providerCode),
      ...(safe.retryAfterMs === undefined ? {} : { retryAfterMs: safe.retryAfterMs }),
      userAction: safe.userAction,
    });
  }
});

globalMailbox.onMessage("provider:test-cancel", async (raw: unknown, senderId?: string) => {
  if (!senderId) return;
  try {
    const message = parseProviderTestCancelRequest(raw);
    await cancelDraftRequests(
      (owner) =>
        owner.senderId === senderId &&
        owner.operation === "test" &&
        (!("testRequestId" in message.payload) ||
          owner.requestId === message.payload.testRequestId),
    );
    if ("testRequestId" in message.payload)
      await providerConnectionTests.cancel(senderId, message.payload.testRequestId);
    else await providerConnectionTests.releaseSender(senderId);
  } catch {
    return;
  }
});

globalMailbox.onMessage("provider:attempt", async (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  const id = requestId(raw);
  let owner: RequestOwner<TranslationContext> | null = null;
  try {
    const parsed = parseProviderAttempt(raw);
    const request = parsed.payload;
    const previous = translationSessions.get(playerId);
    if (
      previous &&
      (request.sessionId !== previous.sessionId ||
        request.sessionEpoch < previous.sessionEpoch ||
        (request.sessionEpoch === previous.sessionEpoch &&
          request.windowEpoch < previous.windowEpoch))
    )
      return;
    const sameSession =
      previous &&
      request.sessionEpoch === previous.sessionEpoch &&
      request.windowEpoch === previous.windowEpoch;
    const context = sameSession
      ? previous
      : {
          sessionId: request.sessionId,
          sessionEpoch: request.sessionEpoch,
          windowEpoch: request.windowEpoch,
        };
    owner = translationRequests.begin({
      senderId: playerId,
      operation: "translation",
      requestId: parsed.requestId,
      context,
    });
    if (!owner) return;
    translationSessions.set(playerId, context);
    if (!sameSession)
      void translationRequests.cancelWhere(
        (candidate) => candidate.senderId === playerId && candidate.context !== context,
      );
    const current = owner;
    const guard = () =>
      translationRequests.assertActive(
        current,
        () => translationSessions.get(playerId) === context,
      );
    await profileReady;
    guard();
    translationRequests.track(owner, id, () => broker.cancel(playerId, id));
    const result = await broker.attempt(
      playerId,
      request,
      (progress) => {
        guard();
        postToPlayer(playerId, "provider:attempt-progress", {
          requestId: id,
          progress: parseTranslationBatchProgress(progress),
        });
      },
      guard,
    );
    guard();
    postToPlayer(playerId, "provider:attempt-result", { requestId: id, result });
  } catch (error) {
    if (owner && !translationRequests.isActive(owner)) return;
    const safe = normalizeProviderError(error);
    postToPlayer(playerId, "provider:attempt-error", { requestId: id, error: safe });
  } finally {
    if (owner) translationRequests.finish(owner);
  }
});

globalMailbox.onMessage("provider:cancel", async (raw: unknown, playerId?: string) => {
  if (!playerId) return;
  const values = payload(raw);
  const id = String(values.requestId ?? requestId(raw));
  await Promise.allSettled([
    translationRequests.cancel(playerId, "translation", id),
    broker?.cancel(playerId, id),
  ]);
  postToPlayer(playerId, "provider:cancelled", { requestId: requestId(raw) });
});

async function prefetchProfileModels(profile: ProviderProfileSnapshot): Promise<void> {
  const jobId = `models-startup-${localUuid()}`;
  const contextKey = profileModelContextKey(profile);
  const owner = modelRequests.begin(
    {
      operation: "models",
      senderId: `startup:${profile.profileId}`,
      requestId: jobId,
      context: {
        jobId,
        contextKey,
        kind: profile.kind,
        endpoint: profile.endpoint,
        proxyMode: profile.proxyMode ?? "system",
        profileId: profile.profileId,
        profileRevision: profile.revision,
        endpointFingerprint: profile.endpointFingerprint,
        credentialEpoch: modelCredentialEpochs.get(profile.profileId) ?? 0,
      },
    },
    true,
  );
  if (!owner) return;
  try {
    assertSavedModelOwner(owner);
    const credential = savedCredentialReference(profile);
    assertSavedModelOwner(owner);
    const models = await discoverProviderModels(
      {
        jobId,
        kind: profile.kind,
        endpoint: profile.endpoint,
        proxyMode: profile.proxyMode ?? "system",
        credential,
        ...(profile.model ? { model: profile.model } : {}),
        owner: { senderId: owner.senderId, requestId: owner.requestId },
        assertActive: () => assertSavedModelOwner(owner),
      },
      modelRequests.transport(owner, modelTransport, () => {
        assertSavedModelOwner(owner);
        return true;
      }),
    );
    assertSavedModelOwner(owner);
    recordProfileModelCatalog(profile.profileId, contextKey, models);
  } finally {
    modelRequests.finish(owner);
  }
}

hostTimers.setTimeout(async () => {
  await profileReady;
  for (const profile of profiles.listLatest())
    void prefetchProfileModels(profile).catch(() => undefined);
}, 0);
