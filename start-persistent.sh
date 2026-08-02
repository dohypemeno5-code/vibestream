#!/bin/bash
# ============================================================
# START PERSISTENT - Melhora App Live
# Inicia servidor + tunnel e mantém ambos rodando 24/7
# ============================================================

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "╔══════════════════════════════════════╗"
echo "║   🔥 MELHORA APP LIVE - START       ║"
echo "╚══════════════════════════════════════╝"

# Mata processos antigos
pkill -f "node backend/server.js" 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true
sleep 2

# Inicia servidor Node.js
echo "[1] Iniciando servidor..."
setsid node backend/server.js > /tmp/melhora-server.log 2>&1 &
SERVER_PID=$!
echo "     PID: $SERVER_PID"
sleep 3

# Verifica servidor
if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "     ✅ Servidor rodando na porta 3000"
else
    echo "     ❌ Servidor não respondeu"
    cat /tmp/melhora-server.log
    exit 1
fi

# Inicia Cloudflare Tunnel
echo "[2] Iniciando Cloudflare Tunnel..."
setsid cloudflared tunnel --url http://localhost:3000 > /tmp/melhora-tunnel.log 2>&1 &
TUNNEL_PID=$!
echo "     PID: $TUNNEL_PID"
sleep 8

# Captura URL
TUNNEL_URL=$(grep -oP 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' /tmp/melhora-tunnel.log | head -1)
if [ -n "$TUNNEL_URL" ]; then
    echo "$TUNNEL_URL" > /tmp/melhora-public-url.txt
    echo "     ✅ URL Pública: $TUNNEL_URL"
else
    echo "     ⚠️ URL não detectada. Tunnel pode não estar pronto."
fi

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   🔥 MELHORA APP LIVE - ONLINE      ║"
echo "╠══════════════════════════════════════╣"
echo "║  🌐 Site: $TUNNEL_URL"
echo "║  📡 Local: http://localhost:3000"
echo "║  🔐 Admin: http://localhost:3000/admin-..."
echo "║  📱 APK:   $TUNNEL_URL/apk/melhora-app.apk"
echo "║  ⬇️  Download: $TUNNEL_URL/download"
echo "║  📜 Regras: $TUNNEL_URL/regras"
echo "║  🛡️  Firewall+Anti-DDoS: Ativo        ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "Logs:"
echo "  Server:  tail -f /tmp/melhora-server.log"
echo "  Tunnel:  tail -f /tmp/melhora-tunnel.log"
echo ""

# Monitor
echo "Monitorando processos (CTRL+C para parar)..."
while true; do
    if ! kill -0 $SERVER_PID 2>/dev/null; then
        echo "[$(date)] ⚠️ Servidor reiniciado!"
        setsid node backend/server.js >> /tmp/melhora-server.log 2>&1 &
        SERVER_PID=$!
    fi
    if ! kill -0 $TUNNEL_PID 2>/dev/null; then
        echo "[$(date)] ⚠️ Tunnel reiniciado!"
        setsid cloudflared tunnel --url http://localhost:3000 >> /tmp/melhora-tunnel.log 2>&1 &
        TUNNEL_PID=$!
        sleep 8
        NEW_URL=$(grep -oP 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' /tmp/melhora-tunnel.log | head -1)
        if [ -n "$NEW_URL" ]; then
            echo "$NEW_URL" > /tmp/melhora-public-url.txt
            echo "  Nova URL: $NEW_URL"
        fi
    fi
    sleep 15
done
