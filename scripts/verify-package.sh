#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PACKAGE_DIR=${1:-$PROJECT_DIR}
TRANSPORT="$PACKAGE_DIR/dist/native/subtandem-transport"
EXTRACTOR="$PACKAGE_DIR/dist/native/subtandem-subtitle-extractor"
STYLE_PICKER="$PACKAGE_DIR/dist/native/subtandem-style-picker"
HASH_FILE="$PROJECT_DIR/build/native-hashes.json"
MINIMUM_MACOS=12.0
EXTRACTION_PATH='@tmp/subtandem-extraction'

for required in "$PACKAGE_DIR/Info.json" "$PACKAGE_DIR/README.md" "$PACKAGE_DIR/LICENSE" "$PACKAGE_DIR/THIRD_PARTY_NOTICES.txt" "$PACKAGE_DIR/dist/main.js" "$PACKAGE_DIR/dist/global.js" "$PACKAGE_DIR/dist/ui/sidebar.html" "$PACKAGE_DIR/dist/ui/overlay.html" "$TRANSPORT" "$EXTRACTOR" "$STYLE_PICKER"; do
  if [ ! -f "$required" ]; then
    echo "Missing packaged file: $required" >&2
    exit 1
  fi
done

node "$PROJECT_DIR/scripts/plugin-update-metadata.mjs" --manifest "$PACKAGE_DIR/Info.json" >/dev/null

for compliance_file in LICENSE THIRD_PARTY_NOTICES.txt; do
  if ! cmp -s "$PROJECT_DIR/$compliance_file" "$PACKAGE_DIR/$compliance_file"; then
    echo "Packaged compliance file differs from repository source: $compliance_file" >&2
    exit 1
  fi
done

NATIVE_FILES=$(find "$PACKAGE_DIR/dist/native" -mindepth 1 -maxdepth 1 -type f -print | sed "s|$PACKAGE_DIR/||" | LC_ALL=C sort)
EXPECTED_NATIVE=$(printf '%s\n' dist/native/subtandem-style-picker dist/native/subtandem-subtitle-extractor dist/native/subtandem-transport | LC_ALL=C sort)
if [ "$NATIVE_FILES" != "$EXPECTED_NATIVE" ]; then
  echo "dist/native contains files outside the exact runtime allowlist" >&2
  exit 1
fi

for HELPER in "$TRANSPORT" "$EXTRACTOR" "$STYLE_PICKER"; do
  if [ ! -x "$HELPER" ]; then
    echo "Native helper is not executable: $HELPER" >&2
    exit 1
  fi
  lipo "$HELPER" -verify_arch arm64 x86_64
  codesign --verify --strict "$HELPER"
  MINOS=$(otool -l "$HELPER" | awk '/minos /{print $2}')
  if [ -z "$MINOS" ] || printf '%s\n' "$MINOS" | grep -Ev "^$MINIMUM_MACOS$" | grep -q .; then
    echo "Native helper does not declare macOS 12 deployment" >&2
    exit 1
  fi
  if otool -L "$HELPER" | awk '/^[[:space:]]+\//{print $1}' | grep -Ev '^(/usr/lib/|/System/Library/)' | grep -q .; then
    echo "Native helper has a non-system dynamic dependency" >&2
    exit 1
  fi
done

if [ ! -f "$HASH_FILE" ]; then
  echo "Missing native build hash manifest" >&2
  exit 1
fi
node -e 'const fs=require("node:fs"),c=require("node:crypto"),p=require("node:path");const [manifest,...files]=process.argv.slice(1);const expected=JSON.parse(fs.readFileSync(manifest,"utf8"));const hash=file=>c.createHash("sha256").update(fs.readFileSync(file)).digest("hex");if(files.some(file=>expected[p.basename(file)]!==hash(file)))process.exit(1)' "$HASH_FILE" "$TRANSPORT" "$EXTRACTOR" "$STYLE_PICKER" || {
  echo "Packaged native helper differs from the audited repository build" >&2
  exit 1
}

if LC_ALL=C grep -E -n 'require\(|module\.exports' "$PACKAGE_DIR/dist/main.js" "$PACKAGE_DIR/dist/global.js"; then
  echo "IINA entry bundle contains an unsupported CommonJS runtime reference" >&2
  exit 1
