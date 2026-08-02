package com.strikearena.game.core;

import java.util.ArrayList;

/** Projétil com colisão contra paredes e jogadores. */
public class Bullet {
    public int id;
    public int ownerId;
    public int team;
    public float x, y, vx, vy;
    public float damage;
    public float life;
    public float radius;
    public boolean pierce;
    public ArrayList<Integer> hit = new ArrayList<>();

    public Bullet(int id, int ownerId, int team, float x, float y, float vx, float vy,
                  float damage, float life, float radius, boolean pierce) {
        this.id = id; this.ownerId = ownerId; this.team = team;
        this.x = x; this.y = y; this.vx = vx; this.vy = vy;
        this.damage = damage; this.life = life; this.radius = radius; this.pierce = pierce;
    }
}
