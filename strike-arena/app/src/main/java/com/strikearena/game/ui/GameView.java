package com.strikearena.game.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Shader;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.view.SurfaceHolder;
import android.view.SurfaceView;

import com.strikearena.game.R;
import com.strikearena.game.audio.SoundManager;
import com.strikearena.game.core.Bullet;
import com.strikearena.game.core.FloatText;
import com.strikearena.game.core.Game;
import com.strikearena.game.core.MapDef;
import com.strikearena.game.core.Particle;
import com.strikearena.game.core.Pickup;
import com.strikearena.game.core.PlayerEnt;
import com.strikearena.game.core.Skins;
import com.strikearena.game.core.Weapons;
import com.strikearena.game.data.Account;
import com.strikearena.game.data.Db;
import com.strikearena.game.data.Prefs;

import java.util.ArrayList;

/** Superfície de jogo: loop de renderização, controles touch e HUD. */
public class GameView extends SurfaceView implements SurfaceHolder.Callback, Game.Listener {

    public final Game game;
    private final SoundManager sfx;
    private final Prefs prefs;
    private final Context ctx;

    private SurfaceHolder holder;
    private Thread renderThread;
    private volatile boolean running;
    private volatile boolean paused;
    private long lastNs;
    private float fps;

    private float vw, vh;
    private float camX, camY;
    private float hudS;

    // controles
    private int movePointer = -1, aimPointer = -1;
    private float moveBaseX, moveBaseY, moveKnobX, moveKnobY;
    private float aimBaseX, aimBaseY, aimKnobX, aimKnobY;
    private int firePointer = -1;
    private final RectF fireBtn = new RectF(), reloadBtn = new RectF(), dashBtn = new RectF(),
            weaponBtn = new RectF(), pauseBtn = new RectF();
    private final RectF endContinue = new RectF(), endExit = new RectF(), pauseResume = new RectF(),
            pauseExit = new RectF();
    private boolean statsSaved;
    private String banner = "";
    private long bannerAt;
    private String netNotice = "";

    // paints
    private final Paint p = new Paint();
    private final Paint tp = new Paint();
    private final Paint hpPaint = new Paint();
    private final Paint mmPaint = new Paint();
    private final Paint vignette = new Paint();

    public GameView(Context c, Game game, AttributeSet a) { this(c, game); }

    public GameView(Context c, Game game) {
        super(c);
        this.ctx = c;
        this.game = game;
        this.sfx = SoundManager.get(c);
        this.prefs = Prefs.get(c);
        holder = getHolder();
        holder.addCallback(this);
        setFocusable(true);
        game.listener = this;
        game.aimAssist = prefs.aimAssist();
        game.gfxQuality = prefs.quality();
        sfx.preload();
        p.setAntiAlias(true);
        tp.setAntiAlias(true);
        hpPaint.setAntiAlias(true);
        mmPaint.setAntiAlias(true);
        vignette.setAntiAlias(true);
    }

    // ------------------------------------------------------------- ciclo de vida

    @Override public void surfaceCreated(SurfaceHolder h) {
        running = true;
        lastNs = System.nanoTime();
        renderThread = new Thread(this::renderLoop, "sa-render");
        renderThread.start();
    }

    @Override public void surfaceChanged(SurfaceHolder h, int fmt, int w, int hh) {
        vw = w; vh = hh;
        hudS = Math.min(w, hh) / 640f;
        layoutButtons();
    }

    @Override public void surfaceDestroyed(SurfaceHolder h) {
        running = false;
        try { if (renderThread != null) renderThread.join(400); } catch (Exception ignored) {}
    }

    public void pauseGame() { paused = true; sfx.stopAmbient(); }
    public void resumeGame() { paused = false; sfx.startAmbient(); }
    public void shutdown() {
        running = false;
        sfx.stopAmbient();
    }

    private void layoutButtons() {
        float s = hudS;
        float r = 64f * s;
        fireBtn.set(vw - 10 * s - r * 2, vh - 10 * s - r * 2, vw - 10 * s, vh - 10 * s);
        float br = 40f * s;
        reloadBtn.set(vw - 130 * s - br * 2, vh - 10 * s - br * 2, vw - 130 * s, vh - 10 * s);
        dashBtn.set(vw - 130 * s - br * 2, vh - 10 * s - br * 2 - 62 * s, vw - 130 * s, vh - 10 * s - 62 * s);
        weaponBtn.set(vw - 10 * s - br * 2, vh - 10 * s - r * 2 - br * 2 - 24 * s, vw - 10 * s, vh - 10 * s - r * 2 - 24 * s);
        pauseBtn.set(vw - 46 * s, 10 * s, vw - 10 * s, 46 * s);
    }

    // ------------------------------------------------------------- loop

    private void renderLoop() {
        while (running) {
            long now = System.nanoTime();
            float dt = Math.min(0.05f, (now - lastNs) / 1e9f);
            lastNs = now;
            if (!paused) {
                synchronized (game) {
                    game.update(dt);
                }
            }
            drawFrame();
            long spent = System.nanoTime() - now;
            long sleepNs = 16_666_666L - spent;
            if (sleepNs > 0) {
                try { Thread.sleep(sleepNs / 1_000_000, (int) (sleepNs % 1_000_000)); }
                catch (InterruptedException ignored) { break; }
            }
            fps = 1e9f / Math.max(1L, System.nanoTime() - now);
        }
    }

    private void drawFrame() {
        Canvas c = null;
        try {
            c = holder.lockCanvas();
            if (c == null) return;
            render(c);
        } catch (Exception ignored) {
        } finally {
            if (c != null) {
                try { holder.unlockCanvasAndPost(c); } catch (Exception ignored) {}
            }
        }
    }

    // ------------------------------------------------------------- desenho

    private void render(Canvas c) {
        c.drawColor(0xFF10161F);
        if (vw <= 0 || vh <= 0) return;

        PlayerEnt me = game.localPlayer();
        float zoom = Math.max(0.55f, Math.min(Math.min(vw / 1500f, vh / 950f), 1.25f));

        float targetX = me != null ? me.x : game.map.w / 2f;
        float targetY = me != null ? me.y : game.map.h / 2f;
        camX += (targetX - camX) * 0.12f;
        camY += (targetY - camY) * 0.12f;
        float halfW = vw / (2f * zoom), halfH = vh / (2f * zoom);
        if (game.map.w > vw / zoom) camX = Math.max(halfW, Math.min(game.map.w - halfW, camX));
        else camX = game.map.w / 2f;
        if (game.map.h > vh / zoom) camY = Math.max(halfH, Math.min(game.map.h - halfH, camY));
        else camY = game.map.h / 2f;
        float shX = 0, shY = 0;
        if (game.camShake > 0.2f) {
            shX = (float) (Math.random() - 0.5) * game.camShake * 3f;
            shY = (float) (Math.random() - 0.5) * game.camShake * 3f;
        }
        camX += shX; camY += shY;

        c.save();
        c.scale(zoom, zoom);
        c.translate(vw / 2f - camX * zoom, vh / 2f - camY * zoom);

        drawWorld(c);
        c.restore();

        drawHud(c, me, zoom);
    }

