#!/bin/bash
# ============================================================
# START FINAL - VibeStream
# Inicia servidor + tunnel + mantém 24/7
# ============================================================
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "╔══════════════════════════════════════╗"
echo "║   🌊 VIBESTREAM - START FINAL       ║"
echo "╚══════════════════════════════════════╝"

# Config
SERVER_LOG="/tmp/vibestream-server.log"
TUNNEL_LOG="/tmp/vibestream-tunnel.log"
URL_FILE="/tmp/vibestream-url.txt"
PORT=3000

# Kill old processes
pkill -f "node backend/server.js" 2>/dev/null
pkill -f "cloudflared tunnel" 2>/dev/null
pkill -f "lt --port" 2>/dev/null
sleep 2

# Start server
echo "[1/3] Iniciando servidor..."
cd "$DIR"
node backend/server.js > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
sleep 4

if curl -s http://localhost:$PORT/api/health > /dev/null 2>&1; then
    echo "  ✅ Servidor rodando na porta $PORT"
else
    echo "  ❌ Servidor não iniciou!"
    cat "$SERVER_LOG"
    exit 1
fi

# Start tunnel (try cloudflared first, then localtunnel)
echo "[2/3] Iniciando túnel público..."

# Try cloudflared
cloudflared tunnel --url http://localhost:$PORT > "$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!
sleep 10

TUNNEL_URL=$(grep -oP 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1)

if [ -n "$TUNNEL_URL" ]; then
    echo "  ✅ Cloudflare Tunnel: $TUNNEL_URL"
else
    # Fallback to localtunnel
    echo "  ⚠️ Cloudflare falhou, tentando localtunnel..."
    pkill -f "cloudflared" 2>/dev/null
    npx localtunnel --port $PORT 2>/dev/null &
    TUNNEL_PID=$!
    sleep 8
    TUNNEL_URL=$(grep -oP 'https://[a-zA-Z0-9.-]+\.loca\.lt' /tmp/lt-output.log 2>/dev/null | head -1)
    if [ -n "$TUNNEL_URL" ]; then
        echo "  ✅ Localtunnel: $TUNNEL_URL"
    else
        echo "  ⚠️ Sem túnel disponível. Use localhost:$PORT"
        TUNNEL_URL="http://localhost:$PORT"
    fi
fi

echo "$TUNNEL_URL" > "$URL_FILE"

# Update APK with the current URL
echo "[3/3] Atualizando APK com URL..."
bash android/build_apk_final.sh "$TUNNEL_URL" 2>/dev/null
echo "  ✅ APK atualizado!"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   🌊 VIBESTREAM - ONLINE            ║"
echo "╠══════════════════════════════════════╣"
echo "║  🌐 Site: $TUNNEL_URL"
echo "║  📡 Local: http://localhost:$PORT"
echo "║  🔐 Admin: http://localhost:$PORT/admin-admin_melhora_sup3r_s3cr3t0_2024"
echo "║  📱 APK:   $TUNNEL_URL/apk/vibestream.apk"
echo "║  ⬇️  Download: $TUNNEL_URL/download"
echo "║  📜 Regras: $TUNNEL_URL/regras"
echo "║  🛡️  Firewall+Anti-DDoS+Anti-Robô: Ativo"
echo "║  🔞 Verificação de Idade: Ativa"
echo "║  🚫 Anti-Fraude: Ativo"
echo "╚══════════════════════════════════════╝"
echo ""
echo "Comandos:"
echo "  Log server: tail -f $SERVER_LOG"
echo "  Log tunnel: tail -f $TUNNEL_LOG"
echo ""

# Monitor loop
while true; do
    if ! kill -0 $SERVER_PID 2>/dev/null; then
        echo "[$(date)] ⚠️ Servidor reiniciando..."
        cd "$DIR"
        node backend/server.js >> "$SERVER_LOG" 2>&1 &
        SERVER_PID=$!
        sleep 3
    fi
    if [ -n "$TUNNEL_PID" ] && ! kill -0 $TUNNEL_PID 2>/dev/null; then
        echo "[$(date)] ⚠️ Tunnel reiniciando..."
        cloudflared tunnel --url http://localhost:$PORT >> "$TUNNEL_LOG" 2>&1 &
        TUNNEL_PID=$!
        sleep 10
        NEW_URL=$(grep -oP 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1)
        if [ -n "$NEW_URL" ]; then
            echo "$NEW_URL" > "$URL_FILE"
            echo "  Nova URL: $NEW_URL"
        fi
    fi
    sleep 15
done
