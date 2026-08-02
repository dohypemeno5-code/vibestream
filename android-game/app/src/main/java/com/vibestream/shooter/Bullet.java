package com.vibestream.shooter;

import android.graphics.*;

public class Bullet {
    private float x, y, dx, dy, speed, radius;
    private boolean active = true, isPlayerBullet;
    private int color;
    
    public Bullet(float x, float y, float angle, float speed, boolean isPlayer) {
        this.x = x; this.y = y;
        this.speed = speed;
        this.isPlayerBullet = isPlayer;
        this.dx = (float) Math.cos(angle) * speed;
        this.dy = (float) Math.sin(angle) * speed;
        this.radius = isPlayer ? 6 : 5;
        this.color = isPlayer ? 0xFFFFD700 : 0xFFFF4444;
    }
    
    public void update() {
        x += dx;
        y += dy;
    }
    
    public void draw(Canvas canvas, float scale) {
        if (!active) return;
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(color);
        canvas.drawCircle(x, y, radius, p);
        
        // Glow effect
        p.setAlpha(80);
        canvas.drawCircle(x, y, radius * 2, p);
    }
    
    public float getX() { return x; }
    public float getY() { return y; }
    public boolean isActive() { return active; }
    public void deactivate() { active = false; }
    public boolean isPlayerBullet() { return isPlayerBullet; }
}
