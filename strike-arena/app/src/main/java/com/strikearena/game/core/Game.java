package com.strikearena.game.core;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Random;

/** Motor do jogo: simulação, colisões, IA, ondas e snapshots de rede. */
public class Game {
    public interface Listener {
        void sfx(String key);
        void onMessage(String msg);
    }

    public static final int MODE_TDM = 0;
    public static final int MODE_FFA = 1;
    public static final int MODE_SURVIVAL = 2;
    public static final int MODE_LAN_TDM = 3;
    public static final int MODE_LAN_FFA = 4;
    public static final int MODE_TRAIN = 5;

    public static final int TDM_TARGET = 20;
    public static final int FFA_TARGET = 15;
    public static final float MATCH_TIME = 300f;

    public static class FeedItem {
        public final String text;
        public final long time;
        public FeedItem(String text, long time) { this.text = text; this.time = time; }
    }

    private static final String[] BOT_NAMES = {"Tatu", "Jaguar", "Onça", "Coruja", "Lobo", "Falcão",
            "Pantera", "Coala", "Texugo", "Águia", "Puma", "Tubarão"};

    public MapDef map;
    public int mode;
    public int difficulty;
    public final boolean clientMode;
    public float aiDiff = 1f;

    public final ArrayList<PlayerEnt> players = new ArrayList<>();
    public final ArrayList<Bullet> bullets = new ArrayList<>();
    public final ArrayList<Pickup> pickups = new ArrayList<>();
    public final ArrayList<Particle> particles = new ArrayList<>();
    public final ArrayList<FloatText> floats = new ArrayList<>();
    public final ArrayList<FeedItem> killFeed = new ArrayList<>();

    public final GameInput input = new GameInput();
    public final HashMap<Integer, GameInput> remoteInputs = new HashMap<>();

    public Listener listener;
    public int localId;
    public float matchTime;
    public int scoreRed, scoreBlue;
    public int wave, lives = 3;
    public boolean waveActive;
    public float waveT;
    public int waveBotsAlive;
    public boolean matchOver;
    public int winTeam = -2;
    public boolean localWon;
    public long xpGain, coinGain;
    public int localKills, localDeaths;
    public boolean aimAssist = true;
    public int gfxQuality = 1;
    public float camShake;

    private final Random rnd = new Random();
    private int nextId;
    private float timeMs;
    private int prevSnapKills;

    public Game(int mode, int mapIndex, int difficulty, String playerName, int skinId, boolean clientMode) {
        this.mode = mode;
        this.map = Maps.ALL[Math.max(0, Math.min(Maps.ALL.length - 1, mapIndex))];
        this.difficulty = Math.max(0, Math.min(2, difficulty));
        this.clientMode = clientMode;
        this.waveT = 3f;
        initPickups();
        if (!clientMode) {
            setupPlayers(playerName, skinId);
        } else {
            PlayerEnt p = new PlayerEnt(nextId++, playerName,
                    mode == MODE_LAN_FFA ? PlayerEnt.TEAM_NONE : PlayerEnt.TEAM_POLICE, skinId, false, true);
            spawnAtFree(p);
            players.add(p);
            localId = p.id;
        }
    }

    // ---------------------------------------------------------------- setup

    private void setupPlayers(String playerName, int skinId) {
        List<String> names = new ArrayList<>(Arrays.asList(BOT_NAMES));
        Collections.shuffle(names, rnd);
        int nameIdx = 0;
        int botsPerTeam = 2 + difficulty; // 2v2, 3v3, 4v4
        int ffaBots = 3 + difficulty * 2;

        if (mode == MODE_TDM) {
            PlayerEnt me = new PlayerEnt(nextId++, playerName, PlayerEnt.TEAM_POLICE, skinId, false, true);
            spawnAt(me, randomSpawn(PlayerEnt.TEAM_POLICE));
            players.add(me); localId = me.id;
            for (int t = 0; t < 2; t++) {
                int team = t == 0 ? PlayerEnt.TEAM_POLICE : PlayerEnt.TEAM_RIVAL;
                int count = t == 0 ? botsPerTeam - 1 : botsPerTeam;
                for (int i = 0; i < count; i++) {
                    PlayerEnt b = new PlayerEnt(nextId++, names.get(nameIdx++ % names.size()), team,
                            rnd.nextInt(Skins.ALL.length), true, false);
                    spawnAt(b, randomSpawn(team));
                    b.weapon = rnd.nextBoolean() ? Weapons.RIFLE : Weapons.SMG;
                    b.aiDiff = difficulty;
                    b.brain = new BotBrain();
                    players.add(b);
                }
            }
        } else if (mode == MODE_TRAIN) {
            PlayerEnt me = new PlayerEnt(nextId++, playerName, PlayerEnt.TEAM_POLICE, skinId, false, true);
            spawnAt(me, randomSpawn(PlayerEnt.TEAM_POLICE));
            me.armor = PlayerEnt.MAX_ARMOR;
            players.add(me); localId = me.id;
            int bots = 2 + difficulty;
            for (int i = 0; i < bots; i++) {
                PlayerEnt b = new PlayerEnt(nextId++, names.get(nameIdx++ % names.size()),
                        PlayerEnt.TEAM_RIVAL, rnd.nextInt(Skins.ALL.length), true, false);
                spawnAt(b, randomSpawn(PlayerEnt.TEAM_RIVAL));
                b.weapon = rnd.nextBoolean() ? Weapons.RIFLE : Weapons.SMG;
                b.aiDiff = difficulty;
                b.brain = new BotBrain();
                players.add(b);
            }
        } else if (mode == MODE_FFA) {
            PlayerEnt me = new PlayerEnt(nextId++, playerName, PlayerEnt.TEAM_NONE, skinId, false, true);
            spawnAt(me, randomSpawn(PlayerEnt.TEAM_NONE));
            players.add(me); localId = me.id;
            for (int i = 0; i < ffaBots; i++) {
                PlayerEnt b = new PlayerEnt(nextId++, names.get(nameIdx++ % names.size()),
                        PlayerEnt.TEAM_NONE, rnd.nextInt(Skins.ALL.length), true, false);
                spawnAt(b, randomSpawn(PlayerEnt.TEAM_NONE));
                b.weapon = rnd.nextBoolean() ? Weapons.RIFLE : Weapons.SMG;
                b.aiDiff = difficulty;
                b.brain = new BotBrain();
                players.add(b);
            }
        } else if (mode == MODE_SURVIVAL) {
            PlayerEnt me = new PlayerEnt(nextId++, playerName, PlayerEnt.TEAM_BLUE, skinId, false, true);
            spawnAt(me, randomSpawn(PlayerEnt.TEAM_BLUE));
            players.add(me); localId = me.id;
        } else {
            // LAN host
            PlayerEnt me = new PlayerEnt(nextId++, playerName, PlayerEnt.TEAM_POLICE, skinId, false, true);
            spawnAt(me, randomSpawn(PlayerEnt.TEAM_POLICE));
            players.add(me); localId = me.id;
        }
    }

