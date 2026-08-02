#!/bin/bash
set -e
GAME_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="/tmp/vibestrike-build"
ANDROID_JAR="/opt/android-sdk/platforms/android-34/android.jar"
KEYSTORE="/tmp/melhora.keystore"
OUTPUT_APK="$GAME_DIR/vibestrike.apk"
FRONTEND_APK="/root/Documents/Codex/2026-07-29/melhora-app-live-real-igual-kwai/frontend/apk/vibestrike.apk"

echo "🏙 VibeStrike - Build APK"
echo "========================="
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/java" "$BUILD_DIR/output" "$BUILD_DIR/dex-output"

# 1. Compile Java
echo "[1/4] Compilando Java..."
cp -r "$GAME_DIR/app/src/main/java/com" "$BUILD_DIR/java/"
find "$BUILD_DIR/java" -name "*.java" > "$BUILD_DIR/sources.txt"
javac -cp "$ANDROID_JAR" -d "$BUILD_DIR/output" @"$BUILD_DIR/sources.txt"
echo "  ✅ Java compilado"

# 2. Create DEX
echo "[2/4] Criando DEX..."
cd "$BUILD_DIR/output"
jar cf "$BUILD_DIR/input.jar" com/
cd "$BUILD_DIR"
/opt/android-sdk/build-tools/34.0.0/d8 --lib "$ANDROID_JAR" --release --min-api 24 \
  --output "$BUILD_DIR/dex-output" "$BUILD_DIR/input.jar"
echo "  ✅ DEX: $(wc -c < "$BUILD_DIR/dex-output/classes.dex") bytes"

# 3. Package APK (binary manifest + valid ARSC + DEX)
echo "[3/4] Empacotando APK..."
python3 << PYEOF
import zipfile, os, struct, zlib

build_dir = "$BUILD_DIR"
apk_path = os.path.join(build_dir, "vibestrike.apk")

# Binary manifest (generated separately)
manifest_path = "/tmp/vibestrike-build-v2/AndroidManifest.xml"
if not os.path.exists(manifest_path):
    # Use the one in the game dir if available
    manifest_path = os.path.join("$GAME_DIR", "app/src/main/AndroidManifest.xml")
    print("WARNING: Using text manifest - will NOT install correctly!")
    print("Run the full build script with binary manifest generation!")

with open(manifest_path, 'rb') as f:
    manifest_data = f.read()

# Minimal valid ARSC
arsc_data = struct.pack('<HHII', 0x0002, 0x000C, 0x000C, 0)

# DEX
with open(os.path.join(build_dir, "dex-output/classes.dex"), 'rb') as f:
    dex_data = f.read()

def compress_deflate(data):
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    return c.compress(data) + c.flush()

entries = [
    ("AndroidManifest.xml", manifest_data),
    ("resources.arsc", arsc_data),
    ("classes.dex", dex_data),
]

compressed = {n: compress_deflate(d) for n, d in entries}

with open(apk_path, 'wb') as f:
    offsets = {}
    for name, data in entries:
        offsets[name] = f.tell()
        nb = name.encode('utf-8')
        crc = zipfile.crc32(data) & 0xffffffff
        f.write(b'PK\x03\x04')
        f.write(struct.pack('<H', 20))
        f.write(struct.pack('<H', 0))
        f.write(struct.pack('<H', 8))
        f.write(struct.pack('<H', 0))
        f.write(struct.pack('<H', 0))
        f.write(struct.pack('<I', crc))
        f.write(struct.pack('<I', len(compressed[name])))
        f.write(struct.pack('<I', len(data)))
        f.write(struct.pack('<H', len(nb)))
        f.write(struct.pack('<H', 0))
        f.write(nb)
        f.write(compressed[name])

    cd_offset = f.tell()
    for name, data in entries:
        nb = name.encode('utf-8')
        crc = zipfile.crc32(data) & 0xffffffff
        f.write(b'PK\x01\x02')
        f.write(struct.pack('<H', 20))
        f.write(struct.pack('<H', 20))
        f.write(struct.pack('<H', 0))
        f.write(struct.pack('<H', 8))
        f.write(struct.pack('<H', 0))
        f.write(struct.pack('<H', 0))
        f.write(struct.pack('<I', crc))
        f.write(struct.pack('<I', len(compressed[name])))
        f.write(struct.pack('<I', len(data)))
        f.write(struct.pack('<H', len(nb)))
        f.write(struct.pack('<H', 0))
        f.write(struct.pack('<H', 0))
        f.write(struct.pack('<H', 0))
        f.write(struct.pack('<H', 0))
        f.write(struct.pack('<I', 0))
        f.write(struct.pack('<I', offsets[name]))
        f.write(nb)

    cd_size = f.tell() - cd_offset
    f.write(b'PK\x05\x06')
    f.write(struct.pack('<H', 0))
    f.write(struct.pack('<H', 0))
    f.write(struct.pack('<H', len(entries)))
    f.write(struct.pack('<H', len(entries)))
    f.write(struct.pack('<I', cd_size))
    f.write(struct.pack('<I', cd_offset))
    f.write(struct.pack('<H', 0))

print(f"  ✅ APK: {os.path.getsize(apk_path)} bytes")
PYEOF

# 4. Sign
echo "[4/4] Assinando APK..."
/opt/android-sdk/build-tools/34.0.0/apksigner sign \
  --ks "$KEYSTORE" --ks-pass pass:melhora2024 \
  --ks-key-alias melhora --key-pass pass:melhora2024 \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --min-sdk-version 24 "$BUILD_DIR/vibestrike.apk"
echo "  ✅ APK assinado!"

# Copy
cp "$BUILD_DIR/vibestrike.apk" "$OUTPUT_APK"
cp "$BUILD_DIR/vibestrike.apk" "$FRONTEND_APK"
echo "✅ APK: $OUTPUT_APK ($(wc -c < "$OUTPUT_APK") bytes)"
echo "🔍 Verify: apksigner verify --min-sdk-version 24 $OUTPUT_APK"
