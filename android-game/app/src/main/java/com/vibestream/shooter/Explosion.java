package com.vibestream.shooter;

import android.graphics.*;

public class Explosion {
    private float x, y;
    private int maxRadius, currentRadius = 0;
    private int alpha = 255;
    private boolean done = false;
    
    public Explosion(float x, float y, float scale) {
        this.x = x; this.y = y;
        this.maxRadius = (int)(50 * scale);
    }
    
    public void update() {
        currentRadius += 5;
        alpha = Math.max(0, 255 - currentRadius * 5);
        if (currentRadius >= maxRadius) done = true;
    }
    
    public void draw(Canvas canvas) {
        if (done) return;
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setStyle(Paint.Style.FILL);
        
        // Outer ring
        p.setColor(Color.argb(alpha / 3, 255, 200, 0));
        canvas.drawCircle(x, y, currentRadius, p);
        
        // Middle ring
        p.setColor(Color.argb(alpha / 2, 255, 150, 0));
        canvas.drawCircle(x, y, currentRadius * 0.7f, p);
        
        // Inner core
        p.setColor(Color.argb(alpha, 255, 255, 255));
        canvas.drawCircle(x, y, currentRadius * 0.3f, p);
    }
    
    public boolean isDone() { return done; }
}

