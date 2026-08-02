# ⚡ Strike Arena 2D

Jogo de tiro **2D original** para Android (minSdk 24 / targetSdk 35 — otimizado para Android 13, 14 e 15), 100% em português, sem copiar Free Fire ou Roblox. Todo o conteúdo (arte vetorial desenhada em tempo real, sons sintetizados e código) é original.

📦 **APK pronto:** [`StrikeArena-v1.0.apk`](StrikeArena-v1.0.apk) (assinado, ~790 KB)

---

## 🎮 Funcionalidades

- **Menu inicial** com cartão do jogador (nome, nível, XP, moedas)
- **Login opcional + sistema de contas**: registro/login com senha (hash SHA-256 + salt), persistido em SQLite local
- **Personagem controlável** com skins equipadas
- **Joystick virtual** de movimento + **joystick de mira** + mira automática opcional
- **Tiros, recarga, troca de arma, dash** e barra de vida
- **5 armas**: Pistola, Fuzil, Submetralhadora, Espingarda e Sniper
- **3 mapas 2D** com paredes, obstáculos e itens (vida e munição)
- **Bots inteligentes**: patrulham, perseguem, atiram em rajadas, recuam com HP baixo e recarregam
- **Partidas offline**: Time Deathmatch (4x4 vs bots), Todos Contra Todos e Sobrevivência por ondas
- **Partidas online (LAN)**: um aparelho cria a sala e outros entram pelo mesmo Wi-Fi (host autoritativo, descoberta UDP + TCP, até 8 jogadores)
- **Ranking local**, **XP**, **moedas** (recompensas por abate, vitória e ondas)
- **Loja de skins** (8 skins, compra com moedas por conta)
- **Configurações**: som, música ambiente, sensibilidade, tamanho do joystick, qualidade gráfica (baixa/média/alta), FPS, mira automática
- **Efeitos sonoros** e música ambiente gerados sinteticamente (sem copyright)

## 🕹 Controles

- **Lado esquerdo da tela**: joystick de movimento
- **Lado direito da tela**: joystick de mira (arraste)
- **FOGO** (segure; armas automáticas atiram continuamente), **REC**, **DASH**, **ARMA** (troca)
- Pause no canto superior direito

## 📱 Instalação

```bash
adb install StrikeArena-v1.0.apk
```
ou copie o APK para o celular e instale (permita "instalar apps desconhecidos").

## 🔨 Compilação

O projeto inclui Gradle/Android Studio, **mas neste ambiente ARM64 o `aapt2` oficial não executa** (o SDK local contém um wrapper Python que gera APKs inválidos). Por isso o build canônico usa um script que produz um APK válido com ferramentas ARM64:

```bash
# Requisitos (neste ambiente já instalados):
sudo apt-get install -y aapt zipalign   # binários ARM64 reais
# SDK em /opt/android-sdk com platforms/android-34 e build-tools/35.0.0

./build_apk.sh
# → StrikeArena-v1.0.apk (assinado com /tmp/melhora.keystore)
```

Em uma máquina x86_64 com Android Studio, o build padrão também funciona:

```bash
export ANDROID_HOME=/caminho/do/sdk
./gradlew :app:assembleRelease
```

Os assets de áudio podem ser regenerados com `python3 tools/generate_assets.py`.

## ✅ Validação

- `apksigner verify` → **Verifies** (esquemas v2 e v3)
- `aapt dump badging` → pacote `com.strikearena.game`, minSdk 24, targetSdk 35, activity inicial `MainActivity`
- Motor validado por simulação headless (TDM/FFA/Sobrevivência/LAN) — todos os testes passam

## ⚠️ Limitações (informadas claramente)

1. **Multijogador online via internet não está disponível neste APK.** As partidas online funcionam em **LAN (mesmo Wi-Fi)** com servidor local no aparelho do anfitrião. Jogar entre redes diferentes exigiria um servidor dedicado com matchmaking (não incluído).
2. **Contas, ranking e moedas são locais** (SQLite no aparelho). Não há sincronização em nuvem entre aparelhos.
3. **Sem emulador disponível neste ambiente**, o APK foi validado por assinatura, badging e simulação da engine, não por instalação em dispositivo real.
4. Algumas redes Wi-Fi bloqueiam pacotes de descoberta UDP; nesse caso use **"Entrar por IP"** com o IP mostrado no host.
5. O build via Gradle requer um `aapt2` real (Android Studio/x86_64); em ARM64 use `./build_apk.sh`.

## 📁 Estrutura

```
strike-arena/
├── app/src/main/
│   ├── AndroidManifest.xml
│   ├── java/com/strikearena/game/
│   │   ├── core/     # engine (Game, PlayerEnt, BotBrain, armas, mapas, skins)
│   │   ├── net/      # LAN (LanHost, LanClient, protocolo)
│   │   ├── data/     # contas SQLite, preferências
│   │   ├── audio/    # SoundPool + sons sintetizados
│   │   └── ui/       # telas + GameView (renderização/touch)
│   └── res/          # temas, drawables, sons, ícones
├── tools/generate_assets.py
├── build_apk.sh      # build ARM64 → APK válido
└── StrikeArena-v1.0.apk
```