    private void initPickups() {
        for (int i = 0; i < map.pickups.length; i += 2) {
            pickups.add(new Pickup(map.pickups[i], map.pickups[i + 1], (i / 2) % 3));
        }
        // coletes centrais garantidos (modo Polícia vs Rivais e Treino)
        if (mode == MODE_TDM || mode == MODE_TRAIN || mode == MODE_LAN_TDM) {
            pickups.add(new Pickup(map.w * 0.5f, map.h * 0.3f, Pickup.ARMOR));
            pickups.add(new Pickup(map.w * 0.5f, map.h * 0.7f, Pickup.ARMOR));
        }
    }

    // ---------------------------------------------------------------- update

    public void update(float dt) {
        timeMs += dt * 1000;
        camShake = Math.max(0f, camShake - dt * 7f);
        updateFx(dt);
        if (matchOver) return;
        matchTime += dt;

        if (!clientMode) {
            if (mode == MODE_SURVIVAL) updateSurvival(dt);
            PlayerEnt me = localPlayer();
            if (me != null && me.alive) updatePlayer(me, input, dt, true);
            for (PlayerEnt p : players) {
                if (p == me || p.leftMatch || !p.alive) continue;
                if (p.isBot && p.brain != null) {
                    p.brain.update(this, p, dt);
                } else if (!p.isBot) {
                    GameInput ri = remoteInputs.get(p.id);
                    if (ri != null) updatePlayer(p, ri, dt, false);
                }
            }
            updateRespawns(dt);
            updateBullets(dt);
            updatePickups(dt);
            updateMatchEnd();
        } else {
            PlayerEnt me = localPlayer();
            if (me != null && me.alive) updatePlayer(me, input, dt, true);
        }
    }

    private void updateSurvival(float dt) {
        if (!waveActive) {
            waveT -= dt;
            if (waveT <= 0) startWave();
        }
    }

    private void startWave() {
        wave++;
        aiDiff = Math.min(2f, difficulty + wave / 6f);
        int count = Math.min(14, 2 + wave * 2);
        waveBotsAlive = count;
        waveActive = true;
        for (int i = 0; i < count; i++) {
            PlayerEnt b = new PlayerEnt(nextId++, BOT_NAMES[rnd.nextInt(BOT_NAMES.length)],
                    PlayerEnt.TEAM_RED, rnd.nextInt(Skins.ALL.length), true, false);
            spawnAt(b, survivalSpawn());
            b.weapon = wave >= 3 ? Weapons.SMG : Weapons.RIFLE;
            b.hp = Math.min(240, 60 + wave * 6);
            b.brain = new BotBrain();
            players.add(b);
        }
        addFeed("Onda " + wave + "!");
        if (listener != null) { listener.sfx("wave"); listener.onMessage("Onda " + wave); }
    }

