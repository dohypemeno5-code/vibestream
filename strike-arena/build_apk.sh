#!/usr/bin/env bash
# =============================================================
# Strike Arena 2D — build do APK (pipeline manual completo)
# Gera APK válido e assinado sem depender de aapt2 (x86_64).
# Requer: aapt (ARM64 via apt), JDK 17, d8/zipalign/apksigner
# do Android SDK build-tools.
# =============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/opt/android-sdk}}"
BT="${ANDROID_BUILD_TOOLS:-$SDK/build-tools/34.0.0}"
PLATFORM_JAR="$SDK/platforms/android-34/android.jar"
KEYSTORE="${KEYSTORE:-/tmp/melhora.keystore}"
KS_PASS="${KS_PASS:-melhora2024}"
KEY_ALIAS="${KEY_ALIAS:-melhora}"
OUT="$ROOT/../frontend/apk/vibestrike.apk"
B="$(mktemp -d /tmp/sa-apk.XXXXXX)"
trap 'rm -rf "$B"' EXIT

echo "==> Strike Arena 2D — build"
command -v aapt >/dev/null || { echo "ERRO: instale o aapt ARM64: sudo apt-get install -y aapt"; exit 1; }
[ -f "$BT/d8" ] || { echo "ERRO: d8 não encontrado em $BT"; exit 1; }
[ -f "$PLATFORM_JAR" ] || { echo "ERRO: platform android-34 não encontrado em $PLATFORM_JAR"; exit 1; }

mkdir -p "$B/gen" "$B/out" "$B/dex"

echo "==> 1/6 Recursos (aapt v1)"
sed 's|<manifest xmlns:android|<manifest package="com.strikearena.game" xmlns:android|' \
    "$ROOT/app/src/main/AndroidManifest.xml" > "$B/AndroidManifest.xml"
aapt package -f -M "$B/AndroidManifest.xml" -S "$ROOT/app/src/main/res" \
    -I "$PLATFORM_JAR" -F "$B/base.apk" -J "$B/gen" \
    --custom-package com.strikearena.game \
    --min-sdk-version 24 --target-sdk-version 35 \
    --version-code 6 --version-name 1.5.0

echo "==> 2/6 Java (javac)"
javac -cp "$PLATFORM_JAR" -d "$B/out" \
    $(find "$B/gen" -name '*.java') \
    $(find "$ROOT/app/src/main/java" -name '*.java')

echo "==> 3/6 DEX (d8)"
(cd "$B/out" && jar cf "$B/classes.jar" com/)
"$BT/d8" --lib "$PLATFORM_JAR" --release --min-api 24 --output "$B/dex" "$B/classes.jar"

echo "==> 4/6 Merge"
python3 - "$B/base.apk" "$B/unsigned.apk" "$B/dex/classes.dex" <<'PY'
import sys, zipfile
src, dst, dex = sys.argv[1], sys.argv[2], sys.argv[3]
with zipfile.ZipFile(src, 'r') as zin, zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        zout.writestr(item, zin.read(item.filename))
    zout.write(dex, 'classes.dex')
PY

echo "==> 5/6 Zipalign"
command -v zipalign >/dev/null && zipalign -f 4 "$B/unsigned.apk" "$B/aligned.apk" || cp "$B/unsigned.apk" "$B/aligned.apk"

echo "==> 6/6 Assinatura"
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" \
    --ks-key-alias "$KEY_ALIAS" --key-pass "pass:$KS_PASS" \
    --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
    --min-sdk-version 24 --out "$OUT" "$B/aligned.apk"

echo "==> Verificação"
"$BT/apksigner" verify --verbose "$OUT" | head -6
echo "==> APK: $OUT ($(wc -c < "$OUT") bytes)"
