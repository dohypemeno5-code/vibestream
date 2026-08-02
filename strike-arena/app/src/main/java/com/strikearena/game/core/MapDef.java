package com.strikearena.game.core;

/** Definição de um mapa 2D (paredes, spawns e itens). */
public class MapDef {
    public final String name;
    public final float w, h;
    public final int floorColor, floorAlt, wallColor, wallTopColor;
    public final float[] walls;      // x,y,w,h ...
    public final float[] spawnRed;   // x,y ...
    public final float[] spawnBlue;  // x,y ...
    public final float[] spawnFree;  // x,y ...
    public final float[] pickups;    // x,y ...
    public final float[] baseRed;    // base da equipe rival: x,y,w,h
    public final float[] baseBlue;   // base da equipe polícia: x,y,w,h
    public final float[] poles;      // postes de rua: x,y ...
    public final float[] cars;       // veículos: x,y,ang ...
    public final float[] awnings;    // lojas/comércios: x,y,w,h ...
    public final String[] shopNames; // nomes das lojas (mesma ordem de awnings)

    public MapDef(String name, float w, float h, int floor, int floorAlt, int wall, int wallTop,
                  float[] walls, float[] red, float[] blue, float[] free, float[] pickups) {
        this(name, w, h, floor, floorAlt, wall, wallTop, walls, red, blue, free, pickups,
                null, null);
    }

    public MapDef(String name, float w, float h, int floor, int floorAlt, int wall, int wallTop,
                  float[] walls, float[] red, float[] blue, float[] free, float[] pickups,
                  float[] baseRed, float[] baseBlue) {
        this(name, w, h, floor, floorAlt, wall, wallTop, walls, red, blue, free, pickups,
                baseRed, baseBlue, null, null, null, null);
    }

    public MapDef(String name, float w, float h, int floor, int floorAlt, int wall, int wallTop,
                  float[] walls, float[] red, float[] blue, float[] free, float[] pickups,
                  float[] baseRed, float[] baseBlue, float[] poles, float[] cars,
                  float[] awnings, String[] shopNames) {
        this.name = name; this.w = w; this.h = h;
        this.floorColor = floor; this.floorAlt = floorAlt;
        this.wallColor = wall; this.wallTopColor = wallTop;
        this.walls = walls; this.spawnRed = red; this.spawnBlue = blue;
        this.spawnFree = free; this.pickups = pickups;
        this.baseRed = baseRed; this.baseBlue = baseBlue;
        this.poles = poles; this.cars = cars;
        this.awnings = awnings; this.shopNames = shopNames;
    }

    public float[] teamBase(int team) {
        if (team == 0) return baseRed;
        if (team == 1) return baseBlue;
        return null;
    }

    public float[] spawnsForTeam(int team) {
        if (team == 0) return spawnRed;
        if (team == 1) return spawnBlue;
        return spawnFree;
    }
}
