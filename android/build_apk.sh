#!/bin/bash
# ============================================================
# BUILD APK - Melhora App Live
# ============================================================
# Este script pode:
# 1. Buildar o APK localmente (requer Java + Android SDK)
# 2. Abrir PWABuilder para build online
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SITE_URL="https://post-pioneer-kruger-saves.trycloudflare.com"

echo "🔥 Melhora App Live - Build do APK Android"
echo "=========================================="
echo ""
echo "Site URL: $SITE_URL"
echo ""
echo "Escolha uma opção:"
echo "1) Build local (requer Android SDK)"
echo "2) Abrir PWABuilder (build online)"
echo "3) Instruções manuais"
echo ""

if [ "$(uname)" = "Linux" ] || [ "$(uname)" = "Darwin" ]; then
    read -p "Opção [1-3]: " OPT
else
    OPT="3"
fi

case $OPT in
    1)
        echo ""
        echo "Buildando APK localmente..."
        cd "$SCRIPT_DIR"
        ./gradlew assembleRelease
        if [ -f "app/build/outputs/apk/release/app-release.apk" ]; then
            echo ""
            echo "✅ APK gerado: app/build/outputs/apk/release/app-release.apk"
        fi
        ;;
    2)
        echo ""
        echo "Abra o link abaixo no navegador:"
        echo "https://pwabuilder.com"
        echo ""
        echo "Cole a URL do site:"
        echo "$SITE_URL"
        echo ""
        echo "Siga as instruções do PWABuilder para gerar o APK"
        ;;
    3)
        echo ""
        echo "📱 INSTRUÇÕES PARA GERAR APK"
        echo "============================="
        echo ""
        echo "Opção A - Android Studio (recomendado):"
        echo "  1. Instale Android Studio (developer.android.com/studio)"
        echo "  2. Abra este projeto: $SCRIPT_DIR"
        echo "  3. Vá em Build > Build Bundle(s) / APK(s) > Build APK(s)"
        echo "  4. APK gerado em: app/build/outputs/apk/debug/"
        echo ""
        echo "Opção B - PWABuilder (mais fácil, sem código):"
        echo "  1. Acesse: https://pwabuilder.com"
        echo "  2. Digite a URL: $SITE_URL"
        echo "  3. Escolha Android e gere o APK"
        echo ""
        echo "Opção C - APK Online grátis:"
        echo "  1. Acesse: https://appmaker.xyz/pwa-to-apk"
        echo "  2. Digite a URL: $SITE_URL"
        echo "  3. Gere e baixe o APK"
        ;;
esac
