#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FRONTEND_APK="$PROJECT_DIR/frontend/apk"
BUILD_DIR="/tmp/vibestream-build"
KEYSTORE="/tmp/melhora.keystore"
ANDROID_JAR="/opt/android-sdk/platforms/android-34/android.jar"
SITE_URL="${1:-https://vibestream.app}"

echo "🔥 Build APK VibeStream"
echo "URL: $SITE_URL"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/java/com/vibestream/app" "$BUILD_DIR/output"

# Substituir URL no template Java
sed "s|__SITE_URL__|$SITE_URL|g" /tmp/apk-templates/MainActivity.java > "$BUILD_DIR/java/com/vibestream/app/MainActivity.java"
echo "[1/6] Java criado"

javac -cp "$ANDROID_JAR" -d "$BUILD_DIR/output" "$BUILD_DIR/java/com/vibestream/app/MainActivity.java"
echo "[2/6] Java compilado"

cd "$BUILD_DIR/output"
jar cf "$BUILD_DIR/input.jar" com/
echo "[3/6] JAR criado"

cd "$BUILD_DIR"
/opt/android-sdk/build-tools/35.0.0/d8 --lib "$ANDROID_JAR" --release --min-api 24 --output "$BUILD_DIR/dex-output.zip" input.jar
unzip -o "$BUILD_DIR/dex-output.zip" -d "$BUILD_DIR" > /dev/null 2>&1
echo "[4/6] DEX criado ($(wc -c < classes.dex) bytes)"

# Usar recursos do template APK
python3 -c "
import zipfile, os
template = '$FRONTEND_APK/vibestream.apk' if os.path.exists('$FRONTEND_APK/vibestream.apk') else '$FRONTEND_APK/melhora-app.apk'
if not os.path.exists(template):
    print('ERRO: Template APK não encontrado!')
    exit(1)
dst_apk = '$BUILD_DIR/vibestream.apk'
new_dex = '$BUILD_DIR/classes.dex'
with zipfile.ZipFile(template, 'r') as zin:
    with zipfile.ZipFile(dst_apk, 'w', zipfile.ZIP_STORED) as zout:
        for item in zin.namelist():
            if item.startswith('META-INF/'):
                continue
            data = zin.read(item)
            if item == 'classes.dex':
                with open(new_dex, 'rb') as f:
                    data = f.read()
            zout.writestr(item, data)
print(f'[5/6] APK criado ({os.path.getsize(dst_apk)} bytes)')
"

# Assinar
/opt/android-sdk/build-tools/34.0.0/apksigner sign \
  --ks "$KEYSTORE" --ks-pass pass:melhora2024 \
  --ks-key-alias melhora --key-pass pass:melhora2024 \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --min-sdk-version 24 "$BUILD_DIR/vibestream.apk"
echo "[6/6] APK assinado!"

cp "$BUILD_DIR/vibestream.apk" "$FRONTEND_APK/vibestream.apk"
cp "$BUILD_DIR/vibestream.apk" "$FRONTEND_APK/melhora-app.apk"
echo "✅ APK FINAL: $FRONTEND_APK/vibestream.apk ($(wc -c < $FRONTEND_APK/vibestream.apk) bytes)"
echo "📱 URL: $SITE_URL/apk/vibestream.apk"
