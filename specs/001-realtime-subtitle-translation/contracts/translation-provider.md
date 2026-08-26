# Translation Provider Contract

## One-attempt boundary

Global performs exactly one provider attempt for each request. Main owns retry timing, cache mutation and stale-result rejection.

Every request carries:

- player, request, batch and session identities;
- session/window epochs;
- Profile ID, revision and endpoint fingerprint;
- source/target languages;
- ordered `{ id, text, context? }` items.

Every result contains translations keyed by requested ID and may include sanitized request ID or usage metadata. Errors expose a stable category, retryable flag, optional status/`retryAfterMs`, and user action; they never expose credentials, headers or raw bodies.

## Common output rules

- Use short wire IDs (`c1`, `c2`, ...) and restore original cue IDs only after validation.
- Accept only requested, unique IDs with non-empty text.
- Unknown, duplicate, empty or invalid results remain uncached.
- A valid subset may succeed; only unresolved IDs may be retried.
- Structured schemas set exact `minItems` and `maxItems` for each wire request.
- Provider requests contain no video bytes or unrelated user data.

See [provider-output.schema.json](./provider-output.schema.json).

## OpenAI-compatible Chat Completions

- Persist and display the API root literally; compose `POST {apiRoot}/chat/completions` after trimming trailing `/` only.
- Preview the composed address in the UI; do not silently rewrite a root that already contains the suffix.
- Use optional bearer credential, `stream: false`, and JSON-encoded subtitle data.
- Connection Test may negotiate strict schema, JSON object, then prompt JSON only for recognized format incompatibility.
- Real subtitle work never retries under another response format.
- Split a logical batch into ordered requests of at most two items. Publish each validated wire result immediately and retain a complete terminal aggregate according to [002 progressive output](../../002-progressive-translation-output/contracts/translation-provider.md).

## Ollama native API

- Default to `http://127.0.0.1:11434`; non-loopback HTTP is rejected.
- Test `/api/version`, `/api/tags`, then one structured chat item.
- Use `/api/chat` with `stream: false`, JSON Schema format, deterministic temperature and disabled thinking when supported.
- Split a logical batch into ordered requests of at most two items. Publish each validated wire result immediately and retain a complete terminal aggregate according to [002 progressive output](../../002-progressive-translation-output/contracts/translation-provider.md).

## Retry classification

Retryable conditions are network failure, transport deadline, HTTP 408, temporary 429, HTTP 500/502/503, or an explicitly transient provider error.

Configuration, authentication, missing model, quota, refusal, malformed success and ordinary permanent 4xx errors are not retryable.

Main performs at most three retries after the initial attempt using increasing delays. A valid `Retry-After` raises the delay. Every timer and completion revalidates the full session/window/Profile/batch identity.