    private float sx(float wx) { return (wx - camX) * viewZoom() + vw / 2f; }
    private float sy(float wy) { return (wy - camY) * viewZoom() + vh / 2f; }
    private float viewZoom() { return Math.max(0.55f, Math.min(Math.min(vw / 1500f, vh / 950f), 1.25f)); }

    private void drawWorld(Canvas c) {
        MapDef m = game.map;
        p.setStyle(Paint.Style.FILL);
        p.setColor(m.floorColor);
        c.drawRect(0, 0, m.w, m.h, p);
        // grade
        p.setColor(m.floorAlt);
        float z = viewZoom();
        float x0 = Math.max(0, (camX - vw / 2f / z) / 100f);
        float x1 = Math.min(m.w / 100f, (camX + vw / 2f / z) / 100f);
        float y0 = Math.max(0, (camY - vh / 2f / z) / 100f);
        float y1 = Math.min(m.h / 100f, (camY + vh / 2f / z) / 100f);
        p.setStrokeWidth(2f);
        p.setStyle(Paint.Style.STROKE);
        for (int i = (int) x0; i <= (int) x1; i++) c.drawLine(i * 100f, 0, i * 100f, m.h, p);
        for (int j = (int) y0; j <= (int) y1; j++) c.drawLine(0, j * 100f, m.w, j * 100f, p);
        p.setStyle(Paint.Style.FILL);

        // bases das equipes
        drawBase(c, m.baseBlue, "BASE POLÍCIA", 0xFF38B6FF);
        drawBase(c, m.baseRed, "BASE RIVAIS", 0xFFE8503A);

        // marcação de ruas (faixa central tracejada)
        p.setColor(0x66FFE082);
        p.setStrokeWidth(5f);
        p.setStyle(Paint.Style.STROKE);
        for (float rx = 100f; rx < m.w - 60f; rx += 220f) {
            c.drawLine(rx, 460f, rx + 90f, 460f, p);
            c.drawLine(rx, 1140f, rx + 90f, 1140f, p);
        }
        for (float ry = 100f; ry < m.h - 60f; ry += 220f) {
            c.drawLine(460f, ry, 460f, ry + 90f, p);
            c.drawLine(1940f, ry, 1940f, ry + 90f, p);
        }
        p.setStyle(Paint.Style.FILL);

        // paredes low-poly (casas/blocos facetados)
        float[] ws = m.walls;
        for (int i = 0; i < ws.length; i += 4) {
            float wx = ws[i], wy = ws[i + 1], ww = ws[i + 2], wh = ws[i + 3];
            p.setColor(0x33000000);
            c.drawRect(wx + 5, wy + 7, wx + ww + 5, wy + wh + 7, p); // sombra clara
            p.setColor(m.wallColor);
            c.drawRect(wx, wy, wx + ww, wy + wh, p);
            p.setColor(m.wallTopColor);
            c.drawRect(wx + 4, wy + 4, wx + ww - 4, wy + wh - 4, p);
            // facetas: aresta clara (sol) e aresta escura
            p.setColor(0xAAFFFFFF);
            p.setStrokeWidth(3f);
            c.drawLine(wx + 4, wy + 4, wx + ww - 4, wy + 4, p);
            c.drawLine(wx + 4, wy + 4, wx + 4, wy + wh - 4, p);
            p.setStrokeWidth(1f);
            p.setColor(0x66000000);
            c.drawLine(wx + 4, wy + wh - 4, wx + ww - 4, wy + wh - 4, p);
            c.drawLine(wx + ww - 4, wy + 4, wx + ww - 4, wy + wh - 4, p);
            // cumeeira do telhado
            p.setColor(0x88FFFFFF);
            c.drawLine(wx + 4, wy + wh / 2f, wx + ww - 4, wy + wh / 2f, p);
        }

        // postes + fios da rede elétrica
        drawPoles(c, m);

        // veículos estacionados
        drawCars(c, m);

        // comércios da comunidade (marquises)
        drawAwnings(c, m);

        // itens
        for (Pickup pk : game.pickups) {
            if (!pk.active) continue;
            float py = pk.y + (float) Math.sin(pk.bob) * 4f;
            float pulse = 0.6f + 0.4f * (float) Math.sin(pk.bob * 2f);
            int pkColor = pk.type == Pickup.HEALTH ? 0xFF3ECF7E
                    : pk.type == Pickup.ARMOR ? 0xFFFFC53D : 0xFF38B6FF;
            String pkLabel = pk.type == Pickup.HEALTH ? "+" : pk.type == Pickup.ARMOR ? "C" : "A";
            // diamante low-poly (contorno + núcleo facetado)
            p.setColor(withAlpha(pkColor, 0x66));
            drawDiamond(c, pk.x, py, 20f);
            p.setColor(pkColor);
            drawDiamond(c, pk.x, py, 13f);
            p.setColor(lighten(pkColor));
            drawDiamond(c, pk.x - 2f, py - 2f, 5.5f);
            p.setColor(0xFF0B1020);
            p.setTextAlign(Paint.Align.CENTER);
            p.setTextSize(14f);
            p.setFakeBoldText(true);
            c.drawText(pkLabel, pk.x, py + 5f, p);
            p.setFakeBoldText(false);
        }

        // balas
        for (Bullet b : game.bullets) {
            float len = Math.min(26f, (float) Math.hypot(b.vx, b.vy) * 0.03f);
            float ux = b.vx / (float) Math.hypot(b.vx, b.vy), uy = b.vy / (float) Math.hypot(b.vx, b.vy);
            p.setColor(b.team == PlayerEnt.TEAM_RED ? 0xFFFF9A76 : 0xFF7CE0FF);
            p.setStrokeWidth(4f);
            p.setStyle(Paint.Style.STROKE);
            c.drawLine(b.x - ux * len, b.y - uy * len, b.x, b.y, p);
            p.setStyle(Paint.Style.FILL);
        }

        // jogadores
        for (PlayerEnt pl : game.players) {
            if (pl.leftMatch || !pl.alive) continue;
            drawPlayer(c, pl);
        }

        // partículas
        for (Particle pt : game.particles) {
            float a = Math.max(0f, pt.life / pt.maxLife);
            p.setColor(withAlpha(pt.color, (int) (a * 255)));
            c.drawCircle(pt.x, pt.y, pt.size, p);
        }

        // textos flutuantes
        for (FloatText f : game.floats) {
            float a = Math.max(0f, f.life / f.maxLife);
            tp.setColor(withAlpha(f.color, (int) (a * 255)));
            tp.setTextSize(f.size);
            tp.setTextAlign(Paint.Align.CENTER);
            tp.setFakeBoldText(true);
            c.drawText(f.text, f.x, f.y, tp);
            tp.setFakeBoldText(false);
        }
    }

