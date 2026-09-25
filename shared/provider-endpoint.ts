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
  providerEndpointIdentity: typeof providerEndpointIdentity;
  sameProviderService: typeof sameProviderService;
}

(
  globalThis as typeof globalThis & { subtandemProviderEndpoint: SubtandemProviderEndpointApi }
).subtandemProviderEndpoint = {
  normalizeProviderEndpoint,
  providerEndpointIdentity,
  sameProviderService,
};