    private void updatePlayer(PlayerEnt p, GameInput inp, float dt, boolean consume) {
        if (!p.alive) return;
        if (p.spawnInvuln > 0) p.spawnInvuln -= dt;
        p.fireCd -= dt;
        p.emptyCd -= dt;
        p.hitFlash = Math.max(0f, p.hitFlash - dt);
        p.dashCd -= dt;

        if (inp.weaponSwitch != 0) {
            int nw = (p.weapon + (inp.weaponSwitch > 0 ? 1 : Weapons.ALL.length - 1)) % Weapons.ALL.length;
            p.weapon = nw;
            p.reloading = false;
            p.fireCd = Math.max(p.fireCd, 0.18f);
            if (p.isLocal && listener != null) listener.sfx("click");
        }

        if (p.reloading) continueReload(p, dt);

        float mx = inp.moveX, my = inp.moveY;
        float ml = (float) Math.sqrt(mx * mx + my * my);
        boolean moving = ml > 0.15f;
        if (moving) { mx /= ml; my /= ml; }

        if (inp.dash && p.dashCd <= 0 && moving) {
            p.dashing = true;
            p.dashT = 0.18f;
            p.dashCd = 1.8f;
            p.dashDx = mx; p.dashDy = my;
            if (p.isLocal && listener != null) listener.sfx("dash");
            spawnDashTrail(p);
        }
        if (p.dashing) {
            p.dashT -= dt;
            if (p.dashT <= 0) p.dashing = false;
            else movePlayer(p, p.dashDx, p.dashDy, dt);
        } else {
            float spd = 265f;
            float tvx = mx * spd, tvy = my * spd;
            p.vx += (tvx - p.vx) * Math.min(1f, dt * 10f);
            p.vy += (tvy - p.vy) * Math.min(1f, dt * 10f);
            movePlayer(p, p.vx / spd, p.vy / spd, dt);
        }
        if (moving) p.moveT += dt;

        if (inp.aimActive) {
            float ax = inp.aimX, ay = inp.aimY;
            float al = (float) Math.sqrt(ax * ax + ay * ay);
            if (al > 0.1f) p.aim = (float) Math.atan2(ay, ax);
        } else if (aimAssist && p.isLocal && (inp.fire || inp.firePressed)) {
            aimAssistLock(p);
        }

        if (inp.reload && !p.reloading && p.ammo[p.weapon] < Weapons.get(p.weapon).mag
                && p.reserve[p.weapon] > 0) {
            startReload(p);
        }

        Weapons.Def w = Weapons.get(p.weapon);
        boolean wantsFire = inp.fire || inp.firePressed;
        if (wantsFire && !p.reloading && p.fireCd <= 0) {
            if (p.ammo[p.weapon] > 0) {
                fireWeapon(p);
                if (!w.auto) inp.firePressed = false;
                if (p.ammo[p.weapon] == 0 && p.reserve[p.weapon] > 0) startReload(p);
            } else if (p.emptyCd <= 0) {
                p.emptyCd = 0.3f;
                if (p.isLocal && listener != null) listener.sfx("empty");
                if (p.reserve[p.weapon] > 0) startReload(p);
            }
        }

        if (p.regenT < 999f) p.regenT += dt;
        if (p.regenT > 6f && p.hp < PlayerEnt.MAX_HP) {
            p.hp = Math.min(PlayerEnt.MAX_HP, p.hp + 11f * dt);
        }

        if (consume) inp.resetButtons();
    }

    // ---------------------------------------------------------------- movimento e colisão

    public void movePlayer(PlayerEnt p, float dx, float dy, float dt) {
        float spd = p.dashing ? 820f : 265f;
        float ax = dx * spd * dt, ay = dy * spd * dt;
        float nx = p.x + ax;
        if (!circleBlocked(nx, p.y)) p.x = nx;
        float ny = p.y + ay;
        if (!circleBlocked(p.x, ny)) p.y = ny;
    }

    public boolean circleBlocked(float x, float y) {
        float r = PlayerEnt.RADIUS;
        if (x < 24 + r || y < 24 + r || x > map.w - 24 - r || y > map.h - 24 - r) return true;
        return pointInWalls(x, y, r);
    }

    public boolean pointBlocked(float x, float y) {
        if (x < 10 || y < 10 || x > map.w - 10 || y > map.h - 10) return true;
        return pointInWalls(x, y, 0);
    }

    private boolean pointInWalls(float x, float y, float r) {
        float[] ws = map.walls;
        for (int i = 0; i < ws.length; i += 4) {
            float wx = ws[i], wy = ws[i + 1], ww = ws[i + 2], wh = ws[i + 3];
            float cx = Math.max(wx, Math.min(x, wx + ww));
            float cy = Math.max(wy, Math.min(y, wy + wh));
            float dx = x - cx, dy = y - cy;
            if (dx * dx + dy * dy < r * r) return true;
        }
        return false;
    }

    public boolean lineOfSight(float x1, float y1, float x2, float y2) {
        float dx = x2 - x1, dy = y2 - y1;
        float d = (float) Math.sqrt(dx * dx + dy * dy);
        int steps = Math.max(8, (int) (d / 36f));
        for (int i = 1; i < steps; i++) {
            float t = i / (float) steps;
            if (pointInWalls(x1 + dx * t, y1 + dy * t, 0)) return false;
        }
        return true;
    }

    // ---------------------------------------------------------------- combate

