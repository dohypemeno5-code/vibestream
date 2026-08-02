package com.strikearena.game.core;

/** Partícula simples para efeitos visuais. */
public class Particle {
    public float x, y, vx, vy;
    public float life, maxLife;
    public float size;
    public int color;
    public float gravity;

    public Particle(float x, float y, float vx, float vy, float life, float size, int color, float gravity) {
        this.x = x; this.y = y; this.vx = vx; this.vy = vy;
        this.life = life; this.maxLife = life; this.size = size; this.color = color;
        this.gravity = gravity;
    }
}
