package com.vibestream.shooter;

import android.graphics.*;

public class Player {
    private float x, y, angle = 0;
    private int hp = 100, maxHp = 100;
    private float radius;
    private long lastHitTime = 0;
    private static final long INVINCIBLE_TIME = 500;
    private int bodyColor = Color.parseColor("#6C5CE7");
    private int innerColor = Color.parseColor("#8B7CF0");
    private boolean invincible = false;
    
    public Player(float x, float y, float scale) {
        this.x = x; this.y = y;
        this.radius = 22 * scale;
    }
    
    public void move(float dx, float dy, int screenW, int screenH) {
        x = Math.max(radius, Math.min(screenW - radius, x + dx));
        y = Math.max(radius, Math.min(screenH - radius, y + dy));
    }
    
    public void takeDamage(int dmg) {
        long now = System.currentTimeMillis();
        if (now - lastHitTime < INVINCIBLE_TIME) return;
        hp = Math.max(0, hp - dmg);
        lastHitTime = now;
    }
    
    public void setSkinColor(int color) {
        bodyColor = color;
        innerColor = lighten(color);
    }
    
    private int lighten(int color) {
        int r = Math.min(255, Color.red(color) + 30);
        int g = Math.min(255, Color.green(color) + 30);
        int b = Math.min(255, Color.blue(color) + 30);
        return Color.rgb(r, g, b);
    }
    
    public void draw(Canvas canvas, float scale) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        
        // Invincibility flash
        long now = System.currentTimeMillis();
        if (now - lastHitTime < INVINCIBLE_TIME && (now / 100) % 2 == 0) return;
        
        // Body
        p.setStyle(Paint.Style.FILL);
        p.setColor(bodyColor);
        canvas.drawCircle(x, y, radius, p);
        
        // Inner circle
        p.setColor(innerColor);
        canvas.drawCircle(x, y, radius * 0.7f, p);
        
        // Direction indicator
        p.setColor(Color.WHITE);
        p.setStrokeWidth(4 * scale);
        canvas.drawLine(x, y, 
            x + (float) Math.cos(angle) * radius * 1.5f,
            y + (float) Math.sin(angle) * radius * 1.5f, p);
        
        // Eyes
        float eyeOff = radius * 0.3f;
        float eyeR = radius * 0.15f;
        p.setColor(Color.WHITE);
        canvas.drawCircle(x - eyeOff, y - eyeOff, eyeR, p);
        canvas.drawCircle(x + eyeOff, y - eyeOff, eyeR, p);
        p.setColor(Color.BLACK);
        canvas.drawCircle(x - eyeOff, y - eyeOff, eyeR * 0.5f, p);
        canvas.drawCircle(x + eyeOff, y - eyeOff, eyeR * 0.5f, p);
        
        // HP ring
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(3 * scale);
        float hpRatio = hp / (float) maxHp;
        p.setColor(hpRatio > 0.5f ? Color.parseColor("#44FF44") :
                   hpRatio > 0.25f ? Color.parseColor("#FFAA00") : Color.parseColor("#FF4444"));
        canvas.drawCircle(x, y, radius + 6 * scale, p);
    }
    
    public float getX() { return x; }
    public float getY() { return y; }
    public float getAngle() { return angle; }
    public void setAngle(float a) { this.angle = a; }
    public int getHp() { return hp; }
    public int getMaxHp() { return maxHp; }
    public boolean isAlive() { return hp > 0; }
    public void setPosition(float x, float y) { this.x = x; this.y = y; }
    public void heal(int amount) { hp = Math.min(maxHp, hp + amount); }
    public void reset() { hp = maxHp; invincible = false; }
}
