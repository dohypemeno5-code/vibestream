#!/bin/bash
# ============================================================
# START SERVER + TUNNEL - Melhora App Live
# Inicia o servidor Node.js + Cloudflare Tunnel
# ============================================================

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "🔥 Iniciando Melhora App Live..."
echo "================================"

# Mata processos anteriores
pkill -f "node backend/server.js" 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true
sleep 1

# Inicia o servidor
echo "[1/2] Iniciando servidor Node.js..."
nohup node backend/server.js > /tmp/melhora-server.log 2>&1 &
SERVER_PID=$!
echo "  PID: $SERVER_PID"

# Aguarda servidor ficar pronto
sleep 3

# Verifica se está rodando
if kill -0 $SERVER_PID 2>/dev/null; then
    echo "  ✅ Servidor rodando na porta 3000"
else
    echo "  ❌ ERRO: Servidor não iniciou!"
    cat /tmp/melhora-server.log
    exit 1
fi

# Inicia Cloudflare Tunnel
echo "[2/2] Iniciando Cloudflare Tunnel..."
nohup cloudflared tunnel --url http://localhost:3000 > /tmp/melhora-tunnel.log 2>&1 &
TUNNEL_PID=$!
echo "  PID: $TUNNEL_PID"

# Aguarda tunnel obter URL
sleep 5

# Tenta capturar a URL do túnel
TUNNEL_URL=$(grep -oP 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' /tmp/melhora-tunnel.log | head -1)
if [ -n "$TUNNEL_URL" ]; then
    echo "  ✅ URL Pública: $TUNNEL_URL"
    echo "$TUNNEL_URL" > /tmp/melhora-public-url.txt
else
    echo "  ⚠️  URL não detectada. Verifique /tmp/melhora-tunnel.log"
    echo "  Tentando novamente em 5s..."
    sleep 5
    TUNNEL_URL=$(grep -oP 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' /tmp/melhora-tunnel.log | head -1)
    if [ -n "$TUNNEL_URL" ]; then
        echo "  ✅ URL Pública: $TUNNEL_URL"
        echo "$TUNNEL_URL" > /tmp/melhora-public-url.txt
    fi
fi

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   🔥 MELHORA APP LIVE - ONLINE      ║"
echo "╠══════════════════════════════════════╣"
if [ -n "$TUNNEL_URL" ]; then
    echo "║  🌐 Site: $TUNNEL_URL"
fi
echo "║  📡 Local: http://localhost:3000"
echo "║  🔐 Admin: http://localhost:3000/admin-..."
echo "║  🛡️  Firewall + Anti-DDoS: Ativo    ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "Logs:"
echo "  Server:  tail -f /tmp/melhora-server.log"
echo "  Tunnel:  tail -f /tmp/melhora-tunnel.log"
echo ""

# Monitora processos
while true; do
    if ! kill -0 $SERVER_PID 2>/dev/null; then
        echo "[$(date)] ⚠️ Servidor caiu! Reiniciando..."
        nohup node backend/server.js >> /tmp/melhora-server.log 2>&1 &
        SERVER_PID=$!
    fi
    if ! kill -0 $TUNNEL_PID 2>/dev/null; then
        echo "[$(date)] ⚠️ Tunnel caiu! Reiniciando..."
        nohup cloudflared tunnel --url http://localhost:3000 >> /tmp/melhora-tunnel.log 2>&1 &
        TUNNEL_PID=$!
        sleep 5
        NEW_URL=$(grep -oP 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' /tmp/melhora-tunnel.log | head -1)
        if [ -n "$NEW_URL" ]; then
            echo "$NEW_URL" > /tmp/melhora-public-url.txt
            echo "[$(date)] ✅ Nova URL: $NEW_URL"
        fi
    fi
    sleep 10
done