    /** Barra segmentada low-poly (HUD). */
    private void segBar(Canvas c, float x, float y, float w, float h, float frac, int color) {
        hpPaint.setStyle(Paint.Style.FILL);
        hpPaint.setColor(0xAA000000);
        c.drawRect(x, y, x + w, y + h, hpPaint);
        int segs = 12;
        int filled = Math.min(segs, (int) Math.ceil(segs * Math.max(0f, Math.min(1f, frac))));
        float sw = (w - (segs - 1) * 3f) / segs;
        for (int i = 0; i < segs; i++) {
            if (i >= filled) break;
            hpPaint.setColor(color);
            c.drawRect(x + i * (sw + 3f), y + 2f, x + i * (sw + 3f) + sw, y + h - 2f, hpPaint);
        }
        hpPaint.setStyle(Paint.Style.STROKE);
        hpPaint.setColor(0x66FFFFFF);
        hpPaint.setStrokeWidth(1.5f);
        c.drawRect(x, y, x + w, y + h, hpPaint);
        hpPaint.setStyle(Paint.Style.FILL);
        hpPaint.setStrokeWidth(1f);
    }

    private void drawBase(Canvas c, float[] base, String label, int color) {
        if (base == null || base.length < 4) return;
        p.setStyle(Paint.Style.FILL);
        p.setColor(withAlpha(color, 0x33));
        c.drawRect(base[0], base[1], base[0] + base[2], base[1] + base[3], p);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(5f);
        p.setColor(withAlpha(color, 0xAA));
        c.drawRect(base[0], base[1], base[0] + base[2], base[1] + base[3], p);
        p.setStrokeWidth(1f);
        tp.setColor(color);
        tp.setTextSize(17f);
        tp.setFakeBoldText(true);
        tp.setTextAlign(Paint.Align.CENTER);
        c.drawText(label, base[0] + base[2] / 2f, base[1] + 22f, tp);
        tp.setFakeBoldText(false);
    }

    private void drawPlayer(Canvas c, PlayerEnt pl) {
        Skins.Def skin = Skins.get(pl.skinId);
        float px = pl.x, py = pl.y;
        float blink = pl.spawnInvuln > 0 ? (Math.sin(pl.spawnInvuln * 20f) > 0 ? 0.35f : 1f) : 1f;
        // sombra de sol (clara)
        p.setColor(0x22000000);
        c.drawOval(new RectF(px - 18, py - 13, px + 18, py + 9), p);

        // corpo low-poly: hexágono facetado
        float r = PlayerEnt.RADIUS;
        Path bodyPath = new Path();
        for (int i = 0; i < 6; i++) {
            float a = (float) (Math.PI / 6f + i * Math.PI / 3f);
            float xx = px + (float) Math.cos(a) * r, yy = py + (float) Math.sin(a) * r;
            if (i == 0) bodyPath.moveTo(xx, yy); else bodyPath.lineTo(xx, yy);
        }
        bodyPath.close();
        p.setColor(withAlpha(skin.body, (int) (255 * blink)));
        c.drawPath(bodyPath, p);
        // facetas de luz (topo-esquerda claro, baixo-direita escuro)
        p.setColor(withAlpha(lighten(skin.body), (int) (150 * blink)));
        c.drawPath(slice(px, py, -0.9f, -0.9f, r), p);
        p.setColor(withAlpha(darken(skin.body), (int) (150 * blink)));
        c.drawPath(slice(px, py, 0.9f, 0.9f, r), p);

        // uniforme da equipe (faixa + ombreiras)
        if (pl.team != PlayerEnt.TEAM_NONE) {
            int team = pl.team == PlayerEnt.TEAM_POLICE ? 0xFF38B6FF : 0xFFE8503A;
            p.setColor(withAlpha(team, (int) (235 * blink)));
            c.drawPath(band(px, py, r, 0f), p);
            p.setColor(withAlpha(team, (int) (235 * blink)));
            c.drawCircle(px - 10f, py, 4.5f, p);
            c.drawCircle(px + 10f, py, 4.5f, p);
        }

        // arma low-poly por tipo
        c.save();
        c.translate(px, py);
        c.rotate((float) Math.toDegrees(pl.aim));
        drawWeapon(c, pl.weapon, withAlpha(skin.sec, (int) (255 * blink)));
        c.restore();

        // cabeça + visor
        float vx = px + (float) Math.cos(pl.aim) * 5f;
        float vy = py + (float) Math.sin(pl.aim) * 5f;
        p.setColor(withAlpha(skin.visor, (int) (255 * blink)));
        c.drawCircle(vx, vy, 6.5f, p);
        p.setColor(withAlpha(darken(skin.visor), (int) (220 * blink)));
        c.drawCircle(vx + 2f, vy, 3.2f, p);

        // padrões de skin (faceta extra)
        if (skin.pattern == 1) {
            p.setColor(withAlpha(skin.visor, (int) (255 * blink)));
            p.setStrokeWidth(3f);
            c.drawArc(new RectF(px - 15, py - 15, px + 15, py + 15), -20, 40, false, p);
        } else if (skin.pattern == 2) {
            p.setColor(withAlpha(skin.visor, (int) (255 * blink)));
            p.setStrokeWidth(3f);
            c.drawArc(new RectF(px - 12, py - 12, px + 12, py + 12), 160, 40, false, p);
        } else if (skin.pattern == 3) {
            float pulse = 0.5f + 0.5f * (float) Math.sin(pl.moveT * 6f);
            p.setColor(withAlpha(skin.visor, (int) (80 + 100 * pulse)));
            c.drawCircle(px, py, 21f, p);
        }

        // dano recente
        if (pl.hitFlash > 0) {
            p.setColor((int) (180 * Math.min(1f, pl.hitFlash / 0.18f)) << 24 | 0xFFFFFF);
            c.drawPath(bodyPath, p);
        }

        // barra de vida e colete de inimigos (segmentos low-poly)
        if (pl != game.localPlayer()) {
            float bw = 40f, bh = 4.5f;
            float bx = px - bw / 2f, by = py - 32f;
            p.setColor(0xAA000000);
            c.drawRoundRect(new RectF(bx - 1, by - 1, bx + bw + 1, by + bh + 1), 2, 2, p);
            int seg = (int) Math.ceil(pl.hp / 10f);
            for (int i = 0; i < 10; i++) {
                if (i >= seg) break;
                p.setColor(pl.hp > 55 ? 0xFF3ECF7E : pl.hp > 25 ? 0xFFFFC53D : 0xFFE8503A);
                c.drawRect(bx + i * 3.7f, by, bx + i * 3.7f + 3f, by + bh, p);
            }
            if (pl.armor > 0.5f) {
                int aseg = (int) Math.ceil(pl.armor / 10f);
                for (int i = 0; i < 10; i++) {
                    if (i >= aseg) break;
                    p.setColor(0xFF4FC3F7);
                    c.drawRect(bx + i * 3.7f, by + bh + 2f, bx + i * 3.7f + 3f, by + bh + 2f + 2.5f, p);
                }
            }
            tp.setColor(0xCCFFFFFF);
            tp.setTextSize(11f);
            tp.setTextAlign(Paint.Align.CENTER);
            c.drawText(pl.name, px, by - 5f, tp);
        }
    }

