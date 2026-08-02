package com.strikearena.game.data;

/** Conta de jogador: nome, progresso e inventário de skins. */
public class Account {
    public String name;
    public String passHash;
    public String salt;
    public long xp;
    public long coins;
    public int wins;
    public int losses;
    public int kills;
    public int deaths;
    public int matches;
    public int bestWave;
    public String skinsOwned;
    public int skinEquipped;

    public static final String DEFAULT_SKINS = "0";

    public Account(String name) {
        this.name = name;
        this.skinsOwned = DEFAULT_SKINS;
        this.skinEquipped = 0;
    }

    public int level() { return levelFromXp(xp); }

    public static int levelFromXp(long xp) {
        long need = 300;
        long rest = xp;
        int lvl = 1;
        while (rest >= need) { rest -= need; lvl++; need += 150; }
        return lvl;
    }

    public long xpIntoLevel() {
        long need = 300; long rest = xp; int lvl = 1;
        while (rest >= need && lvl < 999) { rest -= need; lvl++; need += 150; }
        return rest;
    }

    public long xpForNextLevel() {
        long need = 300; long rest = xp; int lvl = 1;
        while (rest >= need && lvl < 999) { rest -= need; lvl++; need += 150; }
        return need;
    }

    public boolean ownsSkin(int id) {
        if (id == 0) return true;
        String s = skinsOwned == null ? DEFAULT_SKINS : skinsOwned;
        for (String p : s.split(",")) {
            if (p.trim().equals(String.valueOf(id))) return true;
        }
        return false;
    }

    public void addSkin(int id) {
        if (ownsSkin(id)) return;
        String s = skinsOwned == null ? DEFAULT_SKINS : skinsOwned;
        skinsOwned = s + "," + id;
    }

    public void equipSkin(int id) { skinEquipped = id; }
}
