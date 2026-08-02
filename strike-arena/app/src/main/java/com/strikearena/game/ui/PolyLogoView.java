package com.strikearena.game.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.view.View;

/** Emblema LOW-POLY do VibeStrike 2D (menu). */
public class PolyLogoView extends View {
    private final Paint p = new Paint();

    public PolyLogoView(Context c) {
        super(c);
        p.setAntiAlias(true);
    }

    @Override protected void onMeasure(int w, int h) {
        int d = (int) (Ui.dp(getContext(), 96));
        setMeasuredDimension(d, d);
    }

    @Override protected void onDraw(Canvas c) {
        float cx = getWidth() / 2f, cy = getHeight() / 2f;
        float r = Math.min(getWidth(), getHeight()) * 0.46f;

        // losango facetado
        Path dia = new Path();
        dia.moveTo(cx, cy - r);
        dia.lineTo(cx + r * 0.95f, cy);
        dia.lineTo(cx, cy + r);
        dia.lineTo(cx - r * 0.95f, cy);
        dia.close();
        p.setColor(0xFF1A2438);
        c.drawPath(dia, p);
        // facetas de luz
        Path light = new Path();
        light.moveTo(cx, cy - r);
        light.lineTo(cx + r * 0.95f, cy);
        light.lineTo(cx, cy + r * 0.15f);
        light.close();
        p.setColor(0xFF2E3E63);
        c.drawPath(light, p);
        // borda
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(4f);
        p.setColor(0xFFFFC53D);
        c.drawPath(dia, p);
        p.setStyle(Paint.Style.FILL);

        // "V" low-poly
        Path v = new Path();
        v.moveTo(cx - r * 0.42f, cy - r * 0.4f);
        v.lineTo(cx - r * 0.15f, cy + r * 0.45f);
        v.lineTo(cx, cy + r * 0.18f);
        v.lineTo(cx + r * 0.42f, cy - r * 0.4f);
        v.lineTo(cx + r * 0.24f, cy - r * 0.4f);
        v.lineTo(cx, cy + r * 0.05f);
        v.lineTo(cx - r * 0.24f, cy - r * 0.4f);
        v.close();
        p.setColor(0xFF38B6FF);
        c.drawPath(v, p);

        // estrela (ponto de mira)
        p.setColor(0xFFE8503A);
        float sx = cx - r * 0.15f, sy = cy - r * 0.28f;
        c.drawCircle(sx, sy, r * 0.12f, p);
        p.setColor(0xFFFFC53D);
        c.drawCircle(sx, sy, r * 0.05f, p);
    }
}
