package com.vibestream.shooter;

import android.graphics.*;
import java.util.*;

public class Enemy {
    private float x, y, angle;
    private int hp, maxHp;
    private float radius;
    private boolean alive = true;
    private List<Bullet> bullets = new ArrayList<>();
    private long lastShotTime = 0;
    private static final long SHOT_COOLDOWN = 1200;
    private int type; // 0=normal, 1=tank, 2=fast
    private float speed;
    private long lastDirChange = 0;
    private float targetX, targetY;
    
    public Enemy(float x, float y, float scale, int wave) {
        this.x = x; this.y = y;
        this.radius = 25 * scale;
        
        type = (int)(Math.random() * 3);
        switch (type) {
            case 0: hp = 50; maxHp = 50; speed = 1.5f * scale; break; // Normal
            case 1: hp = 100; maxHp = 100; speed = 1.0f * scale; radius = 32 * scale; break; // Tank
            case 2: hp = 30; maxHp = 30; speed = 2.5f * scale; radius = 18 * scale; break; // Fast
        }
        
        // Scale with wave
        hp += wave * 5;
        maxHp = hp;
        speed += wave * 0.1f * scale;
        
        pickNewTarget();
    }
    
    private void pickNewTarget() {
        targetX = (float) (Math.random() * 2 - 1);
        targetY = (float) (Math.random() * 2 - 1);
    }
    
    public void update(float playerX, float playerY, List<Bullet> playerBullets, int screenW, int screenH) {
        if (!alive) return;
        
        // Move towards player with some randomness
        float dx = playerX - x;
        float dy = playerY - y;
        float dist = (float) Math.sqrt(dx * dx + dy * dy);
        
        if (dist > 0) {
            // Add strafing behavior
            long now = System.currentTimeMillis();
            if (now - lastDirChange > 1500) {
                pickNewTarget();
                lastDirChange = now;
            }
            
            float moveX = (dx / dist + targetX * 0.3f) * speed;
            float moveY = (dy / dist + targetY * 0.3f) * speed;
            
            x += moveX;
            y += moveY;
            
            angle = (float) Math.atan2(dy, dx);
        }
        
        // Keep on screen
        x = Math.max(radius, Math.min(screenW - radius, x));
        y = Math.max(radius, Math.min(screenH - radius, y));
        
        // Shoot at player
        if (System.currentTimeMillis() - lastShotTime > SHOT_COOLDOWN && dist < 600) {
            float bx = x + (float) Math.cos(angle) * radius * 1.2f;
            float by = y + (float) Math.sin(angle) * radius * 1.2f;
            bullets.add(new Bullet(bx, by, angle, 5, false));
            lastShotTime = System.currentTimeMillis();
        }
        
        // Update bullets
        for (Bullet b : bullets) {
            b.update();
        }
        bullets.removeIf(b -> !b.isActive() || b.getX() < -100 || b.getX() > screenW + 100 || 
                         b.getY() < -100 || b.getY() > screenH + 100);
    }
    
    public void takeDamage(int dmg) {
        hp -= dmg;
        if (hp <= 0) alive = false;
    }
    
    public void draw(Canvas canvas, float scale) {
        if (!alive) return;
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        
        int color;
        switch (type) {
            case 0: color = Color.parseColor("#FF4444"); break;
            case 1: color = Color.parseColor("#FF8800"); break;
            case 2: color = Color.parseColor("#FF44FF"); break;
            default: color = Color.parseColor("#FF4444");
        }
        
        p.setStyle(Paint.Style.FILL);
        p.setColor(color);
        canvas.drawCircle(x, y, radius, p);
        
        p.setColor(Color.WHITE);
        p.setStrokeWidth(3 * scale);
        canvas.drawLine(x, y, 
            x + (float) Math.cos(angle) * radius * 1.3f,
            y + (float) Math.sin(angle) * radius * 1.3f, p);
        
        // HP bar
        float barW = radius * 2;
        float barH = 4 * scale;
        float barY = y - radius - 10 * scale;
        
        p.setColor(Color.parseColor("#44FF4444"));
        canvas.drawRect(x - barW / 2, barY, x + barW / 2, barY + barH, p);
        
        p.setColor(Color.parseColor("#FF00FF00"));
        canvas.drawRect(x - barW / 2, barY, x - barW / 2 + barW * (hp / (float) maxHp), barY + barH, p);
    }
    
    public float getX() { return x; }
    public float getY() { return y; }
    public boolean isAlive() { return alive; }
    public List<Bullet> getBullets() { return bullets; }
}
