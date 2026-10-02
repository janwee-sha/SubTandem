#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
OBS="$ROOT/build/credential-observer"
PACKAGE="$OBS/native"
STAGE="$OBS/SubTandem"
mkdir -p "$PACKAGE/Sources"
find "$PACKAGE/Sources" -mindepth 1 -delete
cp "$ROOT/native/transport/Package.swift" "$PACKAGE/Package.swift"
cp -R "$ROOT/native/transport/Sources/CCurl" "$ROOT/native/transport/Sources/SubTandemTransport" "$PACKAGE/Sources/"
cp "$ROOT/tests/helpers/CredentialWriteObserver.swift" "$PACKAGE/Sources/SubTandemTransport/"
for ARCH in arm64 x86_64; do
  DEST="$ROOT/native/.build/swiftbuild/destinations/$ARCH.json"
  swift build --build-system swiftbuild -Xswiftc -DSUBTANDEM_CREDENTIAL_TEST_OBSERVER -Xswiftc -DSUBTANDEM_CREDENTIAL_OBSERVER_HOST --disable-sandbox --package-path "$PACKAGE" --scratch-path "$OBS/swift/$ARCH" -c release --destination "$DEST" --arch "$ARCH"
  BIN=$(swift build --build-system swiftbuild -Xswiftc -DSUBTANDEM_CREDENTIAL_TEST_OBSERVER -Xswiftc -DSUBTANDEM_CREDENTIAL_OBSERVER_HOST --disable-sandbox --package-path "$PACKAGE" --scratch-path "$OBS/swift/$ARCH" -c release --destination "$DEST" --arch "$ARCH" --show-bin-path)
  cp "$BIN/subtandem-transport" "$OBS/transport-$ARCH"
done
mkdir -p "$STAGE"
find "$STAGE" -mindepth 1 -delete
cp -R "$ROOT/build/package/SubTandem/." "$STAGE/"
lipo -create "$OBS/transport-arm64" "$OBS/transport-x86_64" -output "$STAGE/dist/native/subtandem-transport"
chmod 755 "$STAGE/dist/native/subtandem-transport"
codesign --force --sign - "$STAGE/dist/native/subtandem-transport"
codesign --verify --strict "$STAGE/dist/native/subtandem-transport"
node --input-type=module - "$ROOT" "$STAGE" <<'JS'
import fs from "node:fs";
const [root, stage] = process.argv.slice(2);
const observer = fs.readFileSync(`${root}/tests/helpers/credential-host-write-observer.js`, "utf8");
for (const surface of ["main", "global"]) {
  const file = `${stage}/dist/${surface}.js`;
  fs.writeFileSync(file, observer.replaceAll('"__SUBTANDEM_OBSERVER_SURFACE__"', JSON.stringify(surface)) + fs.readFileSync(file, "utf8"));
}
JS
(cd "$OBS" && /Applications/IINA.app/Contents/MacOS/iina-plugin pack SubTandem)
mv "$OBS/SubTandem-0.1.9.iinaplgz" "$OBS/SubTandem-0.1.9-US2-observer-A1.iinaplgz"
shasum -a 256 "$OBS/SubTandem-0.1.9-US2-observer-A1.iinaplgz" "$STAGE/dist/native/subtandem-transport"
