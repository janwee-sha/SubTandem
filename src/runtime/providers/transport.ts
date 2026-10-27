import type {
  CredentialReference,
  CredentialProviderKind,
} from "../../shared/credential-protocol.js";
import type { RequestOwner } from "./request-lifecycle.js";

export interface ProviderRequestAuthority {
  credential: CredentialReference;
  owner: { senderId: string; requestId: string };
  purpose: "models" | "test" | "translation";
  provider: {
    kind: CredentialProviderKind;
    endpoint: string;
    model: string | null;
    proxyMode: "system" | "direct";
  };
}

export function providerRequestAuthority(
  config: {
    credential?: CredentialReference;
    endpoint: string;
    model?: string;
    proxyMode?: "system" | "direct";
  },
  kind: CredentialProviderKind,
  owner: Pick<RequestOwner, "senderId" | "requestId" | "operation">,
): ProviderRequestAuthority {
  return {
    credential: config.credential ?? { source: "none" },
    owner: { senderId: owner.senderId, requestId: owner.requestId },
    purpose: owner.operation,
    provider: {
      kind,
      endpoint: config.endpoint,
      model: config.model ?? null,
      proxyMode: config.proxyMode ?? "system",
    },
  };
}

export interface ProviderTransportRequest extends ProviderRequestAuthority {
  jobId: string;
  assertActive?: () => void;
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  proxyMode?: "system" | "direct";
  body?: unknown;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface ProviderTransportResponse {
  statusCode: number;
  headers: Record<string, string>;
  bodyText: string;
}

export interface ProviderTransport {
  request(request: ProviderTransportRequest): Promise<ProviderTransportResponse>;
  cancel?(jobId: string): Promise<void> | void;
}
