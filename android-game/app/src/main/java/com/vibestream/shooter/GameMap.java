package com.vibestream.shooter;

import android.graphics.*;

/**
 * Mapa urbano inspirado em uma comunidade brasileira:
 * prédios, ruas, vielas, carros, bancos e pontos de referência.
 */
public class GameMap {
    private int screenW, screenH;
    private RectF[] buildings;
    private RectF[] covers;
    private RectF[] streets;
    private float[][] trees;   // x, y, radius
    private float[][] cars;    // x, y, w, h, angle
    private float[][] benches; // x, y, angle
    
    public GameMap(int screenW, int screenH) {
        this.screenW = screenW; this.screenH = screenH;
        
        // Prédios da comunidade (blocos de moradia)
        buildings = new RectF[] {
            new RectF(screenW * 0.03f, screenH * 0.08f, screenW * 0.18f, screenH * 0.35f),
            new RectF(screenW * 0.03f, screenH * 0.65f, screenW * 0.18f, screenH * 0.92f),
            new RectF(screenW * 0.82f, screenH * 0.08f, screenW * 0.97f, screenH * 0.35f),
            new RectF(screenW * 0.82f, screenH * 0.65f, screenW * 0.97f, screenH * 0.92f),
            new RectF(screenW * 0.25f, screenH * 0.05f, screenW * 0.42f, screenH * 0.15f),
            new RectF(screenW * 0.58f, screenH * 0.85f, screenW * 0.75f, screenH * 0.95f),
        };
        
        // Vielas e becos (caminhos entre prédios)
        streets = new RectF[] {
            new RectF(screenW * 0.2f, 0, screenW * 0.24f, screenH),
            new RectF(screenW * 0.76f, 0, screenW * 0.80f, screenH),
            new RectF(0, screenH * 0.45f, screenW, screenH * 0.48f),
            new RectF(0, screenH * 0.55f, screenW, screenH * 0.58f),
        };
        
        // Coberturas (barracos, pontos de apoio)
        covers = new RectF[] {
            new RectF(screenW * 0.28f, screenH * 0.30f, screenW * 0.35f, screenH * 0.40f),
            new RectF(screenW * 0.65f, screenH * 0.30f, screenW * 0.72f, screenH * 0.40f),
            new RectF(screenW * 0.28f, screenH * 0.60f, screenW * 0.35f, screenH * 0.70f),
            new RectF(screenW * 0.65f, screenH * 0.60f, screenW * 0.72f, screenH * 0.70f),
            new RectF(screenW * 0.42f, screenH * 0.25f, screenW * 0.48f, screenH * 0.35f),
            new RectF(screenW * 0.52f, screenH * 0.65f, screenW * 0.58f, screenH * 0.75f),
        };
        
        // Árvores da comunidade
        trees = new float[][] {
            {screenW * 0.10f, screenH * 0.50f, 12f},
            {screenW * 0.20f, screenH * 0.25f, 10f},
            {screenW * 0.80f, screenH * 0.25f, 10f},
            {screenW * 0.90f, screenH * 0.50f, 12f},
            {screenW * 0.20f, screenH * 0.75f, 11f},
            {screenW * 0.80f, screenH * 0.75f, 11f},
            {screenW * 0.50f, screenH * 0.20f, 9f},
            {screenW * 0.50f, screenH * 0.80f, 9f},
        };
        
        // Carros estacionados nas ruas
        cars = new float[][] {
            {screenW * 0.32f, screenH * 0.46f, screenW * 0.06f, screenH * 0.016f, 0f},
            {screenW * 0.50f, screenH * 0.47f, screenW * 0.06f, screenH * 0.016f, 0f},
            {screenW * 0.68f, screenH * 0.56f, screenW * 0.06f, screenH * 0.016f, 0f},
            {screenW * 0.45f, screenH * 0.57f, screenW * 0.06f, screenH * 0.016f, 0f},
        };
        
        // Bancos de praça
        benches = new float[][] {
            {screenW * 0.12f, screenH * 0.42f, 0f},
            {screenW * 0.88f, screenH * 0.42f, 0f},
            {screenW * 0.12f, screenH * 0.58f, 0f},
            {screenW * 0.88f, screenH * 0.58f, 0f},
        };
    }
    
    public void draw(Canvas canvas, float scale) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        
        // Ground - concrete/asphalt
        p.setColor(Color.parseColor("#14141f"));
        canvas.drawRect(0, 0, screenW, screenH, p);
        
        // Streets (ruas) - asphalt color
        p.setColor(Color.parseColor("#1a1a28"));
        for (RectF s : streets) {
            canvas.drawRect(s, p);
        }
        
        // Street markings
        p.setColor(Color.parseColor("#2a2a3d"));
        p.setStrokeWidth(2 * scale);
        for (RectF s : streets) {
            if (s.width() < s.height()) {
                // Vertical street
                for (float y = 0; y < screenH; y += 60 * scale) {
                    canvas.drawRect(s.centerX() - 3 * scale, y, s.centerX() + 3 * scale, y + 20 * scale, p);
                }
            } else {
                // Horizontal street
                for (float x = 0; x < screenW; x += 60 * scale) {
                    canvas.drawRect(x, s.centerY() - 3 * scale, x + 20 * scale, s.centerY() + 3 * scale, p);
                }
            }
        }
        
