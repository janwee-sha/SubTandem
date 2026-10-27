export interface SafeDiagnostic {
  code?: string;
  category?: string;
  statusCode?: number;
  requestId?: string;
  providerCode?: string;
  userAction?: string;
}

export function safeRequestId(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(value) ? value : undefined;
}

export function diagnostic(input: Record<string, unknown>): SafeDiagnostic {
  const output: SafeDiagnostic = {};
  if (typeof input.code === "string" && /^[A-Z0-9_.-]{1,64}$/.test(input.code))
    output.code = input.code;
  if (typeof input.category === "string" && /^[a-z-]{1,32}$/.test(input.category)) {
    output.category = input.category;
  }
  if (typeof input.statusCode === "number" && Number.isInteger(input.statusCode)) {
    output.statusCode = input.statusCode;
  }
  const requestId = safeRequestId(input.requestId);
  if (requestId) output.requestId = requestId;
  if (typeof input.providerCode === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(input.providerCode)) {
    output.providerCode = input.providerCode;
  }
  if (typeof input.userAction === "string" && /^[A-Z0-9_.-]{1,64}$/.test(input.userAction)) {
    output.userAction = input.userAction;
  }
  return output;
}