    public void fireWeapon(PlayerEnt p) {
        Weapons.Def w = Weapons.get(p.weapon);
        if (p.ammo[p.weapon] <= 0) return;
        p.ammo[p.weapon]--;
        p.fireCd = w.fireInterval;
        float mx = p.x + (float) Math.cos(p.aim) * 24f;
        float my = p.y + (float) Math.sin(p.aim) * 24f;
        for (int i = 0; i < w.pellets; i++) {
            float spread = (float) (rnd.nextGaussian() * Math.toRadians(w.spreadDeg) * 0.5);
            float ang = p.aim + spread;
            bullets.add(new Bullet(bulletId(), p.id, p.team, mx, my,
                    (float) Math.cos(ang) * w.bulletSpeed, (float) Math.sin(ang) * w.bulletSpeed,
                    w.damage, 0.9f, w.bulletRadius, w.id == Weapons.SNIPER));
        }
        if (p.isLocal && listener != null) {
            listener.sfx(w.sfx);
            camShake = Math.max(camShake, w.id == Weapons.SNIPER ? 7f : 2.5f);
            spawnMuzzle(p);
        }
    }

    public void startReload(PlayerEnt p) {
        Weapons.Def w = Weapons.get(p.weapon);
        if (p.reloading || p.ammo[p.weapon] >= w.mag || p.reserve[p.weapon] <= 0) return;
        p.reloading = true;
        p.reloadT = w.reloadTime;
        if (p.isLocal && listener != null) listener.sfx("reload");
    }

    public void continueReload(PlayerEnt p, float dt) {
        if (!p.reloading) return;
        p.reloadT -= dt;
        if (p.reloadT <= 0) {
            Weapons.Def w = Weapons.get(p.weapon);
            int need = w.mag - p.ammo[p.weapon];
            int take = Math.min(need, p.reserve[p.weapon]);
            p.ammo[p.weapon] += take;
            p.reserve[p.weapon] -= take;
            p.reloading = false;
        }
    }

    private void updateBullets(float dt) {
        for (int i = bullets.size() - 1; i >= 0; i--) {
            Bullet b = bullets.get(i);
            b.life -= dt;
            if (b.life <= 0) { bullets.remove(i); continue; }
            float nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
            if (pointBlocked(nx, ny)) { spawnSpark(b.x, b.y); bullets.remove(i); continue; }
            b.x = nx; b.y = ny;
            boolean consumed = false;
            for (PlayerEnt p : players) {
                if (!p.alive || p.leftMatch || b.hit.contains(p.id)) continue;
                if (b.team != PlayerEnt.TEAM_NONE && p.team == b.team) continue;
                float dx = p.x - b.x, dy = p.y - b.y;
                float rr = PlayerEnt.RADIUS + b.radius;
                if (dx * dx + dy * dy < rr * rr) {
                    applyDamage(p, ownerOf(b.ownerId), b.damage);
                    if (!b.pierce) { consumed = true; break; }
                    b.hit.add(p.id);
                    b.damage *= 0.75f;
                }
            }
            if (consumed) bullets.remove(i);
        }
    }

    private void applyDamage(PlayerEnt victim, PlayerEnt attacker, float dmg) {
        float absorbed = 0f;
        if (victim.armor > 0f) {
            absorbed = Math.min(victim.armor, dmg * 0.6f);
            victim.armor -= absorbed;
            if (victim.armor < 0.5f) victim.armor = 0f;
        }
        victim.hp -= Math.max(1f, dmg - absorbed);
        victim.regenT = 0;
        victim.hitFlash = 0.18f;
        if (gfxQuality > 0) {
            floats.add(new FloatText(victim.x + (rnd.nextFloat() - 0.5f) * 24f, victim.y - 28,
                    "-" + (int) dmg, 0xFFFF6B5E, 0.7f, 15));
            spawnBlood(victim);
        }
        if (victim.isLocal && listener != null) {
            listener.sfx("hurt");
            camShake = Math.max(camShake, 5f);
        } else if (listener != null) {
            listener.sfx("hit");
        }
        if (victim.hp <= 0) kill(attacker, victim);
    }

    private void kill(PlayerEnt attacker, PlayerEnt victim) {
        victim.alive = false;
        victim.deaths++;
        victim.respawnT = mode == MODE_SURVIVAL ? 4f : 3f;
        victim.reloading = false;
        spawnDeath(victim);
        if (attacker != null) {
            attacker.kills++;
            if (mode == MODE_TDM || mode == MODE_LAN_TDM) {
                if (attacker.team == PlayerEnt.TEAM_RED) scoreRed++; else scoreBlue++;
            }
            addFeed(attacker.name + " eliminou " + victim.name);
            if (attacker.isLocal) {
                xpGain += 15;
                coinGain += 6;
                floats.add(new FloatText(attacker.x, attacker.y - 44, "+15 XP  +6$", 0xFFFFC53D, 1.1f, 15));
                if (listener != null) listener.sfx("kill");
            } else if (victim.isLocal && listener != null) {
                listener.sfx("death");
            }
        } else if (victim.isLocal && listener != null) {
            listener.sfx("death");
        }
        if (mode == MODE_SURVIVAL) {
            if (victim.isBot) {
                waveBotsAlive--;
                if (waveActive && waveBotsAlive <= 0) {
                    waveActive = false;
                    waveT = 4f;
                    long bonus = 20 + wave * 5;
                    xpGain += bonus;
                    coinGain += 10;
                    addFeed("Onda " + wave + " concluída! +" + bonus + " XP");
                    if (listener != null) listener.sfx("coin");
                }
            } else if (victim.isLocal) {
                lives--;
                if (lives <= 0) endMatch(-1);
            }
        }
    }

