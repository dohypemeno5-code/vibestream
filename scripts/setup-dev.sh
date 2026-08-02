#!/bin/bash
# ============================================================
# SETUP DE DESENVOLVIMENTO - MELHORA APP LIVE
# ============================================================

set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

echo "🔥 Configurando ambiente de desenvolvimento..."

# Instala dependências
cd backend
npm install

# Cria .env se não existir
if [ ! -f ../.env ]; then
    cp ../.env.example ../.env
    echo "✅ .env criado a partir do exemplo"
fi

# Cria diretórios
mkdir -p uploads .data

echo ""
echo "========================================"
echo "✅ Ambiente pronto!"
echo ""
echo "Para iniciar o servidor:"
echo "  cd backend && node server.js"
echo ""
echo "Para acessar:"
echo "  Site: http://localhost:3000"
echo "========================================"
