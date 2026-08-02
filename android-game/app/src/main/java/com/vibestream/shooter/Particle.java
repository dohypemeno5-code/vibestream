package com.vibestream.shooter;

import android.graphics.*;

public class Particle {
    private float x, y, dx, dy;
    private int color, life, maxLife;
    
    public Particle(float x, float y, float dx, float dy, int color, int life) {
        this.x = x; this.y = y;
        this.dx = dx; this.dy = dy;
        this.color = color;
        this.life = life;
        this.maxLife = life;
    }
    
    public void update() {
        x += dx;
        y += dy;
        dx *= 0.95f;
        dy *= 0.95f;
        life--;
    }
    
    public void draw(Canvas canvas) {
        if (life <= 0) return;
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(color);
        p.setAlpha((int)(255 * (life / (float) maxLife)));
        canvas.drawCircle(x, y, Math.max(1, life / 3f), p);
    }
    
    public boolean isDead() { return life <= 0; }
}
