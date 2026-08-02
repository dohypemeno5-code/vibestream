package com.strikearena.game.gl;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Shader;
import android.view.MotionEvent;
import android.view.View;

import com.strikearena.game.audio.SoundManager;
import com.strikearena.game.core.Game;
import com.strikearena.game.core.PlayerEnt;
import com.strikearena.game.core.Weapons;
import com.strikearena.game.data.Account;
import com.strikearena.game.data.Db;
import com.strikearena.game.data.Prefs;

/** HUD 3D: barras, placar, minimapa, joysticks e botões (Canvas sobre o GL). */
public class HudOverlay extends View implements Game.Listener {

    public final Game game;
    private final SoundManager sfx;
    private final Prefs prefs;
    private final Context ctx;

    private float vw, vh, hudS;
    private boolean paused;
    private String banner = "";
    private long bannerAt;
    private String netNotice = "";
    private boolean statsSaved;

    private int movePointer = -1, aimPointer = -1, firePointer = -1;
    private float moveBaseX, moveBaseY, moveKnobX, moveKnobY;
    private float aimBaseX, aimBaseY, aimKnobX, aimKnobY;
    private final RectF fireBtn = new RectF(), reloadBtn = new RectF(), dashBtn = new RectF(),
            weaponBtn = new RectF(), pauseBtn = new RectF();
    private final RectF endContinue = new RectF(), endExit = new RectF(),
            pauseResume = new RectF(), pauseExit = new RectF();

    private final Paint p = new Paint();
    private final Paint tp = new Paint();
    private final Paint hpPaint = new Paint();
    private final Paint mmPaint = new Paint();
    private final Paint vignette = new Paint();

    public HudOverlay(Context c, Game game) {
        super(c);
        this.ctx = c;
        this.game = game;
        this.sfx = SoundManager.get(c);
        this.prefs = Prefs.get(c);
        setFocusable(true);
        game.listener = this;
        game.aimAssist = prefs.aimAssist();
        p.setAntiAlias(true);
        tp.setAntiAlias(true);
        hpPaint.setAntiAlias(true);
        mmPaint.setAntiAlias(true);
        vignette.setAntiAlias(true);
    }

    @Override protected void onSizeChanged(int w, int h, int ow, int oh) {
        vw = w; vh = h;
        hudS = Math.min(w, h) / 640f;
        layoutButtons();
    }

    public void pauseGame() { paused = true; sfx.stopAmbient(); }
    public void resumeGame() { paused = false; sfx.startAmbient(); }
    public void shutdown() { sfx.stopAmbient(); }

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

    @Override protected void onDraw(Canvas c) {
        if (vw <= 0 || vh <= 0) return;
        drawHud(c);
    }

    // ------------------------------------------------------------- HUD

