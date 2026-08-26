# Local Transport Helper Protocol

The universal macOS helper is limited to authenticated health, fixed-purpose credential persistence, bounded upstream HTTP, exact cancellation and shutdown. It owns no player state, cache or retry policy.

## Startup and authentication

- Bind IPv4 loopback on an ephemeral port.
- Generate an in-memory bearer token with the system CSPRNG.
- Emit one framed ready object containing port, token and protocol version.
- Require the token on every RPC and reject non-loopback clients, invalid tokens, duplicate live job IDs and oversized input.
- Exit on parent loss, authenticated shutdown or 300 seconds without an RPC.

## Endpoints

| Endpoint | Contract |
| --- | --- |
| `POST /v1/health` | Accept zero bytes or literal `{}` and return `{"state":"ok"}` without side effects. |
| `POST /v1/credentials` | Read, replace or delete `{apiKey}` for one UUID Profile; callers cannot choose a path or field. |
| `POST /v1/request` | Execute one bounded HTTP request with exact job ID, timeout, response-size cap and proxy mode. |
| `POST /v1/cancel` | Cancel only the specified live URLSession task or libcurl transfer. |
| `POST /v1/shutdown` | End the authenticated helper session. |

## Credential file

- Store one `credentials.json` below the supplied plugin data directory.
- Restrict the directory to `0700` and each replacement file to `0600`.
- Create an exclusive no-follow temporary file, write the complete bounded document, `fsync`, then atomically rename.
- Return stored values only to Global for provider construction; Main and Sidebar receive configured/not-configured state only.
- Never include the file in the package, preferences, logs, diagnostics or status messages.

The file is local plaintext. Its documented protection boundary is the current user's file permissions.

## HTTP rules

- Remote destinations require HTTPS; exact loopback Ollama may use HTTP.
- Reject URL credentials, fragments, unsupported methods, invalid proxy modes and authorization-changing cross-origin redirects.
- Return status, body and allowlisted `retry-after`, `x-request-id` and `content-type` headers without logging headers or bodies.
- `system` uses URLSession and macOS proxy policy with bounded same-origin redirects.
- `direct` uses in-process system libcurl with `CURLOPT_NOPROXY="*"` and automatic redirects disabled.

## Supervision

- Global performs side-effect-free health before provider or credential work and coalesces concurrent helper replacement.
- Credential read, full replace and delete may retry once after replacing an expired helper.
- Provider request failure after dispatch invalidates the session but is never replayed by the supervisor.
- Cancelling work from an expired session does not start a new helper solely to cancel lost work.
