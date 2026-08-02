package com.strikearena.game.gl;

import android.opengl.GLES20;
import android.opengl.GLSurfaceView;

import com.strikearena.game.core.Bullet;
import com.strikearena.game.core.Game;
import com.strikearena.game.core.MapDef;
import com.strikearena.game.core.Particle;
import com.strikearena.game.core.Pickup;
import com.strikearena.game.core.PlayerEnt;
import com.strikearena.game.core.Skins;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/** Renderer GLES 2.0 low-poly: cidade de blocos, personagens e efeitos leves. */
public class GlRenderer implements GLSurfaceView.Renderer {

    private final Game game;
    private final float resScale;
    public volatile boolean paused;
    private long lastNs;

    private int program;
    private int uMvp;
    private final float[] proj = new float[16], view = new float[16], mvp = new float[16];

    private float aspect = 1.5f;
    private float camX, camZ, camY = 700f;

    private FloatBuffer boxBuf, lineBuf;
    private static final int BOX_FLOATS = 36 * 7;   // 12 triângulos, pos(3)+rgba(4)
    private static final int LINE_FLOATS = 2 * 1024 * 7; // até 1024 segmentos

    // cubo unitário centrado na origem (-0.5..0.5)
    private static final float[] BOX_POS = new float[]{
            // +Y (topo)
            -0.5f, 0.5f, -0.5f, 0.5f, 0.5f, -0.5f, 0.5f, 0.5f, 0.5f, -0.5f, 0.5f, 0.5f,
            // -Y (baixo)
            -0.5f, -0.5f, 0.5f, 0.5f, -0.5f, 0.5f, 0.5f, -0.5f, -0.5f, -0.5f, -0.5f, -0.5f,
            // +X (direita)
            0.5f, 0.5f, 0.5f, 0.5f, 0.5f, -0.5f, 0.5f, -0.5f, -0.5f, 0.5f, -0.5f, 0.5f,
            // -X (esquerda)
            -0.5f, 0.5f, -0.5f, -0.5f, 0.5f, 0.5f, -0.5f, -0.5f, 0.5f, -0.5f, -0.5f, -0.5f,
            // +Z (frente)
            -0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, -0.5f, 0.5f, -0.5f, -0.5f, 0.5f,
            // -Z (trás)
            0.5f, 0.5f, -0.5f, -0.5f, 0.5f, -0.5f, -0.5f, -0.5f, -0.5f, 0.5f, -0.5f, -0.5f
    };
    // brilho por face (luz do sol: topo clara, frente média, etc.)
    private static final float[] FACE_BRIGHT = {1f, 0.42f, 0.78f, 0.6f, 0.88f, 0.52f};

    public GlRenderer(Game game, float resScale) {
        this.game = game;
        this.resScale = Math.max(0.55f, Math.min(1f, resScale));
    }

    // ------------------------------------------------------------ GL ciclo

    @Override public void onSurfaceCreated(GL10 gl, EGLConfig cfg) {
        GLES20.glClearColor(0.36f, 0.68f, 0.96f, 1f); // céu ensolarado
        GLES20.glEnable(GLES20.GL_DEPTH_TEST);
        GLES20.glDepthFunc(GLES20.GL_LEQUAL);
        GLES20.glEnable(GLES20.GL_BLEND);
        GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA);
        boxBuf = ByteBuffer.allocateDirect(BOX_FLOATS * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
        lineBuf = ByteBuffer.allocateDirect(LINE_FLOATS * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
        program = buildProgram();
        uMvp = GLES20.glGetUniformLocation(program, "uMvp");
    }

    @Override public void onSurfaceChanged(GL10 gl, int w, int h) {
        int vw = Math.max(1, Math.round(w * resScale));
        int vh = Math.max(1, Math.round(h * resScale));
        GLES20.glViewport(0, 0, vw, vh);
        aspect = vw / (float) vh;
        camY = Math.max(520f, game.map.w * 0.30f);
    }

    @Override public void onDrawFrame(GL10 gl) {
        try {
            long now = System.nanoTime();
            float dt = Math.min(0.05f, (now - lastNs) / 1e9f);
            lastNs = now;
            if (!paused) {
                synchronized (game) {
                    game.update(dt);
                }
            }
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT | GLES20.GL_DEPTH_BUFFER_BIT);
            updateCamera();
            GlMath.perspective(55f, aspect, 40f, 4200f, proj);
            GlMath.lookAt(camX, camY, camZ, camX, 0f, camZ, view);
            drawWorld();
        } catch (Exception ignored) {
            // nunca derruba o app por um erro de desenho
        }
    }