    // ---------------------------------------------------------------- low-poly helpers

    /** Metade de um polígono facetado (triângulo interno de luz/sombra). */
    private Path slice(float cx, float cy, float dx, float dy, float r) {
        Path pt = new Path();
        pt.moveTo(cx, cy);
        pt.lineTo(cx + dx * r, cy + dy * r);
        pt.lineTo(cx + (dx * 0.35f - dy * 0.5f) * r, cy + (dy * 0.35f + dx * 0.5f) * r);
        pt.close();
        return pt;
    }

    /** Faixa de uniforme da equipe (polígono atravessando o corpo). */
    private Path band(float cx, float cy, float r, float ang) {
        Path pt = new Path();
        pt.moveTo(cx - r * 0.9f, cy - r * 0.55f);
        pt.lineTo(cx + r * 0.9f, cy - r * 0.55f);
        pt.lineTo(cx + r * 0.9f, cy - r * 0.15f);
        pt.lineTo(cx - r * 0.9f, cy - r * 0.15f);
        pt.close();
        return pt;
    }

    /** Arma low-poly com silhueta diferente para cada tipo. */
    private void drawWeapon(Canvas c, int weapon, int color) {
        float[] pts;
        int dark = darken(color), light = lighten(color);
        switch (weapon) {
            case Weapons.PISTOL: // compacta
                pts = new float[]{0, -3.5f, 13, -3.5f, 13, 3.5f, 0, 3.5f};
                drawPoly(c, pts, color);
                drawPoly(c, new float[]{-4.5f, 0.5f, -2.5f, 0.5f, -3.5f, 8f}, dark);
                drawPoly(c, new float[]{13, -2.5f, 16.5f, -2.5f, 16.5f, 2.5f, 13, 2.5f}, dark);
                break;
            case Weapons.RIFLE:
                pts = new float[]{0, -4f, 24, -4f, 24, 4f, 0, 4f};
                drawPoly(c, pts, color);
                drawPoly(c, new float[]{-7f, -3f, -2.5f, -3f, -2.5f, 3f, -7f, 3f}, dark); // coronha
                drawPoly(c, new float[]{7f, 4f, 11f, 4f, 10f, 11f, 6f, 11f}, dark);       // carregador
                drawPoly(c, new float[]{24, -2f, 33f, -2f, 33f, 2f, 24, 2f}, dark);        // cano
                break;
            case Weapons.SMG:
                pts = new float[]{0, -3f, 18, -3f, 18, 3f, 0, 3f};
                drawPoly(c, pts, color);
                drawPoly(c, new float[]{-6f, -2.5f, -2f, -2.5f, -2f, 2.5f, -6f, 2.5f}, dark);
                drawPoly(c, new float[]{5f, 3f, 9.5f, 3f, 8f, 10f, 4f, 10f}, dark);        // carregador curvo
                drawPoly(c, new float[]{18, -1.5f, 25f, -1.5f, 25f, 1.5f, 18, 1.5f}, dark); // abafador
                break;
            case Weapons.SHOTGUN:
                pts = new float[]{0, -3.5f, 22, -3.5f, 22, 3.5f, 0, 3.5f};
                drawPoly(c, pts, color);
                drawPoly(c, new float[]{-7f, -2.5f, -2f, -2.5f, -2f, 2.5f, -7f, 2.5f}, dark);
                drawPoly(c, new float[]{22, -3.5f, 34, -3.5f, 34, 3.5f, 22, 3.5f}, dark);  // cano largo
                drawPoly(c, new float[]{12, -4.5f, 18, -4.5f, 18, -3.5f, 12, -3.5f}, light); // bomba
                break;
            default: // SNIPER
                pts = new float[]{0, -3f, 26, -3f, 26, 3f, 0, 3f};
                drawPoly(c, pts, color);
                drawPoly(c, new float[]{-9f, -2.5f, -2f, -2.5f, -2f, 2.5f, -9f, 2.5f}, dark);
                drawPoly(c, new float[]{26, -2f, 45f, -2f, 45f, 2f, 26, 2f}, dark);        // cano longo
                drawPoly(c, new float[]{7f, -8f, 17f, -8f, 17f, -3f, 7f, -3f}, light);     // luneta
                drawPoly(c, new float[]{8.5f, -10f, 15.5f, -10f, 15.5f, -8f, 8.5f, -8f}, dark);
                break;
        }
    }

    /** Losango low-poly centralizado. */
    private void drawDiamond(Canvas c, float cx, float cy, float r) {
        Path pt = new Path();
        pt.moveTo(cx, cy - r);
        pt.lineTo(cx + r, cy);
        pt.lineTo(cx, cy + r);
        pt.lineTo(cx - r, cy);
        pt.close();
        c.drawPath(pt, p);
    }

    /** Desenha um polígono preenchido (low-poly). */
    private void drawPoly(Canvas c, float[] pts, int color) {
        Path pt = new Path();
        pt.moveTo(pts[0], pts[1]);
        for (int i = 2; i < pts.length; i += 2) pt.lineTo(pts[i], pts[i + 1]);
        pt.close();
        p.setColor(color);
        c.drawPath(pt, p);
    }

    private static int darken(int color) {
        int r = (color >> 16) & 0xFF, g = (color >> 8) & 0xFF, b = color & 0xFF;
        return (color & 0xFF000000) | (Math.max(0, r - 45) << 16) | (Math.max(0, g - 45) << 8) | Math.max(0, b - 45);
    }

    /** Postes de rua com fios da rede elétrica (catenária). */
    private void drawPoles(Canvas c, MapDef m) {
        if (m.poles == null) return;
        for (int i = 0; i < m.poles.length; i += 2) {
            float px = m.poles[i], py = m.poles[i + 1];
            p.setColor(0x22000000);
            c.drawOval(new RectF(px - 8, py + 2, px + 8, py + 10), p);
            p.setColor(0xFF4A4A52);
            c.drawRect(px - 2.5f, py - 22f, px + 2.5f, py + 4f, p);
            p.setColor(0xFF3A3A42);
            c.drawRect(px - 6f, py - 24f, px + 6f, py - 18f, p); // luminária
            p.setColor(0x55FFE082);
            c.drawRect(px - 5f, py - 24f, px + 5f, py - 22f, p);
            if (i + 2 < m.poles.length) {
                float nx = m.poles[i + 2], ny = m.poles[i + 3];
                float d = (float) Math.hypot(nx - px, ny - py);
                if (d > 40f && d < 620f) {
                    Path wire = new Path();
                    wire.moveTo(px - 4f, py - 22f);
                    wire.quadTo((px + nx) / 2f, (py + ny) / 2f + 42f, nx - 4f, ny - 22f);
                    p.setColor(0x88444444);
                    p.setStrokeWidth(2.5f);
                    p.setStyle(Paint.Style.STROKE);
                    c.drawPath(wire, p);
                    p.setStyle(Paint.Style.FILL);
                }
            }
        }
    }