    private void updateRespawns(float dt) {
        for (PlayerEnt p : players) {
            if (p.leftMatch || p.alive) continue;
            p.respawnT -= dt;
            if (p.respawnT <= 0) {
                if (mode == MODE_SURVIVAL && lives <= 0) continue;
                spawnAt(p, randomSpawn(p.team));
                p.alive = true;
                p.hp = PlayerEnt.MAX_HP;
                p.armor = PlayerEnt.MAX_ARMOR * 0.5f;
                for (int i = 0; i < p.ammo.length; i++) {
                    p.ammo[i] = Weapons.get(i).mag;
                    p.reserve[i] = Weapons.get(i).reserve;
                }
                p.reloading = false;
                p.spawnInvuln = 1.5f;
                if (p.isLocal && listener != null) listener.sfx("spawn");
            }
        }
    }

    private void updatePickups(float dt) {
        for (Pickup pk : pickups) {
            pk.bob += dt * 2f;
            if (!pk.active) {
                pk.respawnT -= dt;
                if (pk.respawnT <= 0) pk.active = true;
                continue;
            }
            for (PlayerEnt p : players) {
                if (!p.alive || p.leftMatch) continue;
                float dx = p.x - pk.x, dy = p.y - pk.y;
                if (dx * dx + dy * dy < 32f * 32f) {
                    pk.active = false;
                    pk.respawnT = 15f;
                    if (pk.type == Pickup.HEALTH) {
                        p.hp = Math.min(PlayerEnt.MAX_HP, p.hp + 50);
                        if (p.isLocal) {
                            if (listener != null) listener.sfx("pickup");
                            floats.add(new FloatText(p.x, p.y - 40, "+50 VIDA", 0xFF3ECF7E, 1f, 15));
                        }
                    } else if (pk.type == Pickup.ARMOR) {
                        p.armor = Math.min(PlayerEnt.MAX_ARMOR, p.armor + 50);
                        if (p.isLocal) {
                            if (listener != null) listener.sfx("pickup");
                            floats.add(new FloatText(p.x, p.y - 40, "+50 COLETE", 0xFF4FC3F7, 1f, 15));
                        }
                    } else {
                        for (int i = 0; i < p.reserve.length; i++) {
                            p.reserve[i] += Weapons.get(i).mag;
                        }
                        if (p.isLocal) {
                            if (listener != null) listener.sfx("pickup");
                            floats.add(new FloatText(p.x, p.y - 40, "+MUNIÇÃO", 0xFF38B6FF, 1f, 15));
                        }
                    }
                    break;
                }
            }
        }
    }

    private void updateMatchEnd() {
        PlayerEnt me = localPlayer();
        if (mode == MODE_TDM || mode == MODE_LAN_TDM) {
            if (scoreRed >= TDM_TARGET || scoreBlue >= TDM_TARGET) {
                endMatch(scoreRed >= TDM_TARGET ? PlayerEnt.TEAM_RED : PlayerEnt.TEAM_BLUE);
            } else if (matchTime >= MATCH_TIME) {
                endMatch(scoreRed == scoreBlue ? 2 : (scoreRed > scoreBlue ? PlayerEnt.TEAM_RED : PlayerEnt.TEAM_BLUE));
            }
        } else if (mode == MODE_TRAIN) {
            return; // treino livre: sem placar final nem limite de tempo
        } else if (mode == MODE_FFA || mode == MODE_LAN_FFA) {
            PlayerEnt top = null;
            for (PlayerEnt p : players) {
                if (p.leftMatch) continue;
                if (top == null || p.kills > top.kills) top = p;
            }
            if (top != null && top.kills >= FFA_TARGET) {
                endMatch(top.isLocal ? 1 : -1);
            } else if (matchTime >= MATCH_TIME) {
                endMatch(me != null && top != null && top.isLocal ? 1 : -1);
            }
        } else if (me != null && me.kills >= 1 && !me.alive && lives <= 0) {
            endMatch(-1);
        }
    }

    private void endMatch(int team) {
        if (matchOver) return;
        matchOver = true;
        winTeam = team;
        PlayerEnt me = localPlayer();
        if (mode == MODE_TDM || mode == MODE_LAN_TDM) {
            localWon = me != null && team == me.team;
        } else {
            localWon = team == 1;
        }
        if (me != null) { localKills = me.kills; localDeaths = me.deaths; }
        if (listener != null) {
            listener.sfx(localWon ? "win" : "lose");
            listener.onMessage(localWon ? "VITÓRIA!" : "DERROTA");
        }
    }

    // ---------------------------------------------------------------- efeitos

    private void updateFx(float dt) {
        for (int i = particles.size() - 1; i >= 0; i--) {
            Particle pt = particles.get(i);
            pt.life -= dt;
            if (pt.life <= 0) { particles.remove(i); continue; }
            pt.vy += pt.gravity * dt;
            pt.x += pt.vx * dt;
            pt.y += pt.vy * dt;
        }
        for (int i = floats.size() - 1; i >= 0; i--) {
            FloatText f = floats.get(i);
            f.life -= dt;
            if (f.life <= 0) { floats.remove(i); continue; }
            f.y += f.vy * dt;
        }
        for (int i = killFeed.size() - 1; i >= 0; i--) {
            if (System.nanoTime() - killFeed.get(i).time > 5_500_000_000L) killFeed.remove(i);
        }
    }

