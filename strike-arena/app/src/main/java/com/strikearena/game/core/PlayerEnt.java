package com.strikearena.game.core;

/** Entidade de jogador (humano ou bot). */
public class PlayerEnt {
    public static final int TEAM_RED = 0, TEAM_BLUE = 1, TEAM_NONE = 2;
    public static final int TEAM_RIVAL = TEAM_RED;   // equipe rival fictícia
    public static final int TEAM_POLICE = TEAM_BLUE; // equipe polícia
    public static final float RADIUS = 17f;
    public static final float MAX_HP = 100f;
    public static final float MAX_ARMOR = 100f;

    /** Nome de exibição da equipe (tudo fictício). */
    public static String teamName(int team) {
        if (team == TEAM_POLICE) return "POLÍCIA";
        if (team == TEAM_RIVAL) return "RIVAIS";
        return "LIVRE";
    }

    /** Cor principal da equipe. */
    public static int teamColor(int team) {
        return team == TEAM_POLICE ? 0xFF38B6FF : 0xFFE8503A;
    }

    public int id;
    public String name;
    public int team;
    public int skinId;
    public boolean isBot;
    public boolean isLocal;

    public float x, y, vx, vy;
    public float aim;
    public boolean alive = true;
    public float hp = MAX_HP;
    public float armor; // colete: absorve parte do dano até zerar
    public int weapon = Weapons.RIFLE;
    public int[] ammo;
    public int[] reserve;
    public boolean reloading;
    public float reloadT;
    public float fireCd;
    public float emptyCd;
    public int kills;
    public int deaths;
    public float respawnT;
    public float dashCd;
    public boolean dashing;
    public float dashT;
    public float dashDx, dashDy;
    public float regenT = 99f;
    public float hitFlash;
    public float moveT;
    public float spawnInvuln;
    public BotBrain brain;
    public float aiDiff = 1f;
    public boolean leftMatch;

    public PlayerEnt(int id, String name, int team, int skinId, boolean isBot, boolean isLocal) {
        this.id = id; this.name = name; this.team = team; this.skinId = skinId;
        this.isBot = isBot; this.isLocal = isLocal;
        ammo = new int[Weapons.ALL.length];
        reserve = new int[Weapons.ALL.length];
        for (Weapons.Def w : Weapons.ALL) {
            ammo[w.id] = w.mag;
            reserve[w.id] = w.reserve;
        }
    }

    public boolean sameTeam(PlayerEnt o) {
        if (team == TEAM_NONE || o.team == TEAM_NONE) return false;
        return team == o.team;
    }
}
