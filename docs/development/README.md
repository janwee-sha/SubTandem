# SubTandem Development Guide

This guide explains how to build, test, package, and validate the plugin.

## Development Environment

- macOS 12 or later
- IINA 1.4.0 or later
- Node.js 24 and npm 11
- Swift 6.2 or later with the `swiftbuild` backend and the arm64 and x86_64 compatibility libraries required for macOS 12
- `curl`, `shasum`, `lipo`, `codesign`, and Xcode Command Line Tools

## Build and Automated Checks

```sh
npm ci
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
npm run test
npm run typecheck
npm run lint
npm run format:check
npm run build:native
npm run test:native
npm run build
npm run verify:package
npm run pack
```

The main commands perform the following tasks:

- `npm ci`: Installs the locked dependencies.
- `npm run test`: Runs the TypeScript automated tests.
- `npm run typecheck`: Checks the TypeScript types for the plugin runtime and Sidebar.
- `npm run lint`: Runs ESLint.
- `npm run build:native`: Validates `native/ffmpeg.lock.json`, builds static FFmpeg for macOS 12 on arm64 and x86_64 from the locked source,
  and generates three universal Swift executables: the transport, subtitle extractor, and style picker.
- `npm run test:native`: Runs the Swift contract, security, pure selector logic, and real small-sample tests for the transport, subtitle extractor, and style picker.
- `npm run build`: Builds the plugin runtime and Sidebar.
- `npm run verify:package`: Validates the contents to be packaged.
- `npm run pack`: Generates `build/package/SubTandem-X.Y.Z.iinaplgz`.

After validating the source, toolchain, deployment target, and architectures, the native build reuses `native/.build/ffmpeg` and the Swift incremental build directories. The final universal helpers, signatures, architectures, and package contents are still regenerated or validated during every full check. To rule out cache-related effects, run:

```sh
SUBTANDEM_FORCE_REBUILD=1 npm run build:native
```

If the preflight check reports that the Swift toolchain is missing an arm64 or x86_64 compatibility library, first confirm that `DEVELOPER_DIR` points to a full Xcode installation. Do not continue with Command Line Tools that contain libraries only for the host architecture.

## IINA Development Link

Use IINA's bundled plugin CLI to create a development link:

```sh
/Applications/IINA.app/Contents/MacOS/iina-plugin link .
```

`link` creates an `.iinaplugin-dev` development link.

To remove the link, run:

```sh
/Applications/IINA.app/Contents/MacOS/iina-plugin unlink .
```

## Release Package Validation

Before validating a release package, remove the development link for the current workspace, then open the packaged artifact:

```sh
/Applications/IINA.app/Contents/MacOS/iina-plugin unlink .
open build/package/SubTandem-X.Y.Z.iinaplgz
```

Restart IINA, enable SubTandem under Settings → Plugins, and open the plugin from the player sidebar.
The installed release `.iinaplgz` must be removable from the plugin management panel. Do not keep both a release installation and a development link for the same version.