    public void spawnParticle(float x, float y, float vx, float vy, float life, float size, int color, float gravity) {
        if (gfxQuality == 0) return;
        if (particles.size() > 260) return;
        particles.add(new Particle(x, y, vx, vy, life, size, color, gravity));
    }

    private void spawnMuzzle(PlayerEnt p) {
        float mx = p.x + (float) Math.cos(p.aim) * 26f;
        float my = p.y + (float) Math.sin(p.aim) * 26f;
        for (int i = 0; i < 4; i++) {
            float a = p.aim + (float) (rnd.nextGaussian() * 0.2);
            spawnParticle(mx, my, (float) Math.cos(a) * 260f, (float) Math.sin(a) * 260f,
                    0.08f + rnd.nextFloat() * 0.06f, 3f, 0xFFFFD75E, 0);
        }
    }

    private void spawnSpark(float x, float y) {
        for (int i = 0; i < 4; i++) {
            float a = (float) (rnd.nextDouble() * Math.PI * 2);
            float sp = 60 + rnd.nextFloat() * 160;
            spawnParticle(x, y, (float) Math.cos(a) * sp, (float) Math.sin(a) * sp,
                    0.2f + rnd.nextFloat() * 0.15f, 2.5f, 0xFFFFD75E, 0);
        }
    }

    private void spawnBlood(PlayerEnt p) {
        Skins.Def s = Skins.get(p.skinId);
        for (int i = 0; i < 5; i++) {
            float a = (float) (rnd.nextDouble() * Math.PI * 2);
            float sp = 40 + rnd.nextFloat() * 120;
            spawnParticle(p.x, p.y, (float) Math.cos(a) * sp, (float) Math.sin(a) * sp,
                    0.35f + rnd.nextFloat() * 0.2f, 3f, s.sec, 160f);
        }
    }

    private void spawnDeath(PlayerEnt p) {
        Skins.Def s = Skins.get(p.skinId);
        for (int i = 0; i < 14; i++) {
            float a = (float) (rnd.nextDouble() * Math.PI * 2);
            float sp = 60 + rnd.nextFloat() * 220;
            spawnParticle(p.x, p.y, (float) Math.cos(a) * sp, (float) Math.sin(a) * sp,
                    0.5f + rnd.nextFloat() * 0.35f, 4f, i % 2 == 0 ? s.body : s.sec, 220f);
        }
        spawnParticle(p.x, p.y, 0, 0, 0.35f, 26f, 0x66FFFFFF, 0);
    }

    private void spawnDashTrail(PlayerEnt p) {
        for (int i = 0; i < 6; i++) {
            spawnParticle(p.x - p.dashDx * 12f + (rnd.nextFloat() - 0.5f) * 10f,
                    p.y - p.dashDy * 12f + (rnd.nextFloat() - 0.5f) * 10f,
                    -p.dashDx * 40f, -p.dashDy * 40f, 0.3f, 5f, 0x5538B6FF, 0);
        }
    }

    private void addFeed(String text) {
        killFeed.add(0, new FeedItem(text, System.nanoTime()));
        while (killFeed.size() > 5) killFeed.remove(killFeed.size() - 1);
    }

    // ---------------------------------------------------------------- IA helpers

    public PlayerEnt nearestEnemy(PlayerEnt me) {
        PlayerEnt best = null;
        float bd = Float.MAX_VALUE;
        for (PlayerEnt p : players) {
            if (p == me || !p.alive || p.leftMatch) continue;
            if (mode == MODE_SURVIVAL || mode == MODE_TDM || mode == MODE_LAN_TDM) {
                if (me.sameTeam(p)) continue;
            }
            float dx = p.x - me.x, dy = p.y - me.y;
            float d = dx * dx + dy * dy;
            if (d < bd) { bd = d; best = p; }
        }
        return best;
    }

    public float botSightRange(PlayerEnt bot) { return 950f; }

    public float botAimError(PlayerEnt bot) {
        float e;
        if (mode == MODE_SURVIVAL) e = Math.max(0.03f, 0.13f - aiDiff * 0.045f);
        else e = new float[]{0.13f, 0.065f, 0.025f}[Math.max(0, Math.min(2, (int) aiDiff))];
        return e * (0.8f + bot.hp / PlayerEnt.MAX_HP * 0.5f);
    }

    public float botPreferredRange(PlayerEnt bot) {
        if (mode == MODE_SURVIVAL) return 190f;
        return 430f - aiDiff * 55f;
    }

    public float botFireRange(PlayerEnt bot) {
        if (mode == MODE_SURVIVAL) return 560f;
        return 760f - aiDiff * 40f;
    }

    public float botFireRate(PlayerEnt bot) {
        return 0.32f - aiDiff * 0.08f;
    }

    private void aimAssistLock(PlayerEnt me) {
        PlayerEnt best = null;
        float bd = 700f * 700f;
        for (PlayerEnt p : players) {
            if (p == me || !p.alive || p.leftMatch) continue;
            if (p.team != PlayerEnt.TEAM_NONE && p.team == me.team) continue;
            float dx = p.x - me.x, dy = p.y - me.y;
            float d = dx * dx + dy * dy;
            if (d < bd) {
                float dd = (float) Math.sqrt(d);
                if (dd > 10 && lineOfSight(me.x, me.y, p.x, p.y)) { bd = d; best = p; }
            }
        }
        if (best != null) me.aim = (float) Math.atan2(best.y - me.y, best.x - me.x);
    }