    private void drawHud(Canvas c) {
        float s = hudS;
        PlayerEnt me = game.localPlayer();
        if (movePointer != -1) {
            p.setColor(0x22FFFFFF);
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

        drawBtn(c, fireBtn, "FOGO", 0xFFE8503A, 0xFFFFB3A8, firePointer != -1);
        drawBtn(c, reloadBtn, "REC", 0xFF2468B8, 0xFFB8D9FF, false);
        drawBtn(c, dashBtn, "DASH", 0xFF17A2B8, 0xFFBDF3FF, false);
        drawBtn(c, weaponBtn, "ARMA", 0xFFB7791F, 0xFFFFE9B8, false);
        p.setColor(0xCCFFFFFF);
        p.setTextSize(20f * s);
        p.setTextAlign(Paint.Align.CENTER);
        c.drawText("⏸", pauseBtn.centerX(), pauseBtn.centerY() + 7f * s, p);

        if (me != null) {
            float bx = 16f * s, by = vh - 118f * s;
            segBar(c, bx, by, 220f * s, 18f * s, me.hp / PlayerEnt.MAX_HP,
                    me.hp > 55 ? 0xFF3ECF7E : me.hp > 25 ? 0xFFFFC53D : 0xFFE8503A);
            tp.setColor(0xFFF2F5FA);
            tp.setTextSize(12f * s);
            tp.setFakeBoldText(true);
            c.drawText("VIDA " + (int) Math.ceil(me.hp), bx + 8f * s, by + 13f * s, tp);

            float ay = by + 24f * s;
            segBar(c, bx, ay, 220f * s, 18f * s, me.armor / PlayerEnt.MAX_ARMOR, 0xFF4FC3F7);
            tp.setTextSize(12f * s);
            tp.setColor(0xFF4FC3F7);
            c.drawText("COLETE " + (int) Math.ceil(me.armor), bx + 8f * s, ay + 13f * s, tp);

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

        float py = 18f * s;
        tp.setFakeBoldText(true);
        tp.setTextAlign(Paint.Align.LEFT);
        tp.setTextSize(20f * s);
        if (game.mode == Game.MODE_TDM || game.mode == Game.MODE_LAN_TDM) {
            tp.setColor(0xFFE8503A);
            c.drawText("RIVAIS " + game.scoreRed, 16f * s, py, tp);
            tp.setColor(0xFF38B6FF);
            c.drawText(game.scoreBlue + " POLÍCIA", 16f * s + 160f * s, py, tp);
        } else if (game.mode == Game.MODE_FFA || game.mode == Game.MODE_LAN_FFA) {
            tp.setColor(0xFFF2F5FA);
            c.drawText("TODOS CONTRA TODOS  " + (me != null ? "Abates: " + me.kills : ""), 16f * s, py, tp);
        } else if (game.mode == Game.MODE_TRAIN) {
            tp.setColor(0xFFFFC53D);
            c.drawText("TREINO  " + (me != null ? "Abates: " + me.kills + "   Mortes: " + me.deaths : ""), 16f * s, py, tp);
        } else {
            tp.setColor(0xFFFFC53D);
            c.drawText("ONDA " + game.wave + "   Vidas: " + Math.max(0, game.lives), 16f * s, py, tp);
            tp.setColor(0xFF8FA3C8);
            c.drawText("Abates: " + (me != null ? me.kills : 0), 16f * s, py + 22f * s, tp);
        }

        if (game.mode != Game.MODE_SURVIVAL && game.mode != Game.MODE_TRAIN) {
            int t = Math.max(0, (int) (Game.MATCH_TIME - game.matchTime));
            tp.setColor(0xFFF2F5FA);
            tp.setTextSize(20f * s);
            tp.setTextAlign(Paint.Align.CENTER);
            c.drawText(String.format("%d:%02d", t / 60, t % 60), vw / 2f, py, tp);
        }

        // sol
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

        drawMinimap(c, s);

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

        if (!banner.isEmpty() && System.nanoTime() - bannerAt < 2.5e9f) {
            tp.setTextSize(34f * s);
            tp.setFakeBoldText(true);
            tp.setColor(0xFFFFC53D);
            tp.setTextAlign(Paint.Align.CENTER);
            c.drawText(banner, vw / 2f, vh * 0.32f, tp);
            tp.setFakeBoldText(false);
            tp.setTextAlign(Paint.Align.LEFT);
        }

        if (!netNotice.isEmpty()) {
            tp.setTextSize(14f * s);
            tp.setColor(0xFFFF8FA3);
            tp.setTextAlign(Paint.Align.CENTER);
            c.drawText(netNotice, vw / 2f, vh - 8f * s, tp);
            tp.setTextAlign(Paint.Align.LEFT);
        }

        if (me != null && me.hp < 45f && me.alive) {
            int a = (int) (60 + (45f - me.hp) * 2f + (me.hitFlash > 0 ? 80 : 0));
            vignette.setShader(new RadialGradient(vw / 2f, vh / 2f, Math.max(vw, vh) * 0.7f,
                    0x00FF0000, (a << 24) | 0xFF0000, Shader.TileMode.CLAMP));
            c.drawRect(0, 0, vw, vh, vignette);
            vignette.setShader(null);
        }

        if (paused) drawPauseOverlay(c, s);
        if (game.matchOver) drawEndOverlay(c, s);
    }

    private void segBar(Canvas c, float x, float y, float w, float h, float frac, int color) {
        int segs = 10;
        float gw = (w - (segs - 1) * 2f) / segs;
        hpPaint.setColor(0xAA000000);
        c.drawRoundRect(new RectF(x - 1, y - 1, x + w + 1, y + h + 1), 6, 6, hpPaint);
        int filled = (int) Math.ceil(segs * Math.max(0f, Math.min(1f, frac)));
        for (int i = 0; i < filled; i++) {
            hpPaint.setColor(color);
            c.drawRoundRect(new RectF(x + i * (gw + 2f), y, x + i * (gw + 2f) + gw, y + h), 3, 3, hpPaint);
        }
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
            float rr = pl.isLocal ? 4f : 2.5f;
            c.drawCircle(mx + pl.x * kx, my + pl.y * ky, rr, mmPaint);
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

    // ------------------------------------------------------------- ações

    private void onContinue() {
        if (!game.matchOver) return;
        saveStats();
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
            me.armor = PlayerEnt.MAX_ARMOR * 0.5f;
        }
        if (game.mode == Game.MODE_SURVIVAL) game.waveT = 2.5f;
    }

    private void saveStats() {
        if (statsSaved) return;
        statsSaved = true;
        if (Prefs.isGuest) return;
        try {
            Account a = Db.get(ctx).get(Prefs.activeAccount);
            if (a == null) return;
            PlayerEnt me = game.localPlayer();
            boolean win = game.localWon;
            int kills = me != null ? me.kills : 0;
            int deaths = me != null ? me.deaths : 0;
            int waveBest = game.mode == Game.MODE_SURVIVAL ? game.wave : 0;
            Db.get(ctx).recordMatch(a, win, kills, deaths, game.xpGain, game.coinGain, waveBest);
        } catch (Exception ignored) {}
    }

    private void exitToMenu() {
        saveStats();
        if (ctx instanceof android.app.Activity) {
            ((android.app.Activity) ctx).finish();
        }
    }

    // ------------------------------------------------------------- eventos

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