        // Buildings (prédios da comunidade)
        for (int i = 0; i < buildings.length; i++) {
            RectF b = buildings[i];
            int color = (i % 3 == 0) ? Color.parseColor("#2a2a44") : 
                        (i % 3 == 1) ? Color.parseColor("#252540") : Color.parseColor("#20203a");
            p.setColor(color);
            canvas.drawRect(b, p);
            
            // Building border
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(2);
            p.setColor(Color.parseColor("#3a3a55"));
            canvas.drawRect(b, p);
            p.setStyle(Paint.Style.FILL);
            
            // Windows
            p.setColor(Color.parseColor("#4a4a70"));
            float winW = b.width() * 0.12f;
            float winH = b.height() * 0.08f;
            for (float wx = b.left + b.width() * 0.1f; wx < b.right - winW; wx += b.width() * 0.25f) {
                for (float wy = b.top + b.height() * 0.1f; wy < b.bottom - winH; wy += b.height() * 0.18f) {
                    canvas.drawRect(wx, wy, wx + winW, wy + winH, p);
                    // Some windows lit
                    if ((int)(wx * 7 + wy * 13) % 3 == 0) {
                        p.setColor(Color.parseColor("#FFD700"));
                        canvas.drawRect(wx + 1, wy + 1, wx + winW - 1, wy + winH - 1, p);
                        p.setColor(Color.parseColor("#4a4a70"));
                    }
                }
            }
        }
        
        // Trees (árvores)
        for (float[] t : trees) {
            // Trunk
            p.setColor(Color.parseColor("#5a3a1a"));
            canvas.drawRect(t[0] - 2 * scale, t[1], t[0] + 2 * scale, t[1] + 15 * scale, p);
            // Leaves
            p.setColor(Color.parseColor("#2d8a3d"));
            canvas.drawCircle(t[0], t[1] - 5 * scale, t[2] * scale, p);
            p.setColor(Color.parseColor("#3aa54a"));
            canvas.drawCircle(t[0] - 3 * scale, t[1] - 8 * scale, t[2] * 0.7f * scale, p);
            canvas.drawCircle(t[0] + 3 * scale, t[1] - 8 * scale, t[2] * 0.7f * scale, p);
        }
        
        // Cars (carros estacionados)
        for (float[] c : cars) {
            canvas.save();
            canvas.rotate(c[4], c[0], c[1]);
            p.setColor((int)(c[0] * 100) % 2 == 0 ? Color.parseColor("#e74c3c") : Color.parseColor("#3498db"));
            canvas.drawRoundRect(c[0] - c[2] / 2, c[1] - c[3] / 2, c[0] + c[2] / 2, c[1] + c[3] / 2, 4 * scale, 4 * scale, p);
            // Windows
            p.setColor(Color.parseColor("#88ccee"));
            canvas.drawRect(c[0] - c[2] * 0.3f, c[1] - c[3] * 0.4f, c[0] + c[2] * 0.3f, c[1] + c[3] * 0.4f, p);
            canvas.restore();
        }
        
        // Benches (bancos de praça)
        for (float[] b : benches) {
            canvas.save();
            canvas.rotate(b[2], b[0], b[1]);
            p.setColor(Color.parseColor("#8a6d3b"));
            canvas.drawRoundRect(b[0] - 20 * scale, b[1] - 4 * scale, b[0] + 20 * scale, b[1] + 4 * scale, 3, 3, p);
            // Legs
            canvas.drawRect(b[0] - 15 * scale, b[1] + 4 * scale, b[0] - 11 * scale, b[1] + 10 * scale, p);
            canvas.drawRect(b[0] + 11 * scale, b[1] + 4 * scale, b[0] + 15 * scale, b[1] + 10 * scale, p);
            canvas.restore();
        }
        
        // Covers (barracos / pontos de apoio)
        for (RectF c : covers) {
            p.setColor(Color.parseColor("#333355"));
            canvas.drawRoundRect(c, 8, 8, p);
            p.setStyle(Paint.Style.STROKE);
            p.setColor(Color.parseColor("#444466"));
            p.setStrokeWidth(2);
            canvas.drawRoundRect(c, 8, 8, p);
            p.setStyle(Paint.Style.FILL);
            
            // Roof highlight
            p.setColor(0x33888888);
            canvas.drawRect(c.left, c.top, c.right, c.top + 4 * scale, p);
        }
        
        // Community flags/graffiti decorations
        p.setColor(Color.parseColor("#6C5CE7"));
        p.setStrokeWidth(3 * scale);
        canvas.drawLine(screenW * 0.50f, screenH * 0.10f, screenW * 0.50f, screenH * 0.30f, p);
        p.setColor(Color.parseColor("#FFD700"));
        canvas.drawRect(screenW * 0.50f, screenH * 0.08f, screenW * 0.54f, screenH * 0.14f, p);
    }
    
    public RectF[] getWalls() { return buildings; }
    public RectF[] getCovers() { return covers; }
}
