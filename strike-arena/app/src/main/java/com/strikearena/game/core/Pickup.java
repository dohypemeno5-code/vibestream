package com.strikearena.game.core;

/** Item coletável (vida ou munição) com respawn. */
public class Pickup {
    public static final int HEALTH = 0, AMMO = 1, ARMOR = 2;
    public float x, y;
    public int type;
    public boolean active = true;
    public float respawnT;
    public float bob;

    public Pickup(float x, float y, int type) {
        this.x = x; this.y = y; this.type = type;
        this.bob = (float) Math.random() * 6.28f;
    }
}