    private void updateCamera() {
        PlayerEnt me = game.localPlayer();
        float tx = me != null ? me.x : game.map.w / 2f;
        float tz = me != null ? me.y : game.map.h / 2f;
        float dist = Math.max(380f, Math.min(700f, game.map.w * 0.24f));
        camX += (tx - camX) * 0.12f;
        camZ += (tz - camZ) * 0.12f;
        // enquadra dentro do mapa
        camX = Math.max(dist * 0.3f, Math.min(game.map.w - dist * 0.3f, camX));
        camZ = Math.max(dist * 0.3f, Math.min(game.map.h - dist * 0.3f, camZ));
        eyeX = camX; eyeZ = camZ + dist * 0.82f;
        eyeY = camY;
    }

    private float eyeX, eyeY, eyeZ;

    // ------------------------------------------------------------ mundo

    private void drawWorld() {
        MapDef m = game.map;
        // chão
        drawQuad(m.w / 2f, 0f, m.h / 2f, m.w, m.h, 0f, color(m.floorColor, 1f));
        // grade de ruas
        drawGrid(m);
        // bases
        drawBase(m.baseBlue, 0xFF38B6FF);
        drawBase(m.baseRed, 0xFFE8503A);
        // casas/blocos
        float[] ws = m.walls;
        for (int i = 0; i < ws.length; i += 4) {
            drawBuilding(ws[i], ws[i + 1], ws[i + 2], ws[i + 3], m);
        }
        // postes + fios
        if (m.poles != null) drawPoles(m);
        // carros
        if (m.cars != null) drawCars(m);
        // lojas
        if (m.awnings != null) drawAwnings(m);
        // itens
        for (Pickup pk : game.pickups) {
            if (!pk.active) continue;
            int col = pk.type == Pickup.HEALTH ? 0xFF3ECF7E
                    : pk.type == Pickup.ARMOR ? 0xFFFFC53D : 0xFF38B6FF;
            float bob = (float) Math.sin(pk.bob) * 6f;
            drawBox(pk.x, 26f + bob, pk.y, 30f, 30f, 30f, col, 0f);
        }
        // balas
        for (Bullet b : game.bullets) {
            float len = Math.min(30f, (float) Math.hypot(b.vx, b.vy) * 0.03f);
            float ux = b.vx / (float) Math.hypot(b.vx, b.vy), uy = b.vy / (float) Math.hypot(b.vx, b.vy);
            drawLine(b.x - ux * len, 22f, b.y - uy * len,
                    b.x, 22f, b.y, b.team == PlayerEnt.TEAM_RED ? 0xFFFF9A76 : 0xFF7CE0FF);
        }
        // jogadores
        for (PlayerEnt pl : game.players) {
            if (pl.leftMatch || !pl.alive) continue;
            drawPlayer(pl);
        }
        // partículas (caixas pequenas)
        for (Particle pt : game.particles) {
            float a = Math.max(0f, pt.life / pt.maxLife);
            drawBox(pt.x, pt.size * 0.5f, pt.y, pt.size, pt.size, pt.size, withA(pt.color, a), 0f);
        }
    }

