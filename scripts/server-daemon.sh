#!/bin/bash
# ============================================================
# SERVER DAEMON - mantém o servidor Node na porta 3000 vivo
# ============================================================
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="/tmp/vibestream-server.log"

while true; do
    if ! pgrep -f "node (backend/)?server\.js" > /dev/null 2>&1; then
        echo "[$(date)] Servidor fora do ar — reiniciando..." >> "$LOG"
        (cd "$DIR" && setsid -f node backend/server.js >> "$LOG" 2>&1 < /dev/null)
        sleep 4
    fi
    sleep 20
done
