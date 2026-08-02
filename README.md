# 🔥 Melhora App Live

**Plataforma de Live Streaming Real - Estilo Kwai + Jogo VibeStrike 2D**

🌐 **Link Público:** [https://dohypemeno5-code.github.io/vibestream](https://dohypemeno5-code.github.io/vibestream)

> URL do tunnel muda se o cloudflared reiniciar — sempre atualizada em `/tmp/vibestream-url.txt`.

---

## 📱 Download dos APKs (válidos e assinados)

| APK | Caminho | Descrição |
|-----|---------|-----------|
| **VibeStream 2.0** (app social) | `frontend/apk/vibestream.apk` | WebView do site (Feed, Lives, Chat, Perfil) |
| **VibeStrike 3D 1.5.0** (jogo) | `frontend/apk/vibestrike.apk` | Tiro 3D LOW-POLY (GLES 2.0): Polícia vs Rivais, comunidade urbana, bases, colete, bots, treino e LAN |

Página de download pública: `/download.html` no link acima.

### ✅ Por que agora o APK instala (sem "problema ao analisar o pacote")
- Os APKs são gerados com o **aapt oficial** (não mais manifestos binários montados à mão) → `AndroidManifest.xml` e `resources.arsc` válidos.
- Assinatura **v1 + v2 + v3** com `apksigner`.
- `minSdk 24`, `targetSdk 35` — compatível Android 7.0 até Android 15.

### 🔧 Build local (pipeline manual, sem Gradle/aapt2)
```bash
# Jogo (Polícia vs Rivais)
cd strike-arena && bash build_apk.sh        # gera frontend/apk/vibestrike.apk

# App social (WebView)
bash /tmp/build-vibestream-aapt.sh          # gera frontend/apk/vibestream.apk
```

---

## 🚀 Funcionalidades

- **🔴 Lives em Tempo Real** - Transmissão ao vivo com chat e notificação aos seguidores
- **👥 Usuários & Seguidores** - Perfil com ID único `VS#000001`, busca por nome ou ID, seguir/deixar de seguir com contadores em tempo real e notificações
- **💬 Mensagens Privadas** - Só libera conversa se houver relação de seguir ("Siga primeiro para poder conversar"); texto, foto, vídeo e áudio, com anti-spam e denúncia de conversa
- **📸 Publicações** - Foto, vídeo ou texto; tela obrigatória de regras antes de postar; curtir, comentar, compartilhar e salvar
- **🤖 Moderação Automática** - Posts passam por aprovado/revisão/bloqueado antes do feed; rescan de posts antigos no boot
- **🚫 Banimento + Recurso** - Tela de conta banida com motivo e botão "Enviar recurso"; admin analisa e reativa ou nega
- **👨‍👩‍👧‍👦 Famílias** - Sistema de clans estilo Kwai
- **🏆 Ranking** - Rankings de diamantes, seguidores e famílias
- **🎁 Presentes Virtuais** - 10 tipos de presentes
- **📢 Denúncias via Ticket** - Reporte conteúdo e usuários
- **👑 Admin Escondido** - Painel em rota secreta (usuários, conteúdo, recursos, denúncias, tickets, logs)
- **🛡️ Anti-DDoS + Firewall** - Proteção contra ataques
- **🔐 Verificação de idade** - Menores de 15 anos bloqueados; 15-17 acesso restrito
- **📧 Suporte** - `suportevibestream@gmail.com`
- **📱 PWA** - Instalável como app no celular

---

## 🔐 Acesso Admin

```
Admin (REAL e escondido): https://dohypemeno5-code.github.io/vibestream/admin-vsadm_bbcfb56ec52ae932e6
Usuário: admin
Senha: Melhora@2024!SecureAdmin
Secret (header): vsadm_bbcfb56ec52ae932e6
```

- **admin** → painel completo (usuários, conteúdo, saques PIX, agências, alertas, logs, denúncias, tickets)
- **moderator** → acesso de moderação (ferramentas só-de-admin ficam escondidas e bloqueadas na API)
- Usuários comuns recebem `403` mesmo conhecendo a rota/secret.
- Abrindo a URL do painel sem login: aparece a **tela de login do próprio painel** (não redireciona mais para a home) — é só entrar com admin/senha ali mesmo.

⚠️ **Mantenha a URL admin e o secret em segredo!**

### 🎭 Painel falso (isca anti-invasor)

- `/admin`, `/admin/login`, `/administrador`, `/painel`, `/painel-admin` e qualquer `/admin-*` que **não seja** a rota real servem uma **tela de login FALSA** — parece um painel, mas nunca autentica.
- A rota antiga (`/admin-admin_melhora_...`) foi desativada: agora também serve a isca.
- Qualquer tentativa de login no painel falso é registrada em `security_logs` (`decoy_login*`), gera alerta crítico **painel_falso** no painel real e, após **2 tentativas no mesmo IP em 10 min**, o IP é bloqueado no firewall.
- O painel verdadeiro fica **apenas** na rota secreta acima.

⚠️ **Mantenha a URL admin e o secret em segredo!**

---

## 🔓 Whitelist do dono (nunca fica bloqueado)

- O firewall NUNCA bloqueia os IPs do dono, mesmo com tentativas repetidas no painel falso.
- Configurado em `FIREWALL_WHITELIST` no `.env` (IPs ou subnets, ex.: `2804:d41:c2d9:a500::/64`).
- IPv6 rotativo (Vivo) coberto pela whitelist do bloco `/64`; IPs de estranhos continuam sendo bloqueados após 2 tentativas no painel falso.
- Para ver/limpar bloqueios atuais: `backend/.blocked.json` (editar e reiniciar o servidor).

## 🛡️ Segurança (auditoria aplicada)

- ✅ **Autenticação por token persistente** (`auth_tokens`): token de 256 bits com hash SHA-256 no banco, expira em 7 dias, renovação deslizante, suporte a `Authorization: Bearer` ou cookie `vs_token` — **sobrevive a reinícios do servidor** (sessões não caem mais)
- ✅ Registro já autentica o usuário; logout revoga o token no banco
- ✅ Todas as rotas protegidas retornam `401` sem login; admin/moderator verificados no servidor (role vinda do banco, nunca do app)
- ✅ Painel admin protegido: rota secreta + role admin/moderator + secret header sem elevação de usuário comum
- ✅ Rate limit corrigido (janela de tempo funcionando): login 5/5min por IP+usuário, posts 6/min, comentários 15/min, lives 6/h, busca 30/min, mensagens 6/10s, mídia 30/h, tickets 5/h
- ✅ Anti-spam no chat e comentários (limite de envio rápido + termos bloqueados)
- ✅ Sanitização central de todas as entradas (XSS/SQLi), avatar/media com MIME e tamanho validados
- ✅ CORS público com reflexo de Origin + credentials (navegadores rejeitam `*` com credentials, então o Origin real é refletido)
- ✅ Cookies HttpOnly + SameSite=Lax + Secure automático em HTTPS
- ✅ Firewall interno (bloqueio de IPs suspeitos) + alertas críticos no painel
- ✅ Logs de segurança (login, erros, ações administrativas) + monitoramento de login suspeito
- ✅ Erros de API genéricos — nunca vaza stack/trace internos
- ✅ Banco SQLite escondido e criptografado (`backend/.data/.cache_storage.db`)
- ✅ Backup automático do banco (boot + a cada 6h em `backups/auto/`)

## 🛠️ Painel admin (correção do erro "resposta não é JSON")

- Causa raiz: o painel carregava `admin.js`/`admin.css` por caminho relativo e o servidor respondia com o HTML do app (SPA fallback, 200) em vez do JS.
- Corrigido: os assets do painel agora são servidos na rota secreta com MIME correto (`application/javascript` / `text/css`) e `Cache-Control: no-store`.
- Todas as abas do painel (`dashboard`, `users`, `tickets`, `lives`, `families`, `security-logs`, `posts`, `reports`, `moderation-logs`, `appeals`, `chat-reports`, `withdrawals`, `agencies`, `alerts`) retornam `application/json` — validadas via túnel público.
- Frontend do painel valida `content-type` antes de `json()`, com timeout de 20s e tratamento de erro em todas as abas.
- URL base unificada: site e API na mesma origem (túnel único); override opcional via `?api=` ou `window.__VITE_API_URL`.

## 🤖 Moderação automática (AnyClaw) — 24h

- **Motor de moderação** em `backend/moderation.js`: análise de texto em 4 níveis (bloqueio total → discurso de ódio → apologia a crimes → revisão manual), com padrões de ameaça, violência, racismo, homofobia, xenofobia e impersonação.
- **Punição progressiva**: 1º aviso → 2º remoção de conteúdo → 3º suspensão 72h → 4º banimento. Tudo registrado em `moderation_logs` + notificação ao usuário + alerta de segurança.
- **Posts**: texto e mídia analisados antes de publicar; bloqueados recebem `403 POST_BLOCKED` com motivo; suspeitos vão para revisão (`content_reviews`).
- **Mídia**: hash SHA-256 de cada upload (`media_hashes`) — reenvio de mídia já bloqueada é recusado automaticamente.
- **Comentários**: suporte a respostas (`parentId`) e menções (`@usuario` com notificação); texto moderado igual aos posts.
- **Cadastro**: nomes de impersonação (`admin`, `hacker`, `suporte`, `oficial`, etc.) bloqueados na hora, com log em `security_logs`.
- **Denúncias**: `POST /api/reports/create` resolve username/profile_id/UUID para o ID real do usuário; o painel admin tem abas **🛡️ Denúncias** (confirmar/rejeitar/analisar + punição) e **📜 Histórico de Moderação**.
- **Rotas admin novas**: `GET {ADMIN}/api/reports`, `POST {ADMIN}/api/reports/:id/review`, `GET {ADMIN}/api/moderation-logs` — todas `application/json`.

## 🎬 Boas-vindas (IA/animação personalizada)

- Novo usuário autenticado recebe tela de boas-vindas animada com **nome personalizado**, identidade VibeStream e botão "Pular"
- Salva no banco (`welcome_seen`) para não repetir; funciona em web e Android (WebView)
- Endpoints: `GET /api/welcome` e `POST /api/welcome/seen`
- Tela "Conectando pessoas" corrigida: nunca fica infinita — timeout de 20s na API, banner de "Sem conexão" com botão de tentar novamente e abertura automática da tela principal

## 💰 Criadores, Agência e PIX

- **Agência de criadores**: criar agência (código `AG-XXXXXX`), convidar/aceitar/recusar convites, remover membros, comissão e estatísticas
- **Carteira**: saldo de ganhos por visualização (`R$ 0,001/view`) e curtida (`R$ 0,01/like`)
- **Saque PIX**: chave PIX com verificação; até R$ 50 aprovado automaticamente, acima disso exige aprovação do admin no painel
- **Campanhas**: usuário entra em campanhas e ganha recompensa ao atingir visualizações

## 🪙 K Golds — Carteira estilo Kwai / Poppo Live

- **Carteira/Ganhar dinheiro** (`/` → botão 💰 no topo): saldo R$, K Golds e Diamantes; bolhas de tarefas (306 veja o vídeo, 475 check-in, 50 e 30 bônus diário), card "Tarefa limitada por tempo" (R$ 15), Desafio 1 bilhão com baú (+100) e roleta (10–200), ranking por hora e loja de presentes.
- **Assistindo vídeos**: +306 K Golds por minuto no Feed/Lives (máx. 60 min/dia) via `POST /api/economy/watch`.
- **Check-in diário**: +475 K Golds via `POST /api/economy/checkin` (uma vez por dia).
- **Bônus diários**: `POST /api/economy/bonus` (`bonus50`, `bonus30`, `bau`, `roleta`) — uma vez por dia cada.
- **Conversão**: `POST /api/economy/convert` — 10.000 K Golds = R$ 1,00 na carteira.
- **Saque PIX**: `POST /api/wallet/withdraw` — mínimo agora **R$ 1,00** (antes R$ 5).
- **Ranking por Hora**: `GET /api/economy/ranking` — quem recebe mais presentes na última hora fica no topo.
- **Notificações**: popup "Ative as notificações" + recompensa única de 1.500 K Golds (`POST /api/economy/notif-reward`).
- **Live de Áudio (estilo Poppo)**: sala com host gigante, onda de voz animada, slots de convidados, chat ao vivo, presentes, curtidas e microfone do anfitrião.
- **Perfil (estilo Kwai)**: avatar com borda diamante, selo Ouro, seguidores/seguindo/curtidas formatados (1,8 mil), signo, botões Central do Criador/Loja/Player, grade de vídeos com views e cards "Complete seu perfil 6/7" (vincular celular R$ 15, definir nome de usuário).
- **Design system**: tema #0A0A0F, gradiente #7C3AED→#06B6D4, K Golds #FFC700, fonte Poppins (valores R$), cards 20px com sombra suave.
- Todas as novas rotas de economia retornam **JSON puro** `{success:true, data:{...}}` (nunca HTML).

## 💎 Economia virtual (Presentes, Moedas, VIP e Recargas)

- **Presentes**: loja (`GET /api/gifts`) com categorias (normal, animado, VIP, premium, lendário); envio em lives via `POST /api/gifts/send` com débito/crédito de moedas no servidor, animação na tela e histórico em `GET /api/gifts/history`
- **Carteira**: moedas, diamantes e saldo R$ em `GET /api/economy/me`; todas as movimentações registradas em `wallet_transactions` (nunca altera saldo pelo app sem autorização do servidor)
- **VIP**: planos Bronze/Prata/Ouro em `GET /api/vip/plans`, ativação via `POST /api/vip/activate` (campos `vip_tier`/`vip_until` no usuário, selo no perfil)
- **Recargas**: pacotes em `GET /api/recharge/packages`; pedido PIX em `POST /api/recharge/create` e confirmação pelo admin em `POST /api/recharge-orders/:id/confirm` (com proteção anti-duplicação `ALREADY_PROCESSED` e histórico em `GET /api/recharge/history`)
- **Admin**: aba **💰 Economia** no painel real (presentes + criar/ativar/desativar, pedidos de recarga, usuários VIP, movimentações da carteira e presentes enviados)

## 👥 Famílias + Agências (estilo Poppo Live)

- **Famílias (livre — qualquer um cria)**: `POST /api/familias/criar` (nome + TAG de 3–5 letras única, ex: `[TDA]`), ranking por `totalGolds` em `GET /api/familias`, detalhe com membros em `GET /api/familias/:id`, entrar/sair (`POST /api/familias/:id/entrar` e `/sair`) e edição só pelo dono (`PUT /api/familias/:id`). Ao entrar/criar, a TAG aparece no nome do perfil: `[TDA] Nome`.
- **Agências (exigem aprovação do admin)**: `POST /api/agencias/solicitar` cria com status `pendente`; `GET /api/agencias` lista só aprovadas; `GET /api/agencias/minha` mostra a do usuário; `GET /api/agencias/pendentes`, `PUT /api/agencias/:id/aprovar` e `PUT /api/agencias/:id/reprovar` são **só admin**; `DELETE /api/agencias/:id` para dono/admin.
- **Páginas**: `/familia` (ranking + entrar), `/familia/criar` (form com preview da TAG e upload de logo), `/agencia` (aprovadas) e `/agencia/criar` (form com aviso "analisada em até 24h" e status Pendente ⏳).
- **Live de Áudio com família**: TAG do host no topo da sala, membros da família na lateral com botão + para convidar e botão PK (batalha de famílias).
- **Tarefas e dinheiro (estilo Kwai)**: `GET /api/carteira/saldo` (reais, golds, diamantes), `POST /api/tarefas/checkin` (+475 golds, streak 7 dias = R$ 15), `POST /api/tarefas/ver-video` (+306), `POST /api/tarefas/bonus-diario` (+50), `GET /api/ranking/hora` (presentes da última hora), `POST /api/presentes/enviar`, `GET /api/roleta/girar` (10–200) e `POST /api/bau/abrir` (a cada 30 min, +100).
- **Painel Admin → Aba 🏢 Agências**: tabela Logo | Nome | TAG | Dono | WhatsApp | Data | Status | Ações com **Aprovar** (verde) e **Reprovar** (vermelho, com motivo); pendentes aparecem primeiro.
- **Seeds (banco vazio)**: família `TROPA DO A [TDA]` e agência `Ferrari OFC [FR]` (aprovada), dono = primeiro admin.
- Todas as rotas seguem a regra de ouro: `res.setHeader('Content-Type','application/json')` + `res.json({success:true, data})` — **nunca HTML/texto**; 404 de `/api/*` também retorna JSON.

## 🤖 Moderação automática (AnyClaw) + Visitas + Feed TikTok

- **`POST /api/moderation/check`** — recebe `{tipo: foto|video|legenda, url, texto}` e retorna `{aprovado, motivo}`:
  - **Regra 1 — Política (BAN PERMANENTE)**: conteúdo com Bolsonaro/Lula/PT/eleição/22/13/político → ban permanente automático com mensagem "Sua conta foi banida permanentemente por violar regra 1: Proibido conteúdo político (Bolsonaro/Lula). Contate suporte." — cria registro em `bans` (com `prova_url`), seta `users.status='banned'` e bloqueia o login.
  - **Ameaças**: "vou te matar", "vou te pegar", "vou te bater", "te arrebento", "vou atrás de você", "te mato" → remove o vídeo na hora + **strike** (tabela `strikes`); **3 strikes = ban permanente**.
  - Palavras políticas: `bolsonaro, lula, pt 13, mito 22, comunista, fascista, eleição roubada, lula ladrão, bolsonaro genocida`.
- **Notificações** (`GET /api/notifications` + `POST /api/notifications/read`): visita 👁️, curtida ❤️, família 👥, agência 🏢, ban 🚫, moderação ⚠️ — badge vermelho de não lidas no sino.
- **Visitas de perfil**: tabela `profile_visits`; cada `GET /api/profile/:id` registra visita (sem duplicar se < 1h) e notifica o dono; `GET /api/profile/visitantes` lista as últimas 50 com avatar, nome, TAG e hora; perfil mostra "👁️ N visitas no perfil".
- **Feed TikTok**: rolagem vertical com snap (cada post = 100% da tela), swipe up/down, autoplay de vídeo, `IntersectionObserver` marca view quando 80% visível (+306 K Golds com toast 🪙), preload da próxima página, botões à direita (perfil, like, comentar, compartilhar, salvar) e TAG da família no post.
- **Ao publicar**: o app chama `POST /api/moderation/check` antes do post; se político → modal vermelho "BAN PERMANENTE — Conteúdo político proibido" e encerra a sessão; se ameaça → modal de remoção com contagem de strikes.
- Seeds de famílias: **TROPA DO A [TDA]**, **FERRARI OFC [FR]**, **ELITE [ELT]** (idempotente, dono = admin).

## 🎬 Página promocional (anúncio)

- URL: `/promocao` (ou `/anuncio`) — landing premium VibeStream "Assista, acumule pontos e troque por recompensas" com mockup de celular (novela, pontos, carteira e saque), como-funciona, tarefas/pontos, FAQ e aviso de regras de saque.
- Sem promessa de ganhos garantidos: página e FAQ deixam claro que recompensas dependem de atividade e das regras do programa.
- Download direto do APK em `/apk/vibestream.apk`.

## 🚀 Splash "Conectando pessoas" (corrigido)

- Tela inicial com progresso (`#splashStatus`), mensagem de erro clara e botão **Tentar novamente** (`retryBoot()`).
- Timeout de 8s na checagem de sessão + força de liberação em 10s — nunca fica em carregamento infinito.
- Página admin com `Cache-Control: no-store` para evitar erro de painel por cache antigo do navegador.

## 👥 Sistema de permissões

- `role = admin` → painel completo
- `role = moderator` → só moderação de conteúdo (denúncias, posts, lives, tickets)
- `role = user` → acesso negado à área administrativa (mesmo com o secret do header)

---

## 📊 Estrutura do Projeto

```
melhora-app-live-real-igual-kwai/
├── backend/           # Servidor Node.js + API
├── frontend/          # App web estilo Kwai
│   ├── index.html     # Página principal
│   ├── style.css      # Design dark moderno
│   ├── app.js         # Lógica completa
│   ├── pwa/           # Manifest + Service Worker
│   └── icons/         # Ícones do PWA
├── android/           # Projeto Android APK
│   ├── app/
│   │   └── src/main/  # Código fonte Java
│   ├── build_apk.sh   # Script de build
│   └── gradlew        # Gradle wrapper
├── nginx/             # Config com anti-DDoS
├── scripts/           # Deploy e setup
└── README.md
```

---

## 📱 Play Store / Lojas oficiais (preparação)

- **Download direto de APK removido das páginas públicas** — botões trocados por "Disponível em breve na Google Play" (o APK continua em `frontend/apk/` para envio à AppGallery e Amazon Appstore, mas não é linkado no site).
- **Páginas legais**: `/privacy` (Política de Privacidade — LGPD), `/terms` (Termos de Uso), `/contact` (Contato) e `/delete-account` (exclusão de conta funcional via `POST /api/account/delete`, com confirmação de senha).
- **Rodapé** na página inicial com os 4 links legais + selos de lojas.
- **Headers de segurança** em todas as respostas: `X-Content-Type-Options: nosniff`, `Content-Security-Policy`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- **CORS restrito por allowlist** (variável `ALLOWED_ORIGINS` no `.env`) — origens fora da lista são bloqueadas.
- Todas as rotas `/api/*` retornam somente `application/json` (404 de API também é JSON).

## 🌐 Domínio próprio (vibestream.com.br)

Sobre o deploy no GitHub Pages:
1. Compre o domínio em um registrador (ex.: registro.br, Hostinger, GoDaddy).
2. Crie um registro DNS **A** apontando `vibestream.com.br` (e `www`) para o IP do servidor onde o Node roda (porta 80/443).
3. Instale HTTPS: aponte um túnel Cloudflare **named tunnel** para o domínio, ou use Caddy/Nginx com Let's Encrypt na frente do `localhost:3000`.
4. Adicione `https://vibestream.com.br,https://www.vibestream.com.br` em `ALLOWED_ORIGINS` no `.env` (já estão incluídos) e reinicie.
5. Atualize o `PUBLIC_URL`/links externos e o `manifest.json` (scope/start_url) para o domínio final.

⚠️ O frontend está publicado no GitHub Pages. O backend (API) precisa de um servidor público (túnel/VPS) para Feed, Chat e Lives funcionarem.

## 🚀 Deploy em Produção

```bash
sudo ./scripts/deploy.sh
```

---

**🔥 Melhora App Live - Vivendo o melhor momento!**


---

## 🎮 Jogo novo: Strike Arena 2D

O repositório também contém **`strike-arena/`** — um jogo de tiro 2D completo para Android (APK válido e assinado em `strike-arena/StrikeArena-v1.0.apk`), com menu, contas locais, bots, modos offline e partidas online via LAN. Veja `strike-arena/README.md`.
