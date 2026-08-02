#!/bin/bash
# Tunnel persistente - Melhora App Live
# Mantém o túnel SSH ativo 24/7

TUNNEL_LOG="/tmp/melhora-tunnel.log"
SSH_OPTIONS="-o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=3"

while true; do
    echo "[$(date)] Iniciando túnel..." >> $TUNNEL_LOG
    ssh $SSH_OPTIONS -R 80:localhost:3000 serveo.net 2>&1 | while read line; do
        echo "$(date) - $line" >> $TUNNEL_LOG
        if [[ "$line" == *"Forwarding HTTP"* ]]; then
            URL=$(echo "$line" | grep -oP 'https://\S+')
            echo "URL_PUBLICA=$URL" >> $TUNNEL_LOG
        fi
    done
    echo "[$(date)] Túnel caiu. Reiniciando em 3 segundos..." >> $TUNNEL_LOG
    sleep 3
done
