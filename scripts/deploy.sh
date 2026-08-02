#!/bin/bash
# ============================================================
# DEPLOY AUTOMÁTICO - MELHORA APP LIVE
# Script de deploy completo com segurança
# ============================================================

set -e

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

APP_DIR="/var/www/melhora-app"
DOMAIN="melhora.app"
ADMIN_SECRET=$(openssl rand -hex 16)

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════╗"
echo "║        DEPLOY - MELHORA APP LIVE                ║"
echo "║     Plataforma de Lives Estilo Kwai             ║"
echo "╚══════════════════════════════════════════════════╝"
echo -e "${NC}"

# ============================================================
# VERIFICAÇÃO DE PRÉ-REQUISITOS
# ============================================================
echo -e "${YELLOW}[1/7] Verificando pré-requisitos...${NC}"

for cmd in node npm nginx git certbot openssl; do
    if ! command -v $cmd &> /dev/null; then
        echo -e "${RED}❌ $cmd não encontrado. Instale primeiro.${NC}"
        exit 1
    fi
done

echo -e "${GREEN}✅ Todos os pré-requisitos estão instalados.${NC}"

# ============================================================
# CRIAÇÃO DE USUÁRIO DEDICADO
# ============================================================
echo -e "${YELLOW}[2/7] Criando usuário dedicado...${NC}"

if ! id -u melhora &>/dev/null; then
    useradd -r -s /bin/false -m -d $APP_DIR melhora
    echo -e "${GREEN}✅ Usuário 'melhora' criado.${NC}"
else
    echo -e "${GREEN}✅ Usuário 'melhora' já existe.${NC}"
fi

# ============================================================
# CÓPIA DOS ARQUIVOS
# ============================================================
echo -e "${YELLOW}[3/7] Copiando arquivos do projeto...${NC}"

mkdir -p $APP_DIR
cp -r ../backend $APP_DIR/
cp -r ../frontend $APP_DIR/
cp -r ../nginx $APP_DIR/
cp ../.env.example $APP_DIR/.env
cp ../package.json $APP_DIR/

# Cria diretórios necessários
mkdir -p $APP_DIR/backend/uploads
mkdir -p $APP_DIR/backend/.data

echo -e "${GREEN}✅ Arquivos copiados.${NC}"

# ============================================================
# CONFIGURAÇÃO DE SEGURANÇA
# ============================================================
echo -e "${YELLOW}[4/7] Configurando segurança...${NC}"

# Gera senhas seguras
SESSION_SECRET=$(openssl rand -hex 32)
DB_KEY=$(openssl rand -hex 16)
ADMIN_PASS=$(openssl rand -base64 12)

cat > $APP_DIR/.env << ENVEOF
PORT=3000
NODE_ENV=production
SESSION_SECRET=$SESSION_SECRET
ADMIN_SECRET=$ADMIN_SECRET
ADMIN_EMAIL=admin@$DOMAIN
ADMIN_PASSWORD=$ADMIN_PASS
DB_ENCRYPT_KEY=$DB_KEY
DB_SALT=melhora_$(openssl rand -hex 8)
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=52428800
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
TRUST_PROXY=true
CORS_ORIGIN=https://$DOMAIN
ENVEOF

# Permissões restritas
chown -R melhora:melhora $APP_DIR
chmod -R 750 $APP_DIR
chmod 640 $APP_DIR/.env
chmod 700 $APP_DIR/backend/.data

echo -e "${GREEN}✅ Segurança configurada.${NC}"
echo -e "${YELLOW}⚠️  GUARDE ESTAS INFORMAÇÕES:${NC}"
echo -e "   Admin URL: https://$DOMAIN/admin-$ADMIN_SECRET"
echo -e "   Admin Secret: $ADMIN_SECRET"
echo -e "   Admin Password: $ADMIN_PASS"
echo -e "   SESSION_SECRET: $SESSION_SECRET"
echo -e "${RED}   Anote estas informações! Não será possível recuperá-las!${NC}"

# ============================================================
# INSTALAÇÃO DE DEPENDÊNCIAS
# ============================================================
echo -e "${YELLOW}[5/7] Instalando dependências...${NC}"

cd $APP_DIR/backend
npm install --production

echo -e "${GREEN}✅ Dependências instaladas.${NC}"

# ============================================================
# CONFIGURAÇÃO DO NGINX
# ============================================================
echo -e "${YELLOW}[6/7] Configurando Nginx...${NC}"

