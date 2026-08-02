package com.vibestream.shooter;

import android.graphics.*;

public class HUD {
    private Paint hpPaint, hpBgPaint, textPaint, ammoPaint;
    private float scale;
    
    public HUD(float scale) {
        this.scale = scale;
        
        hpPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        hpPaint.setColor(Color.parseColor("#FF00FF00"));
        
        hpBgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        hpBgPaint.setColor(Color.parseColor("#44FF4444"));
        
        textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        textPaint.setColor(Color.WHITE);
        textPaint.setTextSize(16 * scale);
        
        ammoPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        ammoPaint.setColor(Color.parseColor("#FFD700"));
        ammoPaint.setTextSize(22 * scale);
        ammoPaint.setTypeface(Typeface.DEFAULT_BOLD);
    }
    
    public void draw(Canvas canvas, Player player, int score, int kills, int wave, 
                     int ammo, int maxAmmo, boolean isReloading, long reloadStart, 
                     long reloadTime, int screenW, int screenH, float s) {
        
        // HP bar
        float barW = 200 * s;
        float barH = 20 * s;
        float barX = 20 * s;
        float barY = screenH - 50 * s;
        
        // Background
        canvas.drawRect(barX, barY, barX + barW, barY + barH, hpBgPaint);
        
        // HP
        float hpRatio = player.getHp() / (float) player.getMaxHp();
        hpPaint.setColor(hpRatio > 0.5f ? Color.parseColor("#FF00FF00") : 
                         hpRatio > 0.25f ? Color.parseColor("#FFFFAA00") : Color.parseColor("#FFFF4444"));
        canvas.drawRect(barX, barY, barX + barW * hpRatio, barY + barH, hpPaint);
        
        // HP border
        Paint border = new Paint(Paint.ANTI_ALIAS_FLAG);
        border.setStyle(Paint.Style.STROKE);
        border.setColor(Color.parseColor("#88FFFFFF"));
        border.setStrokeWidth(2);
        canvas.drawRect(barX, barY, barX + barW, barY + barH, border);
        
        // HP text
        textPaint.setTextAlign(Paint.Align.LEFT);
        canvas.drawText("❤ " + player.getHp() + "/" + player.getMaxHp(), barX, barY - 8 * s, textPaint);
        
        // Ammo
        ammoPaint.setTextAlign(Paint.Align.RIGHT);
        if (isReloading) {
            float progress = (System.currentTimeMillis() - reloadStart) / (float) reloadTime;
            ammoPaint.setColor(Color.parseColor("#4444FF"));
            canvas.drawText("RECARREGANDO... " + (int)(progress * 100) + "%", screenW - 20 * s, 50 * s, ammoPaint);
        } else {
            ammoPaint.setColor(ammo < 10 ? Color.parseColor("#FFFF4444") : Color.parseColor("#FFD700"));
            canvas.drawText("🔫 " + ammo + "/" + maxAmmo, screenW - 20 * s, 50 * s, ammoPaint);
        }
        
        // Score
        textPaint.setTextAlign(Paint.Align.CENTER);
        textPaint.setColor(Color.parseColor("#FFD700"));
        textPaint.setTextSize(18 * s);
        canvas.drawText("SCORE: " + score, screenW / 2f, 60 * s, textPaint);
        
        // Kills
        textPaint.setColor(Color.parseColor("#FF6666"));
        canvas.drawText("KILLS: " + kills, screenW / 2f, 85 * s, textPaint);
        
        // Kill feed
        textPaint.setTextAlign(Paint.Align.LEFT);
        textPaint.setColor(Color.parseColor("#88FFFFFF"));
        textPaint.setTextSize(14 * s);
        int y = (int)(screenH - 100 * s);
        if (kills > 0) canvas.drawText("☠ +" + kills + " eliminações", 20 * s, y, textPaint);
    }
}
