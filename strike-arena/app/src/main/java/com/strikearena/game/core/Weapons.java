package com.strikearena.game.core;

/** Definições das armas do jogo. */
public final class Weapons {
    public static final int PISTOL = 0, RIFLE = 1, SMG = 2, SHOTGUN = 3, SNIPER = 4;

    public static class Def {
        public final int id;
        public final String name;
        public final int mag;
        public final int reserve;
        public final float damage;
        public final float fireInterval;
        public final float reloadTime;
        public final float bulletSpeed;
        public final float spreadDeg;
        public final int pellets;
        public final float bulletRadius;
        public final boolean auto;
        public final String sfx;

        public Def(int id, String name, int mag, int reserve, float damage, float fireInterval,
                   float reloadTime, float bulletSpeed, float spreadDeg, int pellets,
                   float bulletRadius, boolean auto, String sfx) {
            this.id = id; this.name = name; this.mag = mag; this.reserve = reserve;
            this.damage = damage; this.fireInterval = fireInterval; this.reloadTime = reloadTime;
            this.bulletSpeed = bulletSpeed; this.spreadDeg = spreadDeg; this.pellets = pellets;
            this.bulletRadius = bulletRadius; this.auto = auto; this.sfx = sfx;
        }
    }

    public static final Def[] ALL = {
            new Def(PISTOL, "Pistola", 12, 60, 18f, 0.29f, 1.1f, 720f, 2f, 1, 4f, false, "pistol"),
            new Def(RIFLE, "Fuzil", 30, 120, 13f, 0.125f, 1.8f, 820f, 2.5f, 1, 4f, true, "rifle"),
            new Def(SMG, "Submetralhadora", 35, 140, 10f, 0.075f, 1.6f, 760f, 4f, 1, 3.5f, true, "smg"),
            new Def(SHOTGUN, "Espingarda", 6, 30, 9f, 0.85f, 2.2f, 700f, 10f, 6, 4f, false, "shotgun"),
            new Def(SNIPER, "Sniper", 5, 20, 70f, 1.5f, 2.6f, 1500f, 0f, 1, 5f, false, "sniper")
    };

    public static Def get(int id) { return ALL[Math.max(0, Math.min(ALL.length - 1, id))]; }
    private Weapons() {}
}