    /** Veículos estacionados low-poly (cores vivas brasileiras). */
    private void drawCars(Canvas c, MapDef m) {
        if (m.cars == null) return;
        int[] colors = {0xFFE74C3C, 0xFFF1C40F, 0xFFECF0F1, 0xFF3498DB, 0xFF2ECC71, 0xFFE67E22};
        for (int i = 0; i < m.cars.length; i += 3) {
            float cx = m.cars[i], cy = m.cars[i + 1], ang = m.cars[i + 2];
            int col = colors[(i / 3) % colors.length];
            c.save();
            c.translate(cx, cy);
            c.rotate((float) Math.toDegrees(ang));
            p.setColor(0x22000000);
            c.drawRect(-24f, -13f, 24f, 11f, p); // sombra
            // rodas
            p.setColor(0xFF1C1C22);
            c.drawRect(-20f, -11f, -12f, -7f, p);
            c.drawRect(10f, -11f, 18f, -7f, p);
            c.drawRect(-20f, 5f, -12f, 9f, p);
            c.drawRect(10f, 5f, 18f, 9f, p);
            // carroceria (polígono facetado)
            p.setColor(darken(col));
            c.drawRect(-23f, -11f, 23f, 9f, p);
            p.setColor(col);
            c.drawRect(-21f, -10f, 21f, 8f, p);
            p.setColor(lighten(col));
            c.drawRect(-19f, -9f, 19f, -6f, p); // capô iluminado
            // cabine
            p.setColor(0xFF2E3B4E);
            c.drawRect(-10f, -16f, 10f, -8f, p);
            p.setColor(0xFF7FD9FF);
            c.drawRect(-8f, -15f, -2f, -9f, p); // para-brisa
            c.drawRect(2f, -15f, 8f, -9f, p);
            c.restore();
        }
    }

    /** Lojas/comércios com marquise listrada e placa. */
    private void drawAwnings(Canvas c, MapDef m) {
        if (m.awnings == null) return;
        int[][] stripes = {{0xFFE74C3C, 0xFFF5F5F5}, {0xFF2ECC71, 0xFFF5F5F5},
                {0xFFF1C40F, 0xFFF5F5F5}, {0xFF3498DB, 0xFFF5F5F5}};
        for (int i = 0; i < m.awnings.length; i += 4) {
            float ax = m.awnings[i], ay = m.awnings[i + 1], aw = m.awnings[i + 2], ah = m.awnings[i + 3];
            int[] sc = stripes[(i / 4) % stripes.length];
            // sombra
            p.setColor(0x22000000);
            c.drawRect(ax + 3, ay + 4, ax + aw + 3, ay + ah + 4, p);
            // listras da marquise
            float strip = aw / 4f;
            for (int s = 0; s < 4; s++) {
                p.setColor(s % 2 == 0 ? sc[0] : sc[1]);
                c.drawRect(ax + s * strip, ay, ax + (s + 1) * strip, ay + ah, p);
            }
            p.setColor(0x66000000);
            p.setStrokeWidth(2f);
            c.drawLine(ax, ay, ax + aw, ay, p);
            p.setStrokeWidth(1f);
            // suportes
            p.setColor(0xFF6E6259);
            c.drawRect(ax + 2, ay + ah, ax + 6, ay + ah + 10, p);
            c.drawRect(ax + aw - 6, ay + ah, ax + aw - 2, ay + ah + 10, p);
            // placa com nome
            if (m.shopNames != null && i / 4 < m.shopNames.length) {
                String name = m.shopNames[i / 4];
                tp.setTextSize(12f);
                tp.setFakeBoldText(true);
                tp.setTextAlign(Paint.Align.CENTER);
                float bw = Math.min(150f, name.length() * 8f);
                p.setColor(0xFF141B26);
                c.drawRect(ax + aw / 2f - bw / 2f, ay + ah + 12f, ax + aw / 2f + bw / 2f, ay + ah + 26f, p);
                p.setColor(0xFFFFE082);
                c.drawLine(ax + aw / 2f - bw / 2f, ay + ah + 12f, ax + aw / 2f + bw / 2f, ay + ah + 12f, p);
                tp.setColor(0xFFF5F5F5);
                c.drawText(name, ax + aw / 2f, ay + ah + 24f, tp);
                tp.setFakeBoldText(false);
            }
        }
    }

