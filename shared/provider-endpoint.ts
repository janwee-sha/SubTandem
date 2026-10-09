type ProviderEndpointKind = "openai" | "claude" | "deepseek" | "ollama";

function invalidEndpoint(): never {
  throw new Error("INVALID_ENDPOINT");
}

function validatePort(value: string): void {
  if (!/^\d+$/.test(value)) invalidEndpoint();
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) invalidEndpoint();
}

function validateIpv6Host(value: string): void {
  if (!value.includes(":") || !/^[0-9a-f:.]+$/i.test(value)) invalidEndpoint();
  const compression = value.indexOf("::");
  if (compression !== value.lastIndexOf("::")) invalidEndpoint();
  const groups = value.split(":").filter(Boolean);
  if (groups.some((group) => group.length > 4)) invalidEndpoint();
  if ((compression === -1 && groups.length !== 8) || (compression !== -1 && groups.length >= 8))
    invalidEndpoint();
}

function validateAuthority(authority: string): void {
  if (!authority || /\s|@/.test(authority)) invalidEndpoint();
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]");
    if (close < 2 || authority.indexOf("]", close + 1) !== -1) invalidEndpoint();
    validateIpv6Host(authority.slice(1, close));
    const suffix = authority.slice(close + 1);
    if (!suffix) return;
    if (!suffix.startsWith(":")) invalidEndpoint();
    validatePort(suffix.slice(1));
    return;
  }
  if (authority.includes("[") || authority.includes("]")) invalidEndpoint();
  const separator = authority.lastIndexOf(":");
  const host = separator === -1 ? authority : authority.slice(0, separator);
  if (!host || host.includes(":")) invalidEndpoint();
  if (separator !== -1) validatePort(authority.slice(separator + 1));
}

function normalizeProviderEndpoint(kind: ProviderEndpointKind, value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(https?):\/\/([^/?#]+)(\/[^?#]*)?$/i);
  if (!match || /[?#]/.test(trimmed)) invalidEndpoint();
  const authority = match[2]!;
  validateAuthority(authority);
  const path = (match[3] ?? "").replace(/\/+$/, "");
  if (kind === "claude" && /\/v1\/(?:messages|models)$/i.test(path)) invalidEndpoint();
  return trimmed;
}

type ProviderApiResource = "translation" | "models";

const providerApiPaths: Record<ProviderEndpointKind, Record<ProviderApiResource, string>> = {
  openai: { translation: "/v1/chat/completions", models: "/v1/models" },
  claude: { translation: "/v1/messages", models: "/v1/models" },
  deepseek: { translation: "/chat/completions", models: "/models" },
  ollama: { translation: "/api/chat", models: "/api/tags" },
};

function providerApiPath(kind: ProviderEndpointKind, resource: ProviderApiResource): string {
  return providerApiPaths[kind][resource];
}

function providerApiUrl(
  kind: ProviderEndpointKind,
  root: string,
  resource: ProviderApiResource,
): string {
  return `${normalizeProviderEndpoint(kind, root).replace(/\/+$/, "")}${providerApiPath(kind, resource)}`;
}

function providerEndpointIdentity(kind: ProviderEndpointKind, value: string): string {
  const endpoint = normalizeProviderEndpoint(kind, value);
  const match = endpoint.match(/^(https?):\/\/([^/?#]+)(\/[^?#]*)?$/i)!;
  return `${match[1]!.toLowerCase()}://${match[2]!.toLowerCase()}${(match[3] ?? "").replace(/\/+$/, "")}`;
}

interface ServiceIdentity {
  kind: ProviderEndpointKind;
  endpoint: string;
  proxyMode: "system" | "direct";
}

function sameProviderService(left: ServiceIdentity, right: ServiceIdentity): boolean {
  if (left.kind !== right.kind || left.proxyMode !== right.proxyMode) return false;
  try {
    return (
      providerEndpointIdentity(left.kind, left.endpoint) ===
      providerEndpointIdentity(right.kind, right.endpoint)
    );
  } catch {
    return false;
  }
}

interface SubtandemProviderEndpointApi {
  normalizeProviderEndpoint: typeof normalizeProviderEndpoint;
  providerApiPath: typeof providerApiPath;
  providerApiUrl: typeof providerApiUrl;
  providerEndpointIdentity: typeof providerEndpointIdentity;
  sameProviderService: typeof sameProviderService;
}

(
  globalThis as typeof globalThis & { subtandemProviderEndpoint: SubtandemProviderEndpointApi }
).subtandemProviderEndpoint = {
  normalizeProviderEndpoint,
  providerApiPath,
  providerApiUrl,
  providerEndpointIdentity,
  sameProviderService,
};