    // ---------------------------------------------------------------- spawns

    private float[] randomSpawn(int team) {
        float[] pts = map.spawnsForTeam(team);
        for (int attempt = 0; attempt < 8; attempt++) {
            int i = rnd.nextInt(pts.length / 2) * 2;
            float sx = pts[i], sy = pts[i + 1];
            if (!nearOtherPlayer(sx, sy, 110f)) return new float[]{sx, sy};
        }
        return new float[]{pts[0], pts[1]};
    }

    private float[] survivalSpawn() {
        for (int attempt = 0; attempt < 8; attempt++) {
            float sx, sy;
            switch (rnd.nextInt(4)) {
                case 0: sx = 60; sy = 60 + rnd.nextFloat() * (map.h - 120); break;
                case 1: sx = map.w - 60; sy = 60 + rnd.nextFloat() * (map.h - 120); break;
                case 2: sx = 60 + rnd.nextFloat() * (map.w - 120); sy = 60; break;
                default: sx = 60 + rnd.nextFloat() * (map.w - 120); sy = map.h - 60; break;
            }
            if (!nearOtherPlayer(sx, sy, 90f)) return new float[]{sx, sy};
        }
        return new float[]{120, 120};
    }

    private void spawnAt(PlayerEnt p, float[] pt) {
        p.x = pt[0]; p.y = pt[1];
        p.vx = 0; p.vy = 0;
        p.aim = (float) (rnd.nextDouble() * Math.PI * 2);
        p.armor = Math.min(PlayerEnt.MAX_ARMOR, p.armor + 50f);
    }

    private void spawnAtFree(PlayerEnt p) {
        float[] pts = map.spawnFree;
        int i = rnd.nextInt(pts.length / 2) * 2;
        p.x = pts[i]; p.y = pts[i + 1];
        p.aim = (float) (rnd.nextDouble() * Math.PI * 2);
    }

    private boolean nearOtherPlayer(float x, float y, float minD) {
        for (PlayerEnt p : players) {
            float dx = p.x - x, dy = p.y - y;
            if (dx * dx + dy * dy < minD * minD) return true;
        }
        return false;
    }

    // ---------------------------------------------------------------- util

    public PlayerEnt localPlayer() {
        for (PlayerEnt p : players) if (p.isLocal) return p;
        return null;
    }

    public PlayerEnt byId(int id) {
        for (PlayerEnt p : players) if (p.id == id) return p;
        return null;
    }

    private PlayerEnt ownerOf(int id) { return byId(id); }

    private int bulletId() { return nextId++; }

    private static String enc(String s) {
        if (s == null) return "_";
        return s.replace('|', '_').replace(',', '_').replace('\n', '_');
    }

    // ---------------------------------------------------------------- LAN

    public int addLanPlayer(String name, int skinId) {
        int team;
        if (mode == MODE_LAN_FFA) {
            team = PlayerEnt.TEAM_NONE;
        } else {
            int red = 0, blue = 0;
            for (PlayerEnt p : players) {
                if (p.leftMatch) continue;
                if (p.team == PlayerEnt.TEAM_RED) red++;
                else if (p.team == PlayerEnt.TEAM_BLUE) blue++;
            }
            team = red <= blue ? PlayerEnt.TEAM_BLUE : PlayerEnt.TEAM_RED;
        }
        PlayerEnt p = new PlayerEnt(nextId++, name, team, skinId, false, false);
        spawnAt(p, randomSpawn(team));
        players.add(p);
        remoteInputs.put(p.id, new GameInput());
        return p.id;
    }

    public void removeLanPlayer(int id) {
        PlayerEnt p = byId(id);
        if (p != null) { p.leftMatch = true; p.alive = false; }
        remoteInputs.remove(id);
    }

    public String encodeSnapshot() {
        StringBuilder sb = new StringBuilder();
        sb.append("S|").append((int) matchTime).append('|').append(scoreRed).append('|').append(scoreBlue)
                .append('|').append(mapIndex()).append('|').append(mode).append('|')
                .append(matchOver ? 1 : 0).append('|').append(winTeam).append('|');
        int pc = 0;
        for (PlayerEnt p : players) if (!p.leftMatch) pc++;
        sb.append(pc);
        for (PlayerEnt p : players) {
            if (p.leftMatch) continue;
            sb.append('|').append(p.id).append(',').append(enc(p.name)).append(',').append(p.team)
                    .append(',').append(p.skinId).append(',').append((int) p.x).append(',').append((int) p.y)
                    .append(',').append((int) (p.aim * 1000)).append(',').append((int) p.hp)
                    .append(',').append(p.alive ? 1 : 0).append(',').append(p.weapon)
                    .append(',').append(p.ammo[p.weapon]).append(',').append(p.reserve[p.weapon])
                    .append(',').append(p.reloading ? 1 : 0).append(',').append(p.kills).append(',')
                    .append(p.deaths).append(',').append(p.dashing ? 1 : 0).append(',')
                    .append((int) (p.dashDx * 10)).append(',').append((int) (p.dashDy * 10));
        }
        sb.append("|B").append(bullets.size());
        for (Bullet b : bullets) {
            sb.append('|').append(b.id).append(',').append((int) b.x).append(',').append((int) b.y)
                    .append(',').append((int) b.vx).append(',').append((int) b.vy).append(',')
                    .append(b.team).append(',').append((int) b.damage).append(',').append((int) (b.life * 100));
        }
        sb.append("|P").append(pickups.size());
        for (Pickup pk : pickups) {
            sb.append('|').append((int) pk.x).append(',').append((int) pk.y).append(',').append(pk.type)
                    .append(',').append(pk.active ? 1 : 0);
        }
        sb.append("|F").append(killFeed.size());
        for (FeedItem f : killFeed) sb.append('|').append(enc(f.text));
        return sb.toString();
    }