    private void drawHud(Canvas c, PlayerEnt me, float zoom) {
        float s = hudS;
        // joysticks
        if (movePointer != -1) {
            p.setColor(0x22FFFFFF);
            c.drawCircle(moveBaseX, moveBaseY, 66f * s, p);
            p.setColor(0x33FFFFFF);
            c.drawCircle(moveBaseX, moveBaseY, 66f * s, p);
            p.setColor(0xAAFFFFFF);
            c.drawCircle(moveKnobX, moveKnobY, 30f * s, p);
        } else {
            p.setColor(0x11FFFFFF);
            c.drawCircle(120f * s, vh - 120f * s, 66f * s, p);
        }
        if (aimPointer != -1) {
            p.setColor(0x22FFC53D);
            c.drawCircle(aimBaseX, aimBaseY, 66f * s, p);
            p.setColor(0xAAFFC53D);
            c.drawCircle(aimKnobX, aimKnobY, 24f * s, p);
        }

        // botões
        drawBtn(c, fireBtn, "FOGO", 0xFFE8503A, 0xFFFFB3A8, firePointer != -1);
        drawBtn(c, reloadBtn, "REC", 0xFF2468B8, 0xFFB8D9FF, false);
        drawBtn(c, dashBtn, "DASH", 0xFF17A2B8, 0xFFBDF3FF, false);
        drawBtn(c, weaponBtn, "ARMA", 0xFFB7791F, 0xFFFFE9B8, false);
        p.setColor(0xCCFFFFFF);
        p.setTextSize(20f * s);
        p.setTextAlign(Paint.Align.CENTER);
        c.drawText("⏸", pauseBtn.centerX(), pauseBtn.centerY() + 7f * s, p);

        // HUD do jogador local (barras segmentadas low-poly)
        if (me != null) {
            float bx = 16f * s, by = vh - 118f * s;
            // vida
            segBar(c, bx, by, 220f * s, 18f * s, me.hp / PlayerEnt.MAX_HP,
                    me.hp > 55 ? 0xFF3ECF7E : me.hp > 25 ? 0xFFFFC53D : 0xFFE8503A);
            tp.setColor(0xFFF2F5FA);
            tp.setTextSize(12f * s);
            tp.setFakeBoldText(true);
            c.drawText("VIDA " + (int) Math.ceil(me.hp), bx + 8f * s, by + 13f * s, tp);

            // colete
            float ay = by + 24f * s;
            segBar(c, bx, ay, 220f * s, 18f * s, me.armor / PlayerEnt.MAX_ARMOR, 0xFF4FC3F7);
            tp.setTextSize(12f * s);
            tp.setColor(0xFF4FC3F7);
            c.drawText("COLETE " + (int) Math.ceil(me.armor), bx + 8f * s, ay + 13f * s, tp);

            // munição
            Weapons.Def w = Weapons.get(me.weapon);
            tp.setColor(0xFFF2F5FA);
            tp.setTextSize(24f * s);
            c.drawText(me.ammo[me.weapon] + " / " + w.mag, bx, by - 14f * s, tp);
            tp.setTextSize(13f * s);
            tp.setColor(0xFF8FA3C8);
            c.drawText(w.name + "  |  reserva " + me.reserve[me.weapon], bx, by - 28f * s, tp);
            if (me.reloading) {
                tp.setTextSize(13f * s);
                tp.setColor(0xFFFFC53D);
                c.drawText("RECARREGANDO...", bx, by - 42f * s, tp);
            }
            tp.setFakeBoldText(false);
        }

        // placar (painel low-poly)
        float py = 18f * s;
        Path scorePanel = new Path();
        scorePanel.moveTo(8f * s, py - 16f * s);
        scorePanel.lineTo(26f * s, py - 10f * s);
        scorePanel.lineTo(26f * s, py + 6f * s);
        scorePanel.lineTo(8f * s, py + 12f * s);
        scorePanel.close();
        p.setColor(0x990B1020);
        c.drawPath(scorePanel, p);
        p.setColor(0xFF38B6FF);
        p.setStrokeWidth(3f);
        c.drawLine(12f * s, py - 13f * s, 12f * s, py + 9f * s, p);
        p.setStrokeWidth(1f);
        tp.setFakeBoldText(true);
        tp.setTextAlign(Paint.Align.LEFT);
        tp.setTextSize(20f * s);
        if (game.mode == Game.MODE_TDM || game.mode == Game.MODE_LAN_TDM) {
            tp.setColor(0xFFE8503A);
            c.drawText("RIVAIS " + game.scoreRed, 32f * s, py, tp);
            tp.setColor(0xFF38B6FF);
            c.drawText(game.scoreBlue + " POLÍCIA", 32f * s + 170f * s, py, tp);
        } else if (game.mode == Game.MODE_FFA || game.mode == Game.MODE_LAN_FFA) {
            tp.setColor(0xFFF2F5FA);
            c.drawText("TODOS CONTRA TODOS  " + (me != null ? "Abates: " + me.kills : ""), 32f * s, py, tp);
        } else if (game.mode == Game.MODE_TRAIN) {
            tp.setColor(0xFFFFC53D);
            c.drawText("TREINO  " + (me != null ? "Abates: " + me.kills + "   Mortes: " + me.deaths : ""), 32f * s, py, tp);
            tp.setColor(0xFF8FA3C8);
            c.drawText("Pratique à vontade — rivais respawnam sozinhos", 32f * s, py + 22f * s, tp);
        } else {
            tp.setColor(0xFFFFC53D);
            c.drawText("ONDA " + game.wave + "   Vidas: " + Math.max(0, game.lives), 32f * s, py, tp);
            tp.setColor(0xFF8FA3C8);
            c.drawText("Abates: " + (me != null ? me.kills : 0), 32f * s, py + 22f * s, tp);
        }
        // tempo
        if (game.mode != Game.MODE_SURVIVAL && game.mode != Game.MODE_TRAIN) {
            int t = Math.max(0, (int) (Game.MATCH_TIME - game.matchTime));
            tp.setColor(0xFFF2F5FA);
            tp.setTextSize(20f * s);
            tp.setTextAlign(Paint.Align.CENTER);
            c.drawText(String.format("%d:%02d", t / 60, t % 60), vw / 2f, py, tp);
        }

        // sol (clima ensolarado)
        float sx = vw - 74f * s, sy = 78f * s, sr = 15f * s;
        p.setColor(0xFFFFC53D);
        c.drawCircle(sx, sy, sr, p);
        p.setColor(0xFFFFF3B0);
        c.drawCircle(sx, sy, sr * 0.55f, p);
        p.setStrokeWidth(3f);
        p.setColor(0xFFFFC53D);
        for (int i = 0; i < 8; i++) {
            float a = (float) (i * Math.PI / 4f);
            c.drawLine(sx + (float) Math.cos(a) * (sr + 3f), sy + (float) Math.sin(a) * (sr + 3f),
                    sx + (float) Math.cos(a) * (sr + 10f), sy + (float) Math.sin(a) * (sr + 10f), p);
        }
        p.setStrokeWidth(1f);

        // minimapa
        drawMinimap(c, s);

        // feed de abates
        tp.setTextSize(13f * s);
        tp.setTextAlign(Paint.Align.RIGHT);
        float fy = vh - 140f * s;
        for (int i = 0; i < Math.min(4, game.killFeed.size()); i++) {
            Game.FeedItem f = game.killFeed.get(i);
            float age = (System.nanoTime() - f.time) / 1e9f;
            if (age > 5.5f) continue;
            tp.setColor(withAlpha(0xFFF2F5FA, (int) (255 * Math.max(0f, 1f - age / 5.5f))));
            c.drawText(f.text, vw - 14f * s, fy - i * 18f * s, tp);
        }
        tp.setTextAlign(Paint.Align.LEFT);

        // banner
        if (!banner.isEmpty() && System.nanoTime() - bannerAt < 2.5e9f) {
            tp.setTextSize(34f * s);
            tp.setFakeBoldText(true);
            tp.setColor(0xFFFFC53D);
            tp.setTextAlign(Paint.Align.CENTER);
            c.drawText(banner, vw / 2f, vh * 0.32f, tp);
            tp.setFakeBoldText(false);
            tp.setTextAlign(Paint.Align.LEFT);
        }

        // aviso de rede
        if (!netNotice.isEmpty()) {
            tp.setTextSize(14f * s);
            tp.setColor(0xFFFF8FA3);
            tp.setTextAlign(Paint.Align.CENTER);
            c.drawText(netNotice, vw / 2f, vh - 8f * s, tp);
            tp.setTextAlign(Paint.Align.LEFT);
        }

        // vinheta de dano
        if (me != null && me.hp < 45f && me.alive) {
            int a = (int) (60 + (45f - me.hp) * 2f + (me.hitFlash > 0 ? 80 : 0));
            vignette.setShader(new RadialGradient(vw / 2f, vh / 2f, Math.max(vw, vh) * 0.7f,
                    0x00FF0000, (a << 24) | 0xFF0000, Shader.TileMode.CLAMP));
            c.drawRect(0, 0, vw, vh, vignette);
            vignette.setShader(null);
        }

        // FPS
        if (prefs.showFps()) {
            tp.setTextSize(12f * s);
            tp.setColor(0x888FA3C8);
            c.drawText("FPS " + (int) fps + "  " + (me != null ? me.name : ""), 12f * s, vh - 12f * s, tp);
        }

        if (paused) drawPauseOverlay(c, s);
        if (game.matchOver) drawEndOverlay(c, s);
    }