    private void drawGrid(MapDef m) {
        float z = viewZoomFallback();
        int x0 = (int) Math.max(0, (camX - 2600f / z));
        int x1 = (int) Math.min(m.w / 100f, (camX + 2600f / z) / 100f);
        int y0 = (int) Math.max(0, (camZ - 2000f / z));
        int y1 = (int) Math.min(m.h / 100f, (camZ + 2000f / z) / 100f);
        int col = m.floorAlt;
        int n = 0;
        lineBuf.clear();
        for (int i = x0; i <= x1; i++) {
            addLineVerts(i * 100f, 0.4f, 0f, i * 100f, 0.4f, m.h, col, n); n += 2;
        }
        for (int j = y0; j <= y1; j++) {
            addLineVerts(0f, 0.4f, j * 100f, m.w, 0.4f, j * 100f, col, n); n += 2;
        }
        flushLines(n);
    }

    private float viewZoomFallback() { return 1f; }

    // ------------------------------------------------------------ objetos

    private void drawBuilding(float wx, float wy, float ww, float wh, MapDef m) {
        float h = 70f + (Math.abs((int) (wx * 7 + wy * 13)) % 5) * 14f; // alturas variadas
        float cx = wx + ww / 2f, cz = wy + wh / 2f;
        drawBox(cx, h / 2f, cz, ww + 2f, h, wh + 2f, m.wallColor, 0f);
        drawBox(cx, h + 3f, cz, ww - 6f, 7f, wh - 6f, m.wallTopColor, 0f);
        // contorno claro (aresta do sol)
        drawBox(cx, h + 12f, cz, ww - 14f, 5f, wh - 14f, 0xFFE8E4D8, 0f);
    }

    private void drawBase(float[] b, int color) {
        if (b == null || b.length < 4) return;
        drawQuad(b[0] + b[2] / 2f, 0.6f, b[1] + b[3] / 2f, b[2], b[3], 0f, withA(color, 0.30f));
        // borda
        int n = 0;
        lineBuf.clear();
        addLineVerts(b[0], 1f, b[1], b[0] + b[2], 1f, b[1], color, n); n += 2;
        addLineVerts(b[0] + b[2], 1f, b[1], b[0] + b[2], 1f, b[1] + b[3], color, n); n += 2;
        addLineVerts(b[0] + b[2], 1f, b[1] + b[3], b[0], 1f, b[1] + b[3], color, n); n += 2;
        addLineVerts(b[0], 1f, b[1] + b[3], b[0], 1f, b[1], color, n); n += 2;
        flushLines(n);
    }

    private void drawPoles(MapDef m) {
        float[] ps = m.poles;
        // fios entre postes consecutivos (catenária aproximada)
        int n = 0;
        lineBuf.clear();
        for (int i = 0; i < ps.length - 2; i += 2) {
            float x1 = ps[i], z1 = ps[i + 1];
            float x2 = ps[i + 2], z2 = ps[i + 3];
            int segs = 8;
            for (int s = 0; s < segs; s++) {
                float t1 = s / (float) segs, t2 = (s + 1) / (float) segs;
                float sag = (float) Math.sin(t1 * Math.PI) * 22f;
                float sag2 = (float) Math.sin(t2 * Math.PI) * 22f;
                addLineVerts(x1 + (x2 - x1) * t1, 252f + sag, z1 + (z2 - z1) * t1,
                        x1 + (x2 - x1) * t2, 252f + sag2, z1 + (z2 - z1) * t2,
                        0xFF1B1B1B, n); n += 2;
            }
        }
        flushLines(n);
        for (int i = 0; i < ps.length; i += 2) {
            drawBox(ps[i], 130f, ps[i + 1], 14f, 260f, 14f, 0xFF6B6B6B, 0f);
            drawBox(ps[i], 266f, ps[i + 1], 34f, 10f, 22f, 0xFF3A3A3A, 0f);
        }
    }

