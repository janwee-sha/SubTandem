# Contributing to SubTandem

Thank you for helping improve SubTandem. Contributions of bug reports, feature ideas,
documentation, tests, and code are welcome.

## Before You Start

Search the [issue tracker](https://github.com/janwee-sha/SubTandem/issues) before opening an
issue or starting a pull request.

Open an issue before implementation when a change:

- adds or substantially changes user-facing behavior;
- changes the sidebar, translation overlay, settings, or another interaction;
- affects credentials, privacy, network access, permissions, packaging, or release behavior; or
- spans multiple components or needs a design decision from the maintainers.

Include a mockup for visual changes when practical. Small, self-contained fixes do not require
prior discussion.

Report suspected vulnerabilities privately according to the
[security policy](.github/SECURITY.md). Never disclose a vulnerability in a public issue or pull
request.

## Report a Bug or Request a Feature

Use the repository's issue templates and include the requested context. A useful bug report has
minimal reproduction steps, expected and actual behavior, and the relevant macOS, IINA, and
SubTandem versions.

Do not post API keys, private endpoint URLs, personal information, private media or subtitle
content, or unsanitized logs and screenshots. Use synthetic examples and redact sensitive values.

## Development Setup

SubTandem development requires:

- macOS 12 or later;
- IINA 1.4.0 or later;
- Node.js 24 and npm 11;
- Swift 6.2 or later, with the `swiftbuild` backend and the arm64 and x86_64 compatibility
  libraries required for macOS 12; and
- `curl`, `shasum`, `lipo`, `codesign`, and Xcode Command Line Tools.

See the [development guide](docs/development/README.md) for build details, native toolchain
requirements, development links, and release-package validation.

## Repository Layout

- `src/` contains the TypeScript plugin runtime, domain logic, providers, and IINA adapters.
- `ui/` contains the sidebar and translation-overlay WebViews.
- `native/` contains the Swift transport, subtitle extractor, and style picker.
- `tests/` contains unit, integration, contract, and security tests.
- `scripts/` contains the supported build, package, verification, and release tooling.
- `docs/` contains user-facing README translations, release notes, and the development guide.

Do not commit `dist/`, `build/`, dependency trees, native build caches, runtime data, credentials,
or other generated machine state.

## Development Principles

### Keep changes focused

Implement only the behavior needed for the proposed change. Do not add speculative abstractions,
compatibility paths for abandoned designs, or unrelated cleanup. Remove replaced implementation
paths instead of keeping dormant alternatives.

Submit unrelated changes as separate pull requests. Include only files you intentionally changed.

### Protect credentials and user data

Credentials and provider requests must be limited to the translation profile explicitly selected
by the user and to the data needed for that operation.

- Credentials must not appear in IINA preferences, logs, diagnostics, process arguments, UI state,
  fixtures, or packaged artifacts.
- Saved credentials are write-only outside the credential store; the sidebar and main runtime may
  receive configured state, but not the stored value.
- Only the explicitly enabled profile revision may receive nearby subtitle text.
- Temporary subtitle files and in-memory translation caches must be cleared with their session.
- Changes to permissions, persistence, data retention, retry behavior, built-in network
  destinations, or automatic network activity must update the relevant user disclosure and
  security regression coverage.

All committed test data must be synthetic and safe to publish.

### Match IINA and macOS

For visible UI changes, first find the closest equivalent in a supported IINA and macOS version.
Match its layout, spacing, typography, colors, icons, states, motion, control behavior, and feedback
as closely as the IINA plugin API and WebView allow.

When no direct equivalent exists, follow IINA's design language and standard macOS interaction
conventions. Explain any necessary deviation in the pull request, including the reference UI and
the technical, accessibility, or product reason for the difference.

### Keep production code clear and English-only

Production code must communicate intent through names, responsibilities, and structure. Do not add
line comments, block comments, or documentation comments to production code; refactor code that
would otherwise need explanatory comments.

Identifiers, executable logic, and non-localized natural-language content in production code must
be in English. Non-English content belongs only in localization resources or user data when a
feature specifically requires it. This restriction does not apply to tests or project
documentation.

Follow the existing code style and run Prettier, ESLint, and the TypeScript compiler rather than
introducing a separate style convention.

### Keep release artifacts reproducible and minimal

The `.iinaplgz` package must be reproducible from version-controlled source, lock files, and project
scripts. It may contain only runtime and license-compliance material. It must not contain source,
tests, development documentation, dependency trees, caches, environment files, credentials, or
other secrets.

Do not hand-edit generated build output. Use the repository scripts for native builds, plugin
builds, verification, and packaging.

## Pull Requests

Before opening a pull request:

1. Update your branch with the latest `main` and resolve conflicts.
2. Review the diff for accidental, generated, or sensitive files.
3. Confirm that the change has appropriate regression coverage and that applicable checks pass.
4. Keep commits understandable and the pull request limited to one concern.

The pull request description should:

- explain the problem and the chosen solution;
- link the relevant issue when one exists;
- call out user-visible, privacy, permission, network, packaging, and compatibility effects;
- include screenshots or short recordings for visual changes;
- describe automated and manual validation; and
- identify any remaining limitation or check that could not be completed.

Maintainers may request changes for safety, scope, consistency, tests, or alignment with IINA and
macOS. Review may be delayed for large changes that were not discussed in advance.

## License

SubTandem is licensed under the [GNU General Public License v3.0 only](LICENSE). By submitting a
contribution, you confirm that you have the right to provide it and agree that it will be licensed
under the same license.