    private void drawBtn(Canvas c, RectF r, String label, int bg, int fg, boolean pressed) {
        p.setColor(pressed ? lighten(bg) : bg);
        c.drawOval(r, p);
        tp.setColor(fg);
        tp.setTextSize(15f * hudS);
        tp.setFakeBoldText(true);
        tp.setTextAlign(Paint.Align.CENTER);
        c.drawText(label, r.centerX(), r.centerY() + 5f * hudS, tp);
        tp.setFakeBoldText(false);
    }

    private void drawMinimap(Canvas c, float s) {
        float mw = 150f * s, mh = mw * game.map.h / game.map.w;
        float mx = vw - mw - 10f * s, my = 60f * s;
        mmPaint.setColor(0xAA0B1020);
        c.drawRoundRect(new RectF(mx, my, mx + mw, my + mh), 6, 6, mmPaint);
        mmPaint.setColor(0x33FFFFFF);
        mmPaint.setStrokeWidth(1f);
        c.drawRoundRect(new RectF(mx, my, mx + mw, my + mh), 6, 6, mmPaint);
        float kx = mw / game.map.w, ky = mh / game.map.h;
        float[] bB = game.map.baseBlue, bR = game.map.baseRed;
        if (bB != null && bB.length >= 4) {
            mmPaint.setColor(0x6638B6FF);
            c.drawRect(mx + bB[0] * kx, my + bB[1] * ky, mx + (bB[0] + bB[2]) * kx, my + (bB[1] + bB[3]) * ky, mmPaint);
        }
        if (bR != null && bR.length >= 4) {
            mmPaint.setColor(0x66E8503A);
            c.drawRect(mx + bR[0] * kx, my + bR[1] * ky, mx + (bR[0] + bR[2]) * kx, my + (bR[1] + bR[3]) * ky, mmPaint);
        }
        float[] ws = game.map.walls;
        mmPaint.setColor(0xFF46586F);
        mmPaint.setStyle(Paint.Style.FILL);
        for (int i = 0; i < ws.length; i += 4) {
            c.drawRect(mx + ws[i] * kx, my + ws[i + 1] * ky,
                    mx + (ws[i] + ws[i + 2]) * kx, my + (ws[i + 1] + ws[i + 3]) * ky, mmPaint);
        }
        mmPaint.setStyle(Paint.Style.FILL);
        for (PlayerEnt pl : game.players) {
            if (pl.leftMatch || !pl.alive) continue;
            mmPaint.setColor(pl.team == PlayerEnt.TEAM_RED ? 0xFFE8503A
                    : pl.team == PlayerEnt.TEAM_BLUE ? 0xFF38B6FF : 0xFFFFFFFF);
            float rr = pl.isLocal ? 5f : 3f;
            float ddx = mx + pl.x * kx, ddy = my + pl.y * ky;
            Path dia = new Path();
            dia.moveTo(ddx, ddy - rr);
            dia.lineTo(ddx + rr, ddy);
            dia.lineTo(ddx, ddy + rr);
            dia.lineTo(ddx - rr, ddy);
            dia.close();
            c.drawPath(dia, mmPaint);
        }
    }

    private void drawPauseOverlay(Canvas c, float s) {
        c.drawColor(0x990B1020);
        tp.setTextSize(30f * s);
        tp.setFakeBoldText(true);
        tp.setTextAlign(Paint.Align.CENTER);
        tp.setColor(0xFFF2F5FA);
        c.drawText("PAUSADO", vw / 2f, vh * 0.34f, tp);
        tp.setFakeBoldText(false);
        float bw = 260f * s, bh = 54f * s;
        pauseResume.set(vw / 2f - bw / 2f, vh * 0.42f, vw / 2f + bw / 2f, vh * 0.42f + bh);
        pauseExit.set(vw / 2f - bw / 2f, vh * 0.42f + bh + 14f * s, vw / 2f + bw / 2f, vh * 0.42f + bh * 2 + 14f * s);
        drawBigBtn(c, pauseResume, "CONTINUAR", 0xFFFFC53D, 0xFF0B1020);
        drawBigBtn(c, pauseExit, "SAIR DO JOGO", 0xFF26354F, 0xFFF2F5FA);
    }

    private void drawEndOverlay(Canvas c, float s) {
        c.drawColor(0xAA0B1020);
        tp.setTextSize(38f * s);
        tp.setFakeBoldText(true);
        tp.setTextAlign(Paint.Align.CENTER);
        tp.setColor(game.localWon ? 0xFF3ECF7E : 0xFFE8503A);
        c.drawText(game.localWon ? "VITÓRIA!" : "DERROTA", vw / 2f, vh * 0.22f, tp);
        tp.setFakeBoldText(false);
        tp.setTextSize(18f * s);
        tp.setColor(0xFFF2F5FA);
        PlayerEnt me = game.localPlayer();
        String line1 = "Abates: " + (me != null ? me.kills : 0) + "   Mortes: " + (me != null ? me.deaths : 0);
        String line2 = "+" + game.xpGain + " XP   +" + game.coinGain + " moedas";
        c.drawText(line1, vw / 2f, vh * 0.32f, tp);
        tp.setColor(0xFFFFC53D);
        c.drawText(line2, vw / 2f, vh * 0.38f, tp);
        if (game.mode == Game.MODE_SURVIVAL) {
            tp.setColor(0xFF8FA3C8);
            c.drawText("Melhor onda alcançada: " + game.wave, vw / 2f, vh * 0.44f, tp);
        }
        float bw = 270f * s, bh = 56f * s;
        endContinue.set(vw / 2f - bw / 2f, vh * 0.52f, vw / 2f + bw / 2f, vh * 0.52f + bh);
        endExit.set(vw / 2f - bw / 2f, vh * 0.52f + bh + 16f * s, vw / 2f + bw / 2f, vh * 0.52f + bh * 2 + 16f * s);
        drawBigBtn(c, endContinue, "CONTINUAR JOGANDO", 0xFFFFC53D, 0xFF0B1020);
        drawBigBtn(c, endExit, "VOLTAR AO MENU", 0xFF26354F, 0xFFF2F5FA);
    }

    private void drawBigBtn(Canvas c, RectF r, String label, int bg, int fg) {
        p.setColor(bg);
        c.drawRoundRect(r, 16, 16, p);
        tp.setColor(fg);
        tp.setTextSize(17f * hudS);
        tp.setFakeBoldText(true);
        tp.setTextAlign(Paint.Align.CENTER);
        c.drawText(label, r.centerX(), r.centerY() + 6f * hudS, tp);
        tp.setFakeBoldText(false);
    }

    private static int withAlpha(int color, int alpha) {
        return (Math.max(0, Math.min(255, alpha)) << 24) | (color & 0x00FFFFFF);
    }

    private static int lighten(int color) {
        int r = Math.min(255, ((color >> 16) & 0xFF) + 40);
        int g = Math.min(255, ((color >> 8) & 0xFF) + 40);
        int b = Math.min(255, (color & 0xFF) + 40);
        return (color & 0xFF000000) | (r << 16) | (g << 8) | b;
    }

    // ------------------------------------------------------------- entrada

