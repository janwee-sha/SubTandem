# Security Policy

## Supported Versions

Security fixes are provided for the latest published SubTandem release.

| Version | Supported |
| --- | --- |
| Latest published release | Yes |
| Older releases | No |

Reports that affect the `main` branch or an unreleased development build are welcome, but support commitments apply only to the latest published release.

## Reporting a Vulnerability

Report suspected security vulnerabilities through [GitHub private vulnerability reporting](https://github.com/janwee-sha/SubTandem/security/advisories/new).

Do not disclose a vulnerability in a public issue, discussion, pull request, or other public channel. A useful report should include:

- The affected SubTandem version and installation source
- The Mac model, macOS version, and IINA version
- A clear description of the vulnerability and its potential impact
- Reproduction steps or a minimal proof of concept
- Any required preconditions and known mitigations
- Whether the vulnerability or its details have already been disclosed elsewhere

Report vulnerabilities caused by SubTandem or its bundled release artifacts. Issues that exist exclusively in IINA or a third-party translation service should be reported to that project or provider. If the responsible component is unclear, report the issue privately to SubTandem first.

## Sensitive Data

Do not include real API keys, private endpoint URLs, personal information, or private media or subtitle content in a report. Use synthetic examples or redact sensitive values while preserving the information needed to reproduce the issue.

## Response and Disclosure

Security reports are reviewed on a best-effort basis. The project does not guarantee a specific response, remediation, or disclosure timeline.

If a report is accepted, maintainers will use a private GitHub Security Advisory to investigate, coordinate a fix, and prepare any public disclosure. Keep the report and related details private until an advisory is published or a maintainer explicitly approves disclosure. If a report is declined, maintainers will explain the decision when practical.