    private void drawCars(MapDef m) {
        float[] cs = m.cars;
        int[] pal = {0xFFD9534F, 0xFFF0AD4E, 0xFF5BC0DE, 0xFF8FBC8F, 0xFFB0BEC5, 0xFF9575CD};
        for (int i = 0; i < cs.length; i += 3) {
            float x = cs[i], z = cs[i + 1], ang = cs[i + 2];
            int col = pal[(i / 3) % pal.length];
            float cx = x + (float) Math.cos(ang) * 0f, cz = z + (float) Math.sin(ang) * 0f;
            drawBox(cx, 26f, cz, 150f, 52f, 88f, col, (float) Math.toDegrees(ang));
            drawBox(cx, 58f, cz, 92f, 30f, 70f, 0xFF223040, (float) Math.toDegrees(ang));
        }
    }

    private void drawAwnings(MapDef m) {
        float[] a = m.awnings;
        for (int i = 0; i < a.length; i += 4) {
            float x = a[i], z = a[i + 1], w = a[i + 2], d = a[i + 3];
            int[] pal = {0xFFE74C3C, 0xFFF39C12, 0xFF3498DB, 0xFF27AE60, 0xFF9B59B6};
            int col = pal[(i / 4) % pal.length];
            drawBox(x + w / 2f, 24f, z + d / 2f, w, 44f, d, col, 0f);
            // listras da marquise
            int stripes = 4;
            float sw = w / stripes;
            for (int s = 0; s < stripes; s++) {
                int sc = s % 2 == 0 ? 0xFFFFFFFF : 0xFF2C3E50;
                drawBox(x + sw * s + sw / 2f, 48f, z + d / 2f, sw - 4f, 6f, d - 8f, sc, 0f);
            }
            // placa vertical
            drawBox(x + w / 2f, 96f, z + d / 2f, Math.min(150f, w * 0.7f), 42f, 10f, 0xFFF7F3E8, 0f);
        }
    }

    // ------------------------------------------------------------ personagem

    private void drawPlayer(PlayerEnt pl) {
        Skins.Def skin = Skins.get(pl.skinId);
        int team = pl.team == PlayerEnt.TEAM_POLICE ? 0xFF38B6FF : 0xFFE8503A;
        float blink = pl.spawnInvuln > 0 ? (Math.sin(pl.spawnInvuln * 20f) > 0 ? 0.45f : 1f) : 1f;
        // sombra
        drawQuad(pl.x, 0.7f, pl.y, 44f, 34f, 0f, withA(0x000000, 0.22f * blink));
        // corpo (baixo + torso)
        drawBox(pl.x, 24f, pl.y, 34f, 44f, 26f, withA(skin.body, blink), 0f);
        // faixa do uniforme da equipe
        drawBox(pl.x, 44f, pl.y, 37f, 9f, 29f, withA(team, blink), 0f);
        // ombreiras
        drawBox(pl.x - 16f, 48f, pl.y, 12f, 10f, 24f, withA(team, blink), 0f);
        drawBox(pl.x + 16f, 48f, pl.y, 12f, 10f, 24f, withA(team, blink), 0f);
        // cabeça + visor
        float hx = pl.x + (float) Math.cos(pl.aim) * 5f;
        float hz = pl.y + (float) Math.sin(pl.aim) * 5f;
        drawBox(hx, 68f, hz, 19f, 19f, 19f, withA(skin.visor, blink), 0f);
        // arma (gira com a mira)
        float rot = (float) Math.toDegrees(pl.aim);
        drawBox(pl.x, 30f, pl.y, 10f, 10f, 54f, withA(skin.sec, blink), rot);
        drawBox(pl.x + (float) Math.cos(pl.aim) * 26f, 32f, pl.y + (float) Math.sin(pl.aim) * 26f,
                7f, 7f, 20f, withA(0xFF1B1B1B, blink), rot);
        // barra de vida (rival): capa acima da cabeça
        if (pl != game.localPlayer()) {
            float frac = Math.max(0f, pl.hp / PlayerEnt.MAX_HP);
            int hcol = pl.hp > 55 ? 0xFF3ECF7E : pl.hp > 25 ? 0xFFFFC53D : 0xFFE8503A;
            drawBox(pl.x - 22f + 22f * frac, 86f, pl.y, 44f * frac, 6f, 8f, hcol, 0f);
            drawBox(pl.x, 80f, pl.y, 46f, 3f, 9f, 0xAA000000, 0f);
        }
    }

