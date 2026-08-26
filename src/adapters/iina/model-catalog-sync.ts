import type {
  ProviderModelsPreviewRequestPayload,
  ProviderModelsRequestPayload,
  ProviderModelsResult,
} from "../../domain/messages.js";

type SidebarModelTrigger = "open" | "endpoint" | "profile" | "credential" | "manual";

interface BeginInput {
  requestId: string;
  contextToken: string;
  trigger: SidebarModelTrigger;
  cacheResult?: boolean;
}

interface WindowCatalogState {
  contextToken: string;
  owner: BeginInput | null;
  catalog: { contextKey: string; models: string[] } | null;
  catalogs: Map<string, { contextKey: string; models: string[] }>;
  lastResult: ProviderModelsResult | null;
}

export function modelCatalogContextToken(input: ProviderModelsRequestPayload): string {
  return JSON.stringify({
    kind: input.kind,
    endpoint: input.endpoint,
    proxyMode: input.proxyMode,
    ...(input.profileId === undefined
      ? {}
      : {
          profileId: input.profileId,
          profileRevision: input.profileRevision,
          endpointFingerprint: input.endpointFingerprint,
        }),
  });
}

export function modelCatalogPreviewContextToken(
  input: ProviderModelsPreviewRequestPayload,
): string {
  return JSON.stringify({
    kind: input.kind,
    endpoint: input.endpoint,
    proxyMode: input.proxyMode,
    draftCredentialEpoch: input.draftCredentialEpoch,
  });
}

export class ModelCatalogSync {
  private readonly windows = new Map<string, WindowCatalogState>();

  begin(
    windowId: string,
    input: BeginInput,
  ): { forwarded: boolean; ownerRequestId: string; supersededRequestId?: string } {
    const state = this.state(windowId);
    if (
      input.trigger !== "manual" &&
      input.trigger !== "credential" &&
      state.owner &&
      state.owner.trigger !== "manual" &&
      state.owner.contextToken === input.contextToken
    )
      return { forwarded: false, ownerRequestId: state.owner.requestId };
    const supersededRequestId = state.owner?.requestId;
    if (state.contextToken !== input.contextToken) {
      state.contextToken = input.contextToken;
      state.catalog = state.catalogs.get(input.contextToken) ?? null;
    }
    state.owner = input;
    state.lastResult = null;
    return {
      forwarded: true,
      ownerRequestId: input.requestId,
      ...(supersededRequestId ? { supersededRequestId } : {}),
    };
  }

  commit(windowId: string, result: ProviderModelsResult): boolean {
    const state = this.state(windowId);
    if (!state.owner || state.owner.requestId !== result.requestId) return false;
    if (result.ok) {
      state.catalog = { contextKey: result.contextKey, models: [...result.models] };
      if (state.owner.cacheResult !== false) state.catalogs.set(state.contextToken, state.catalog);
    }
    state.owner = null;
    state.lastResult = result;
    return true;
  }

  invalidate(windowId: string, contextToken = ""): void {
    const state = this.state(windowId);
    state.owner = null;
    state.lastResult = null;
    if (state.contextToken === contextToken) return;
    state.contextToken = contextToken;
    state.catalog = state.catalogs.get(contextToken) ?? null;
  }

  remove(windowId: string): void {
    this.windows.delete(windowId);
  }

  snapshot(windowId: string): {
    contextToken: string;
    ownerRequestId: string | null;
    catalog: { contextKey: string; models: string[] } | null;
    lastResult: ProviderModelsResult | null;
  } {
    const state = this.state(windowId);
    return {
      contextToken: state.contextToken,
      ownerRequestId: state.owner?.requestId ?? null,
      catalog: state.catalog
        ? { contextKey: state.catalog.contextKey, models: [...state.catalog.models] }
        : null,
      lastResult: state.lastResult,
    };
  }

  private state(windowId: string): WindowCatalogState {
    const existing = this.windows.get(windowId);
    if (existing) return existing;
    const created: WindowCatalogState = {
      contextToken: "",
      owner: null,
      catalog: null,
      catalogs: new Map(),
      lastResult: null,
    };
    this.windows.set(windowId, created);
    return created;
  }
}