    public synchronized void applySnapshot(String line) {
        String[] tok = line.split("\\|", -1);
        int i = 1;
        try {
            matchTime = Integer.parseInt(tok[i++]);
            scoreRed = Integer.parseInt(tok[i++]);
            scoreBlue = Integer.parseInt(tok[i++]);
            i++; // mapIdx
            i++; // mode
            matchOver = tok[i++].equals("1");
            winTeam = Integer.parseInt(tok[i++]);

            int pc = Integer.parseInt(tok[i++]);
            ArrayList<Integer> ids = new ArrayList<>();
            for (int n = 0; n < pc; n++) {
                String[] f = tok[i++].split(",", -1);
                int id = Integer.parseInt(f[0]);
                String name = f[1];
                int team = Integer.parseInt(f[2]);
                int skin = Integer.parseInt(f[3]);
                float x = Integer.parseInt(f[4]);
                float y = Integer.parseInt(f[5]);
                float aim = Integer.parseInt(f[6]) / 1000f;
                float hp = Integer.parseInt(f[7]);
                boolean alive = f[8].equals("1");
                int weapon = Integer.parseInt(f[9]);
                int ammo = Integer.parseInt(f[10]);
                int reserve = Integer.parseInt(f[11]);
                boolean reloading = f[12].equals("1");
                int kills = Integer.parseInt(f[13]);
                int deaths = Integer.parseInt(f[14]);
                boolean dashing = f[15].equals("1");
                float dashDx = Integer.parseInt(f[16]) / 10f;
                float dashDy = Integer.parseInt(f[17]) / 10f;
                PlayerEnt p = byId(id);
                if (p == null) {
                    p = new PlayerEnt(id, name, team, skin, false, id == localId);
                    players.add(p);
                }
                p.name = name; p.team = team; p.skinId = skin;
                p.x = x; p.y = y; p.aim = aim; p.hp = hp; p.alive = alive;
                p.weapon = weapon;
                p.ammo[p.weapon] = ammo;
                p.reserve[p.weapon] = reserve;
                p.reloading = reloading;
                p.kills = kills; p.deaths = deaths;
                p.dashing = dashing; p.dashDx = dashDx; p.dashDy = dashDy;
                ids.add(id);
            }
            for (int n = players.size() - 1; n >= 0; n--) {
                PlayerEnt p = players.get(n);
                if (!p.isLocal && !ids.contains(p.id)) players.remove(n);
            }
            PlayerEnt meLocal = localPlayer();
            if (meLocal != null) {
                localKills = meLocal.kills;
                localDeaths = meLocal.deaths;
                int delta = meLocal.kills - prevSnapKills;
                if (delta > 0) { xpGain += 15L * delta; coinGain += 6L * delta; }
                prevSnapKills = meLocal.kills;
                if (matchOver) {
                    if (mode == MODE_LAN_TDM) localWon = meLocal != null && winTeam == meLocal.team;
                    else if (mode == MODE_LAN_FFA) localWon = winTeam == 1;
                }
            }

            bullets.clear();
            String bt = tok[i++];
            int bc = Integer.parseInt(bt.substring(1));
            for (int n = 0; n < bc; n++) {
                String[] f = tok[i++].split(",", -1);
                bullets.add(new Bullet(Integer.parseInt(f[0]), -1, Integer.parseInt(f[5]),
                        Integer.parseInt(f[1]), Integer.parseInt(f[2]), Integer.parseInt(f[3]),
                        Integer.parseInt(f[4]), Integer.parseInt(f[6]),
                        Integer.parseInt(f[7]) / 100f, 4f, false));
            }

            pickups.clear();
            String pt = tok[i++];
            int pk = Integer.parseInt(pt.substring(1));
            for (int n = 0; n < pk; n++) {
                String[] f = tok[i++].split(",", -1);
                Pickup p = new Pickup(Integer.parseInt(f[0]), Integer.parseInt(f[1]), Integer.parseInt(f[2]));
                p.active = f[3].equals("1");
                pickups.add(p);
            }

            killFeed.clear();
            String ft = tok[i++];
            int fn = Integer.parseInt(ft.substring(1));
            for (int n = 0; n < fn; n++) {
                if (i < tok.length) killFeed.add(new FeedItem(tok[i++], System.nanoTime()));
            }
        } catch (Exception ignored) {
            // snapshot malformado: ignora e aguarda o próximo
        }
    }

    private int mapIndex() {
        for (int i = 0; i < Maps.ALL.length; i++) if (Maps.ALL[i] == map) return i;
        return 0;
    }
}