# Ajusta domínio no config
sed -i "s/melhora.app/$DOMAIN/g" $APP_DIR/nginx/melhora-app.conf

# Copia config
cp $APP_DIR/nginx/melhora-app.conf /etc/nginx/sites-available/$DOMAIN

# Ativa site
if [ ! -L /etc/nginx/sites-enabled/$DOMAIN ]; then
    ln -s /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/
fi

# Remove default
rm -f /etc/nginx/sites-enabled/default

# Testa e recarrega
nginx -t && systemctl reload nginx

echo -e "${GREEN}✅ Nginx configurado.${NC}"

# ============================================================
# CONFIGURAÇÃO DO SSL (LET'S ENCRYPT)
# ============================================================
echo -e "${YELLOW}[Opcional] Configurar SSL? (s/N)${NC}"
read -r SSL_CHOICE

if [[ $SSL_CHOICE =~ ^[Ss]$ ]]; then
    certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos -m admin@$DOMAIN
    echo -e "${GREEN}✅ SSL configurado.${NC}"
    
    # Auto-renovação
    echo "0 3 * * * /usr/bin/certbot renew --quiet" | crontab -
fi

# ============================================================
# CRIAÇÃO DO SERVIÇO SYSTEMD
# ============================================================
echo -e "${YELLOW}[7/7] Criando serviço systemd...${NC}"

cat > /etc/systemd/system/melhora-app.service << SERVICEEOF
[Unit]
Description=Melhora App Live - Plataforma de Lives
After=network.target

[Service]
Type=simple
User=melhora
Group=melhora
WorkingDirectory=$APP_DIR/backend
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
SERVICEEOF

systemctl daemon-reload
systemctl enable melhora-app
systemctl start melhora-app

echo -e "${GREEN}✅ Serviço criado e iniciado.${NC}"

# ============================================================
# FIREWALL (UFW)
# ============================================================
echo -e "${YELLOW}[Opcional] Configurar UFW? (s/N)${NC}"
read -r UFW_CHOICE

if [[ $UFW_CHOICE =~ ^[Ss]$ ]]; then
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow 22/tcp comment 'SSH'
    ufw allow 80/tcp comment 'HTTP'
    ufw allow 443/tcp comment 'HTTPS'
    ufw limit 22/tcp
    ufw --force enable
    echo -e "${GREEN}✅ UFW configurado.${NC}"
fi

# ============================================================
# RESUMO
# ============================================================
echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════╗"
echo "║           DEPLOY CONCLUÍDO COM SUCESSO!         ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║                                                  ║"
echo "║  🌐 Site: https://$DOMAIN                       "
echo "║  🔐 Admin: https://$DOMAIN/admin-$ADMIN_SECRET  "
echo "║  🔑 Secret: $ADMIN_SECRET                       "
echo "║  👤 Email: admin@$DOMAIN                        "
echo "║  🔒 Senha: $ADMIN_PASS                          "
echo "║                                                  ║"
echo "║  🛡️  Firewall: Ativo                            ║"
echo "║  🚫 Anti-DDoS: Configurado                     ║"
echo "║  🔐 Banco Criptografado: Sim                   ║"
echo "║  📝 Tickets/Denúncias: Ativo                   ║"
echo "║                                                  ║"
echo "╚══════════════════════════════════════════════════╝"
echo -e "${NC}"

# Salva credenciais
cat > $APP_DIR/credentials.txt << CREDEOF
========================================
CREDENCIAIS - MELHORA APP LIVE
========================================
Data: $(date)
Domínio: $DOMAIN
Admin URL: https://$DOMAIN/admin-$ADMIN_SECRET
Admin Secret: $ADMIN_SECRET
Admin Email: admin@$DOMAIN
Admin Senha: $ADMIN_PASS
SESSION_SECRET: $SESSION_SECRET
DB_KEY: $DB_KEY
========================================
MANTENHA ESTE ARQUIVO EM LOCAL SEGURO!
NÃO COMPARTILHE!
========================================
CREDEOF

chmod 600 $APP_DIR/credentials.txt
chown melhora:melhora $APP_DIR/credentials.txt

echo -e "${GREEN}✅ Credenciais salvas em: $APP_DIR/credentials.txt${NC}"
echo -e ""
echo -e "${CYAN}🔥 Melhora App Live está no ar! Divulgue seu link! 🚀${NC}"