    @Override public boolean onTouchEvent(MotionEvent ev) {
        int action = ev.getActionMasked();
        if (action == MotionEvent.ACTION_DOWN || action == MotionEvent.ACTION_POINTER_DOWN) {
            int idx = action == MotionEvent.ACTION_DOWN ? 0 : ev.getActionIndex();
            int id = ev.getPointerId(idx);
            float x = ev.getX(idx), y = ev.getY(idx);
            if (game.matchOver) {
                if (endContinue.contains(x, y)) { onContinue(); return true; }
                if (endExit.contains(x, y)) { exitToMenu(); return true; }
                return true;
            }
            if (paused) {
                if (pauseResume.contains(x, y)) paused = false;
                else if (pauseExit.contains(x, y)) exitToMenu();
                return true;
            }
            if (fireBtn.contains(x, y)) {
                firePointer = id;
                setFire(true, true);
                return true;
            }
            if (reloadBtn.contains(x, y)) { setReload(); return true; }
            if (dashBtn.contains(x, y)) { setDash(); return true; }
            if (weaponBtn.contains(x, y)) { setWeaponSwitch(); return true; }
            if (pauseBtn.contains(x, y)) { paused = true; sfx.play("click"); return true; }
            if (x < vw * 0.36f) {
                movePointer = id; moveBaseX = x; moveBaseY = y;
                moveKnobX = x; moveKnobY = y;
                return true;
            }
            aimPointer = id; aimBaseX = x; aimBaseY = y;
            aimKnobX = x; aimKnobY = y;
            return true;
        } else if (action == MotionEvent.ACTION_MOVE) {
            for (int i = 0; i < ev.getPointerCount(); i++) {
                int id = ev.getPointerId(i);
                float x = ev.getX(i), y = ev.getY(i);
                if (id == movePointer) updateMoveKnob(x, y);
                if (id == aimPointer) updateAimKnob(x, y);
            }
            return true;
        } else if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_POINTER_UP
                || action == MotionEvent.ACTION_CANCEL) {
            int idx = action == MotionEvent.ACTION_UP ? 0 : ev.getActionIndex();
            int id = ev.getPointerId(idx);
            if (id == movePointer) {
                movePointer = -1;
                synchronized (game.input) { game.input.moveX = 0; game.input.moveY = 0; }
            }
            if (id == aimPointer) {
                aimPointer = -1;
                synchronized (game.input) { game.input.aimActive = false; }
            }
            if (id == firePointer) {
                firePointer = -1;
                setFire(false, false);
            }
            return true;
        }
        return super.onTouchEvent(ev);
    }

    private void updateMoveKnob(float x, float y) {
        float R = 66f * hudS * prefs.joystickScale();
        float dx = x - moveBaseX, dy = y - moveBaseY;
        float d = (float) Math.sqrt(dx * dx + dy * dy);
        if (d > R) { dx = dx / d * R; dy = dy / d * R; }
        moveKnobX = moveBaseX + dx;
        moveKnobY = moveBaseY + dy;
        float sens = prefs.sens();
        synchronized (game.input) {
            game.input.moveX = Math.max(-1f, Math.min(1f, dx / R * sens));
            game.input.moveY = Math.max(-1f, Math.min(1f, dy / R * sens));
        }
    }

    private void updateAimKnob(float x, float y) {
        float R = 66f * hudS * prefs.joystickScale();
        float dx = x - aimBaseX, dy = y - aimBaseY;
        float d = (float) Math.sqrt(dx * dx + dy * dy);
        if (d > R) { dx = dx / d * R; dy = dy / d * R; }
        aimKnobX = aimBaseX + dx;
        aimKnobY = aimBaseY + dy;
        float sens = prefs.sens();
        synchronized (game.input) {
            game.input.aimActive = d > R * 0.18f;
            if (game.input.aimActive) {
                game.input.aimX = dx * sens;
                game.input.aimY = dy * sens;
            }
        }
    }

    private void setFire(boolean hold, boolean edge) {
        synchronized (game.input) {
            game.input.fire = hold;
            game.input.firePressed = edge;
        }
    }

    private void setReload() {
        synchronized (game.input) { game.input.reload = true; }
    }

    private void setDash() {
        synchronized (game.input) { game.input.dash = true; }
    }

    private void setWeaponSwitch() {
        synchronized (game.input) { game.input.weaponSwitch = 1; }
        sfx.play("click");
    }

    // ------------------------------------------------------------- ações pós-partida

    private void onContinue() {
        if (!game.matchOver) return;
        saveStats();
        // reinicia apenas a contagem de recompensa visual; mantém overlay
        game.matchOver = false;
        game.waveActive = false;
        game.waveT = 3f;
        game.matchTime = 0;
        game.scoreRed = 0;
        game.scoreBlue = 0;
        game.xpGain = 0;
        game.coinGain = 0;
        game.lives = 3;
        game.wave = 0;
        game.waveBotsAlive = 0;
        for (PlayerEnt p : game.players) {
            if (p.isBot) { p.alive = false; p.leftMatch = true; }
        }
        statsSaved = false;
        PlayerEnt me = game.localPlayer();
        if (me != null) {
            me.kills = 0; me.deaths = 0;
            me.alive = true;
            me.hp = PlayerEnt.MAX_HP;
        }
        if (game.mode == Game.MODE_SURVIVAL) {
            game.waveT = 2.5f;
        }
        // no modo LAN o host decide o fim da partida
        if (game.mode == Game.MODE_LAN_TDM || game.mode == Game.MODE_LAN_FFA) {
            // permite continuar apenas localmente como prática; estado será sobrescrito pelo host
        }
    }

    private void saveStats() {
        if (statsSaved) return;
        statsSaved = true;
        if (Prefs.isGuest) return;
        Account a = Db.get(ctx).get(Prefs.activeAccount);
        if (a == null) return;
        PlayerEnt me = game.localPlayer();
        boolean win = game.localWon;
        int kills = me != null ? me.kills : 0;
        int deaths = me != null ? me.deaths : 0;
        int waveBest = game.mode == Game.MODE_SURVIVAL ? game.wave : 0;
        Db.get(ctx).recordMatch(a, win, kills, deaths, game.xpGain, game.coinGain, waveBest);
        if (game.mode == Game.MODE_LAN_TDM || game.mode == Game.MODE_LAN_FFA) {
            // recompensas LAN são locais (sem servidor de contas na nuvem)
        }
    }

    private void exitToMenu() {
        saveStats();
        if (ctx instanceof android.app.Activity) {
            ((android.app.Activity) ctx).finish();
        }
    }

    // ------------------------------------------------------------- eventos do jogo

    @Override public void sfx(String key) { sfx.play(key); }

    @Override public void onMessage(String msg) {
        banner = msg;
        bannerAt = System.nanoTime();
    }

    public void showNetNotice(String msg) { netNotice = msg; }

    public void onRemoteDisconnect(String reason) {
        netNotice = reason;
        banner = reason;
        bannerAt = System.nanoTime();
        if (!game.matchOver) {
            game.matchOver = true;
            game.localWon = false;
            game.winTeam = -1;
            statsSaved = false;
        }
    }
}
