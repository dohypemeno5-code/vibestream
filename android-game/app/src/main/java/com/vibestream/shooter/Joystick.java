package com.vibestream.shooter;

import android.graphics.*;

public class Joystick {
    private float baseX, baseY, knobX, knobY;
    private float outerRadius, innerRadius;
    private boolean pressed = false;
    private float dirX = 0, dirY = 0;
    
    public Joystick(float baseX, float baseY, float innerRadius, float outerRadius) {
        this.baseX = baseX; this.baseY = baseY;
        this.knobX = baseX; this.knobY = baseY;
        this.innerRadius = innerRadius;
        this.outerRadius = outerRadius;
    }
    
    public void setPressed(boolean p) { 
        pressed = p; 
        if (!p) { knobX = baseX; knobY = baseY; dirX = 0; dirY = 0; }
    }
    
    public boolean isPressed() { return pressed; }
    
    public void update(float touchX, float touchY) {
        if (!pressed) return;
        float dx = touchX - baseX;
        float dy = touchY - baseY;
        float dist = (float) Math.sqrt(dx * dx + dy * dy);
        
        if (dist > outerRadius) {
            dx = dx / dist * outerRadius;
            dy = dy / dist * outerRadius;
        }
        
        knobX = baseX + dx;
        knobY = baseY + dy;
        
        if (dist > 5) {
            dirX = dx / outerRadius;
            dirY = dy / outerRadius;
        } else {
            dirX = 0; dirY = 0;
        }
    }
    
    public void draw(Canvas canvas) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        
        // Outer circle
        p.setStyle(Paint.Style.FILL);
        p.setColor(Color.parseColor("#33FFFFFF"));
        canvas.drawCircle(baseX, baseY, outerRadius, p);
        
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(2);
        p.setColor(Color.parseColor("#55FFFFFF"));
        canvas.drawCircle(baseX, baseY, outerRadius, p);
        
        // Inner knob
        p.setStyle(Paint.Style.FILL);
        p.setColor(pressed ? Color.parseColor("#886C5CE7") : Color.parseColor("#556C5CE7"));
        canvas.drawCircle(knobX, knobY, innerRadius, p);
        
        p.setStyle(Paint.Style.STROKE);
        p.setColor(Color.parseColor("#AA6C5CE7"));
        p.setStrokeWidth(2);
        canvas.drawCircle(knobX, knobY, innerRadius, p);
    }
    
    public boolean contains(float x, float y) {
        return Math.sqrt((x - baseX) * (x - baseX) + (y - baseY) * (y - baseY)) < outerRadius * 1.5f;
    }
    
    public float getDirectionX() { return dirX; }
    public float getDirectionY() { return dirY; }
}
