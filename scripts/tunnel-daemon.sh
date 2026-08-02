#!/bin/bash
# ============================================================
# TUNNEL DAEMON - mantém o Cloudflare Tunnel vivo 24/7
# Reinicia automaticamente se cair e grava a URL em
# /tmp/vibestream-url.txt
# ============================================================
LOG="/tmp/vibestream-tunnel.log"
URL_FILE="/tmp/vibestream-url.txt"

while true; do
    if ! pgrep -x cloudflared > /dev/null 2>&1; then
        echo "[$(date)] cloudflared fora do ar — reiniciando..." >> "$LOG"
        setsid -f cloudflared tunnel --url http://localhost:3000 --no-autoupdate >> "$LOG" 2>&1 < /dev/null
        sleep 12
        URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$LOG" | tail -1)
        if [ -n "$URL" ]; then
            echo "$URL" > "$URL_FILE"
            echo "[$(date)] Nova URL: $URL" >> "$LOG"
        fi
    fi
    sleep 30
done