    // ------------------------------------------------------------ primitivas

    private void drawQuad(float cx, float y, float cz, float w, float d, float rotDeg, int color) {
        float hw = w / 2f, hd = d / 2f;
        float r = (float) Math.toRadians(rotDeg);
        float cos = (float) Math.cos(r), sin = (float) Math.sin(r);
        float[] verts = new float[6 * 7];
        float[][] pts = {{-hw, -hd}, {hw, -hd}, {hw, hd}, {-hw, -hd}, {hw, hd}, {-hw, hd}};
        float cr = ((color >> 16) & 0xFF) / 255f, cg = ((color >> 8) & 0xFF) / 255f,
                cb = (color & 0xFF) / 255f, ca = ((color >> 24) & 0xFF) / 255f;
        for (int i = 0; i < 6; i++) {
            float lx = pts[i][0], lz = pts[i][1];
            float wx2 = lx * cos - lz * sin, wz2 = lx * sin + lz * cos;
            int o = i * 7;
            verts[o] = cx + wx2; verts[o + 1] = y; verts[o + 2] = cz + wz2;
            verts[o + 3] = cr; verts[o + 4] = cg; verts[o + 5] = cb; verts[o + 6] = ca;
        }
        GLES20.glUseProgram(program);
        mvpSet(0f, 0f, 0f, 0f);
        boxBuf.clear();
        boxBuf.put(verts);
        boxBuf.flip();
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, 0);
        GLES20.glVertexAttribPointer(0, 3, GLES20.GL_FLOAT, false, 28, boxBuf);
        GLES20.glEnableVertexAttribArray(0);
        boxBuf.position(3);
        GLES20.glVertexAttribPointer(1, 4, GLES20.GL_FLOAT, false, 28, boxBuf);
        GLES20.glEnableVertexAttribArray(1);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, 6);
    }

    /** Caixa low-poly com faces sombreadas. */
    private void drawBox(float cx, float cy, float cz, float w, float h, float d, int color, float rotYDeg) {
        float cr = ((color >> 16) & 0xFF) / 255f, cg = ((color >> 8) & 0xFF) / 255f,
                cb = (color & 0xFF) / 255f, ca = ((color >> 24) & 0xFF) / 255f;
        boxBuf.clear();
        for (int f = 0; f < 6; f++) {
            float br = FACE_BRIGHT[f];
            for (int v = 0; v < 6; v++) {
                int o = (f * 6 + v) * 7;
                boxBuf.put(BOX_POS[f * 12 + v * 3]);
                boxBuf.put(BOX_POS[f * 12 + v * 3 + 1]);
                boxBuf.put(BOX_POS[f * 12 + v * 3 + 2]);
                boxBuf.put(cr * br); boxBuf.put(cg * br); boxBuf.put(cb * br); boxBuf.put(ca);
            }
        }
        boxBuf.flip();
        GLES20.glUseProgram(program);
        float[] m = GlMath.model(cx, cy, cz, rotYDeg, w, h, d);
        float[] pv = new float[16];
        GlMath.multiply(proj, view, pv);
        GlMath.multiply(pv, m, mvp);
        GLES20.glUniformMatrix4fv(uMvp, 1, false, mvp, 0);
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, 0);
        GLES20.glVertexAttribPointer(0, 3, GLES20.GL_FLOAT, false, 28, boxBuf);
        GLES20.glEnableVertexAttribArray(0);
        boxBuf.position(3);
        GLES20.glVertexAttribPointer(1, 4, GLES20.GL_FLOAT, false, 28, boxBuf);
        GLES20.glEnableVertexAttribArray(1);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, 36);
    }

    private void mvpSet(float x, float y, float z, float rot) {
        float[] m = GlMath.model(x, y, z, rot, 1f, 1f, 1f);
        float[] pv = new float[16];
        GlMath.multiply(proj, view, pv);
        GlMath.multiply(pv, m, mvp);
        GLES20.glUniformMatrix4fv(uMvp, 1, false, mvp, 0);
    }

    private void drawLine(float x1, float y1, float z1, float x2, float y2, float z2, int color) {
        lineBuf.clear();
        addLineVerts(x1, y1, z1, x2, y2, z2, color, 0);
        flushLines(2);
    }

    private void addLineVerts(float x1, float y1, float z1, float x2, float y2, float z2, int color, int n) {
        float cr = ((color >> 16) & 0xFF) / 255f, cg = ((color >> 8) & 0xFF) / 255f,
                cb = (color & 0xFF) / 255f, ca = ((color >> 24) & 0xFF) / 255f;
        if (n + 14 > lineBuf.capacity()) return;
        lineBuf.put(x1); lineBuf.put(y1); lineBuf.put(z1);
        lineBuf.put(cr); lineBuf.put(cg); lineBuf.put(cb); lineBuf.put(ca);
        lineBuf.put(x2); lineBuf.put(y2); lineBuf.put(z2);
        lineBuf.put(cr); lineBuf.put(cg); lineBuf.put(cb); lineBuf.put(ca);
    }

    private void flushLines(int count) {
        lineBuf.flip();
        GLES20.glUseProgram(program);
        float[] pv = new float[16];
        GlMath.multiply(proj, view, pv);
        GLES20.glUniformMatrix4fv(uMvp, 1, false, pv, 0);
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, 0);
        GLES20.glVertexAttribPointer(0, 3, GLES20.GL_FLOAT, false, 28, lineBuf);
        GLES20.glEnableVertexAttribArray(0);
        lineBuf.position(3);
        GLES20.glVertexAttribPointer(1, 4, GLES20.GL_FLOAT, false, 28, lineBuf);
        GLES20.glEnableVertexAttribArray(1);
        GLES20.glDrawArrays(GLES20.GL_LINES, 0, count);
    }

    // ------------------------------------------------------------ shaders

    private static int buildProgram() {
        String vs = "attribute vec3 aPos; attribute vec4 aColor; uniform mat4 uMvp;"
                + "varying vec4 vColor; void main(){ vColor = aColor;"
                + " gl_Position = uMvp * vec4(aPos, 1.0); }";
        String fs = "precision mediump float; varying vec4 vColor;"
                + "void main(){ gl_FragColor = vColor; }";
        int v = GLES20.glCreateShader(GLES20.GL_VERTEX_SHADER);
        GLES20.glShaderSource(v, vs);
        GLES20.glCompileShader(v);
        int f = GLES20.glCreateShader(GLES20.GL_FRAGMENT_SHADER);
        GLES20.glShaderSource(f, fs);
        GLES20.glCompileShader(f);
        int pr = GLES20.glCreateProgram();
        GLES20.glAttachShader(pr, v);
        GLES20.glAttachShader(pr, f);
        GLES20.glBindAttribLocation(pr, 0, "aPos");
        GLES20.glBindAttribLocation(pr, 1, "aColor");
        GLES20.glLinkProgram(pr);
        return pr;
    }

    // ------------------------------------------------------------ cores

    static int color(int argb, float alpha) { return withA(argb, alpha); }

    static int withA(int argb, float alpha) {
        int a = Math.max(0, Math.min(255, Math.round(((argb >>> 24) & 0xFF) * alpha)));
        return (a << 24) | (argb & 0x00FFFFFF);
    }
}
