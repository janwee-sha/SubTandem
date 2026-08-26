import {
  isTransportRpcErrorCode,
  TransportRpcError,
  type LocalHttpBridge,
  type TransportRpcErrorCode,
  type TransportRpcClient,
} from "../../transport/client.js";
import type {
  ProviderTransport,
  ProviderTransportRequest,
  ProviderTransportResponse,
} from "../../providers/transport.js";
import type { ProcessLauncher } from "./transport-process.js";

function helperErrorCode(value: unknown): TransportRpcErrorCode | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const response = value as Record<string, unknown>;
  const data = response.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const code = (data as Record<string, unknown>).error;
    if (isTransportRpcErrorCode(code)) return code;
  }
  if (typeof response.text !== "string") return undefined;
  try {
    const parsed = JSON.parse(response.text) as Record<string, unknown>;
    return isTransportRpcErrorCode(parsed.error) ? parsed.error : undefined;
  } catch {
    return undefined;
  }
}

export class IinaLocalHttpBridge implements LocalHttpBridge {
  constructor(private readonly http: IINA.API.HTTP) {}

  async post<T>(url: string, bearerToken: string, body: unknown): Promise<T> {
    let response: IINA.HTTPResponse;
    try {
      response = await this.http.post(url, {
        params: {},
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearerToken}` },
        data: body as Record<string, unknown>,
      });
    } catch (error) {
      // IINA rejects its Promise for every non-2xx response. Preserve only the
      // helper's allowlisted safe code; never surface response text or tokens.
      throw new TransportRpcError(helperErrorCode(error) ?? "helper-rpc-failed");
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new TransportRpcError(helperErrorCode(response) ?? "helper-rpc-failed");
    }
    if (response.data && typeof response.data === "object") return response.data as T;
    try {
      return JSON.parse(response.text) as T;
    } catch {
      throw new Error("HELPER_RPC_MALFORMED");
    }
  }
}

export class IinaProcessLauncher implements ProcessLauncher {
  constructor(private readonly utils: IINA.API.Utils) {}

  launch(
    executable: string,
    args: string[],
    onStdout: (data: string) => void,
  ): Promise<{ status: number }> {
    return this.utils.exec(executable, args, null, onStdout, () => undefined);
  }
}

export class HelperProviderTransport implements ProviderTransport {
  private readonly helperJobs = new Map<string, string>();

  constructor(
    private readonly client: TransportRpcClient,
    private readonly createHelperJobId: () => string,
  ) {}

  async request(request: ProviderTransportRequest): Promise<ProviderTransportResponse> {
    const helperJobId = this.createHelperJobId();
    this.helperJobs.set(request.jobId, helperJobId);
    try {
      const response = await this.client.request({ ...request, jobId: helperJobId });
      return {
        statusCode: response.statusCode,
        headers: response.headers,
        bodyText: response.bodyText,
      };
    } finally {
      if (this.helperJobs.get(request.jobId) === helperJobId) this.helperJobs.delete(request.jobId);
    }
  }

  async cancel(jobId: string): Promise<void> {
    const helperJobId = this.helperJobs.get(jobId);
    if (helperJobId) await this.client.cancel(helperJobId);
  }
}
