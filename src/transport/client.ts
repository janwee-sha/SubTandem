import { SubTandemError } from "../domain/errors.js";

export interface LocalHttpBridge {
  post<T>(url: string, bearerToken: string, body: unknown): Promise<T>;
}

export const TRANSPORT_RPC_ERROR_CODES = [
  "upstream-timeout",
  "upstream-network",
  "forbidden-destination",
  "duplicate-job",
  "invalid-request",
  "response-too-large",
  "request-cancelled",
  "request-failed",
  "unauthorized",
  "request-too-large",
  "not-found",
  "invalid-credential-request",
  "credential-store-unavailable",
  "invalid-cancel-request",
  "helper-rpc-failed",
] as const;

export type TransportRpcErrorCode = (typeof TRANSPORT_RPC_ERROR_CODES)[number];

export function isTransportRpcErrorCode(value: unknown): value is TransportRpcErrorCode {
  return (
    typeof value === "string" && TRANSPORT_RPC_ERROR_CODES.includes(value as TransportRpcErrorCode)
  );
}

export class TransportRpcError extends Error {
  constructor(readonly code: TransportRpcErrorCode) {
    super(code);
    this.name = "TransportRpcError";
  }
}

function rpcError(error: TransportRpcError): SubTandemError {
  switch (error.code) {
    case "upstream-timeout":
      return new SubTandemError("PROVIDER_TIMEOUT", "timeout", "CHECK_NETWORK", true, 504);
    case "upstream-network":
      return new SubTandemError("PROVIDER_NETWORK", "network", "CHECK_NETWORK", true, 502);
    case "forbidden-destination":
      return new SubTandemError("FORBIDDEN_DESTINATION", "configuration", "CHECK_ENDPOINT");
    case "request-cancelled":
      return new SubTandemError("REQUEST_CANCELLED", "cancelled", "NONE");
    case "response-too-large":
      return new SubTandemError("HELPER_RESPONSE_TOO_LARGE", "protocol", "CHECK_ENDPOINT");
    case "credential-store-unavailable":
      return new SubTandemError("CREDENTIAL_STORE_UNAVAILABLE", "configuration", "RESTART_IINA");
    case "helper-rpc-failed":
      // IINA rejects its HTTP Promise without a response body when the
      // loopback helper has exited after its idle timeout. Treat that as an
      // expired session so TransportSupervisor can replace it. A malformed
      // response from a live helper is classified separately by the client.
      return new SubTandemError("HELPER_UNAVAILABLE", "network", "RESTART_IINA", true);
    case "unauthorized":
      return new SubTandemError("HELPER_UNAVAILABLE", "network", "RESTART_IINA", true);
    default:
      return new SubTandemError("HELPER_PROTOCOL", "protocol", "RESTART_IINA");
  }
}

export interface TransportRequest {
  jobId: string;
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  proxyMode?: "system" | "direct";
  body?: unknown;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface TransportResponse {
  jobId: string;
  transportState: "completed" | "cancelled" | "timedOut";
  statusCode: number;
  headers: Record<string, string>;
  bodyText: string;
}

export interface TransportSession {
  port: number;
  token: string;
}

export interface TransportRpcClient {
  health(): Promise<void>;
  credentialRead(profileId: string): Promise<Record<string, string> | null>;
  credentialWrite(profileId: string, fields: Record<string, string>): Promise<void>;
  credentialDelete(profileId: string): Promise<void>;
  request(request: TransportRequest): Promise<TransportResponse>;
  cancel(jobId: string): Promise<"cancelled" | "already-completed" | "unknown">;
  shutdown(): Promise<void>;
}

export class TransportClient implements TransportRpcClient {
  constructor(
    private readonly session: TransportSession,
    private readonly bridge: LocalHttpBridge,
  ) {
    if (!Number.isInteger(session.port) || session.port < 1024 || session.port > 65535) {
      throw new Error("Invalid helper port");
    }
    if (!/^[A-Za-z0-9_-]{8,512}$/.test(session.token)) throw new Error("Invalid helper token");
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    try {
      return await this.bridge.post<T>(
        `http://127.0.0.1:${this.session.port}${path}`,
        this.session.token,
        body,
      );
    } catch (error) {
      if (error instanceof SubTandemError) throw error;
      if (error instanceof TransportRpcError) throw rpcError(error);
      throw new SubTandemError("HELPER_UNAVAILABLE", "network", "RESTART_IINA", true);
    }
  }

  async health(): Promise<void> {
    const response = await this.post<{ state: "ok" }>("/v1/health", {});
    if (response.state !== "ok")
      throw new SubTandemError("HELPER_PROTOCOL", "protocol", "RESTART_IINA");
  }

  async credentialRead(profileId: string): Promise<Record<string, string> | null> {
    const response = await this.post<{ fields: Record<string, string> | null }>("/v1/credentials", {
      action: "read",
      profileId,
    });
    return response.fields ? { ...response.fields } : null;
  }

  async credentialWrite(profileId: string, fields: Record<string, string>): Promise<void> {
    const response = await this.post<{ state: "saved" }>("/v1/credentials", {
      action: "write",
      profileId,
      fields,
    });
    if (response.state !== "saved")
      throw new SubTandemError("HELPER_PROTOCOL", "protocol", "RESTART_IINA");
  }

  async credentialDelete(profileId: string): Promise<void> {
    const response = await this.post<{ state: "deleted" }>("/v1/credentials", {
      action: "delete",
      profileId,
    });
    if (response.state !== "deleted")
      throw new SubTandemError("HELPER_PROTOCOL", "protocol", "RESTART_IINA");
  }

  request(request: TransportRequest): Promise<TransportResponse> {
    return this.post("/v1/request", request);
  }

  async cancel(jobId: string): Promise<"cancelled" | "already-completed" | "unknown"> {
    const response = await this.post<{ state: "cancelled" | "already-completed" | "unknown" }>(
      "/v1/cancel",
      { jobId },
    );
    return response.state;
  }

  async shutdown(): Promise<void> {
    await this.post("/v1/shutdown", {});
  }
}
