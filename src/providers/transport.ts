export interface ProviderTransportRequest {
  jobId: string;
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