fi
if LC_ALL=C grep -E -n '(href|src)="/' "$PACKAGE_DIR/dist/ui/sidebar.html" "$PACKAGE_DIR/dist/ui/overlay.html"; then
  echo "WebView contains a root-absolute asset URL that IINA cannot resolve" >&2
  exit 1
fi
if LC_ALL=C grep -E -n '<script[^>]+type="module"' "$PACKAGE_DIR/dist/ui/sidebar.html" "$PACKAGE_DIR/dist/ui/overlay.html"; then
  echo "WebView contains an unsupported local module script" >&2
  exit 1
fi
if ! LC_ALL=C grep -q 'Content-Security-Policy' "$PACKAGE_DIR/dist/ui/overlay.html" || ! LC_ALL=C grep -q "connect-src 'none'" "$PACKAGE_DIR/dist/ui/overlay.html" || ! LC_ALL=C grep -q "img-src 'none'" "$PACKAGE_DIR/dist/ui/overlay.html"; then
  echo "Overlay Content-Security-Policy is missing required network restrictions" >&2
  exit 1
fi
if LC_ALL=C grep -q 'data-clickable' "$PACKAGE_DIR/dist/ui/overlay.html"; then
  echo "Overlay must remain non-interactive" >&2
  exit 1
fi
node -e 'const fs=require("node:fs"),path=require("node:path");const root=process.argv[1],htmls=["sidebar.html","overlay.html"];const refs=new Set(htmls);for(const html of htmls){const source=fs.readFileSync(path.join(root,html),"utf8");for(const match of source.matchAll(/(?:href|src)="([^"#]+)"/g)){const value=match[1];if(/^[a-z]+:/i.test(value)||value.startsWith("/"))process.exit(1);const resolved=path.normalize(path.join(root,value));if(!resolved.startsWith(root+path.sep)||!fs.statSync(resolved).isFile())process.exit(1);refs.add(path.relative(root,resolved));}}const files=fs.readdirSync(root,{recursive:true,withFileTypes:true}).filter(entry=>entry.isFile()).map(entry=>path.join(entry.parentPath??entry.path,entry.name)).map(file=>path.relative(root,file));if(files.some(file=>!refs.has(file)))process.exit(1);' "$PACKAGE_DIR/dist/ui" || {
  echo "dist/ui contains missing, unsafe, or unreferenced WebView resources" >&2
  exit 1
}

if find "$PACKAGE_DIR/dist" -type f \( -name 'credentials.json' -o -name '.env*' -o -name '*.pem' -o -name '*.key' \) | grep -q .; then
  echo "Forbidden secret/runtime file found in dist" >&2
  exit 1
fi
if find "$PACKAGE_DIR" -maxdepth 1 -type d \( -name '@data' -o -name '@tmp' \) | grep -q .; then
  echo "Forbidden plugin runtime directory found at package root" >&2
  exit 1
fi
if LC_ALL=C grep -ER -n 'sk-[A-Za-z0-9_-]{20,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----' "$PACKAGE_DIR/dist" "$PACKAGE_DIR/Info.json"; then
  echo "Secret-like material found in package" >&2
  exit 1
fi

if LC_ALL=C grep -ER -n '(sub-add|sub-remove|secondary-sid)' "$PACKAGE_DIR/dist"; then
  echo "Removed subtitle publication path found in runtime bundle" >&2
  exit 1
fi
if LC_ALL=C grep -ER -n '@tmp/subtandem-[^/]*\.srt' "$PACKAGE_DIR/dist" | grep -v "$EXTRACTION_PATH"; then
  echo "Translated subtitle display file path found in runtime bundle" >&2
  exit 1
fi

if find "$PACKAGE_DIR/dist" -type f \( -name '*.a' -o -name '*.o' -o -name '*.h' -o -name '*.dSYM' -o -name 'ffmpeg-*.tar.*' -o -name 'ffmpeg.lock.json' \) | grep -q .; then
  echo "FFmpeg source or build material found in runtime package" >&2
  exit 1
fi

echo "Package verification passed"
