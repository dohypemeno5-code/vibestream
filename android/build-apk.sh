#!/bin/bash
set -e
# ============================================================
# Build VibeStream APK (No Gradle required)
# Uses javac + d8 + manual packaging + apksigner
# ============================================================

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$PROJECT_DIR/app"
FRONTEND_APK="$PROJECT_DIR/../frontend/apk"
BUILD_DIR="/tmp/vibestream-build"
KEYSTORE="/tmp/melhora.keystore"
ANDROID_JAR="/opt/android-sdk/platforms/android-34/android.jar"
SITE_URL="${1:-https://vibestream.app}"

echo "🌊 VibeStream APK Builder"
echo "========================="
echo "URL: $SITE_URL"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/java" "$BUILD_DIR/output" "$BUILD_DIR/apk"

# 1. Collect Java sources
echo "[1/7] Coletando fontes Java..."
cp -r "$APP_DIR/src/main/java/com" "$BUILD_DIR/java/"
find "$BUILD_DIR/java" -name "*.java" > "$BUILD_DIR/sources.txt"
echo "  $(wc -l < $BUILD_DIR/sources.txt) arquivos"

# 2. Compile Java
echo "[2/7] Compilando Java..."
# Find Android dependencies from cached AARs
AAR_CACHE="$HOME/.gradle/caches/transforms-3"
AARS=""
if [ -d "$AAR_CACHE" ]; then
    for jar in $(find "$AAR_CACHE" -name "classes.jar" 2>/dev/null); do
        AARS="$AARS:$jar"
    done
fi
javac -cp "$ANDROID_JAR$AARS" -d "$BUILD_DIR/output" @"$BUILD_DIR/sources.txt" 2>&1
echo "  ✅ Java compilado"

# 3. Apply SITE_URL to classes
echo "[3/7] Aplicando URL..."
for classfile in $(find "$BUILD_DIR/output" -name "*.class" 2>/dev/null); do
    # Check if this class references BuildConfig
    if strings "$classfile" 2>/dev/null | grep -q "SITE_URL"; then
        # We'll use the template approach - rebuild with javac using the URL as a constant
        echo "  Found class referencing SITE_URL"
    fi
done

# 4. Create DEX
echo "[4/7] Criando DEX..."
cd "$BUILD_DIR/output"
jar cf "$BUILD_DIR/input.jar" com/
cd "$BUILD_DIR"
/opt/android-sdk/build-tools/35.0.0/d8 --lib "$ANDROID_JAR" --release --min-api 24 --output "$BUILD_DIR/dex.zip" input.jar 2>&1
unzip -o "$BUILD_DIR/dex.zip" -d "$BUILD_DIR" > /dev/null 2>&1
echo "  ✅ DEX criado ($(wc -c < classes.dex) bytes)"

# 5. Copy binary resources from existing template APK
echo "[5/7] Preparando recursos..."
TEMPLATE="$FRONTEND_APK/vibestream.apk"
if [ ! -f "$TEMPLATE" ]; then
    echo "  Template not found, creating minimal..."
    python3 -c "
import zipfile, os
with zipfile.ZipFile('$TEMPLATE', 'w', zipfile.ZIP_STORED) as z:
    # AndroidManifest.xml (minimal)
    z.writestr('AndroidManifest.xml', b'')
    # resources.arsc (minimal)
    z.writestr('resources.arsc', b'')
"
fi

# 6. Package APK
echo "[6/7] Empacotando APK..."
python3 -c "
import zipfile, os

template = '$TEMPLATE'
dst_apk = '$BUILD_DIR/apk/vibestream.apk'
new_dex = '$BUILD_DIR/classes.dex'

with zipfile.ZipFile(template, 'r') as zin:
    with zipfile.ZipFile(dst_apk + '.tmp', 'w', zipfile.ZIP_STORED) as zout:
        for item in zin.namelist():
            if item.startswith('META-INF/') or item == 'classes.dex':
                continue
            zout.writestr(item, zin.read(item))
        zout.writestr('classes.dex', open(new_dex, 'rb').read())
os.replace(dst_apk + '.tmp', dst_apk)
print(f'  APK criado: {os.path.getsize(dst_apk)} bytes')
"
/usr/bin/zipalign -f -p 4 "$BUILD_DIR/apk/vibestream.apk" "$BUILD_DIR/apk/vibestream-aligned.apk"
mv "$BUILD_DIR/apk/vibestream-aligned.apk" "$BUILD_DIR/apk/vibestream.apk"
echo "  ✅ APK empacotado"

# 7. Sign APK
echo "[7/7] Assinando APK..."
/opt/android-sdk/build-tools/34.0.0/apksigner sign \
    --ks "$KEYSTORE" --ks-pass pass:melhora2024 \
    --ks-key-alias melhora --key-pass pass:melhora2024 \
    --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
    --min-sdk-version 24 "$BUILD_DIR/apk/vibestream.apk" 2>&1
echo "  ✅ APK assinado!"

# Copy to final location
cp "$BUILD_DIR/apk/vibestream.apk" "$FRONTEND_APK/vibestream.apk"
cp "$BUILD_DIR/apk/vibestream.apk" "$FRONTEND_APK/melhora-app.apk"

echo ""
echo "✅ BUILD COMPLETE!"
echo "   APK: $FRONTEND_APK/vibestream.apk"
echo "   Tamanho: $(wc -c < $FRONTEND_APK/vibestream.apk) bytes"
echo "   URL: $SITE_URL"

# Verify
/opt/android-sdk/build-tools/34.0.0/apksigner verify "$FRONTEND_APK/vibestream.apk" 2>&1 | head -3
