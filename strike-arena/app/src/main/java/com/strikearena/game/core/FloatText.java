package com.strikearena.game.core;

/** Texto flutuante (dano, XP, moedas). */
public class FloatText {
    public float x, y, vy;
    public float life, maxLife;
    public String text;
    public int color;
    public float size;

    public FloatText(float x, float y, String text, int color, float life, float size) {
        this.x = x; this.y = y; this.text = text; this.color = color;
        this.life = life; this.maxLife = life; this.size = size; this.vy = -60f;
    }
}
