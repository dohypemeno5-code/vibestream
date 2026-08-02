package com.vibestream.shooter;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.util.ArrayList;
import java.util.List;

public class GameDatabase extends SQLiteOpenHelper {
    private static final String DB_NAME = "vibestrike.db";
    private static final int DB_VERSION = 1;
    
    public GameDatabase(Context context) {
        super(context, DB_NAME, null, DB_VERSION);
    }
    
    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS player (" +
            "id INTEGER PRIMARY KEY AUTOINCREMENT," +
            "name TEXT DEFAULT 'Soldier'," +
            "xp INTEGER DEFAULT 0," +
            "coins INTEGER DEFAULT 500," +
            "level INTEGER DEFAULT 1," +
            "kills INTEGER DEFAULT 0," +
            "deaths INTEGER DEFAULT 0," +
            "high_score INTEGER DEFAULT 0," +
            "skin INTEGER DEFAULT 0," +
            "skin_color TEXT DEFAULT '#6C5CE7'" +
        ")");
        
        db.execSQL("CREATE TABLE IF NOT EXISTS ranking (" +
            "id INTEGER PRIMARY KEY AUTOINCREMENT," +
            "name TEXT," +
            "score INTEGER," +
            "wave INTEGER," +
            "kills INTEGER," +
            "date TEXT DEFAULT (datetime('now'))" +
        ")");
        
        db.execSQL("CREATE TABLE IF NOT EXISTS skins (" +
            "id INTEGER PRIMARY KEY AUTOINCREMENT," +
            "name TEXT," +
            "color TEXT," +
            "price INTEGER," +
            "owned INTEGER DEFAULT 0" +
        ")");
        
        db.execSQL("INSERT OR IGNORE INTO skins (id, name, color, price, owned) VALUES (1, 'Roxo', '#6C5CE7', 0, 1)");
        db.execSQL("INSERT OR IGNORE INTO skins (id, name, color, price, owned) VALUES (2, 'Vermelho', '#FF4444', 200, 0)");
        db.execSQL("INSERT OR IGNORE INTO skins (id, name, color, price, owned) VALUES (3, 'Azul', '#4444FF', 200, 0)");
        db.execSQL("INSERT OR IGNORE INTO skins (id, name, color, price, owned) VALUES (4, 'Verde', '#44FF44', 300, 0)");
        db.execSQL("INSERT OR IGNORE INTO skins (id, name, color, price, owned) VALUES (5, 'Dourado', '#FFD700', 500, 0)");
        db.execSQL("INSERT OR IGNORE INTO skins (id, name, color, price, owned) VALUES (6, 'Laranja', '#FF8800', 400, 0)");
        db.execSQL("INSERT OR IGNORE INTO skins (id, name, color, price, owned) VALUES (7, 'Ciano', '#00FFFF', 350, 0)");
        db.execSQL("INSERT OR IGNORE INTO skins (id, name, color, price, owned) VALUES (8, 'Rosa', '#FF44FF', 450, 0)");
        
        db.execSQL("INSERT OR IGNORE INTO player (id, name, xp, coins, level) VALUES (1, 'Soldier', 0, 500, 1)");
    }
    
    @Override
    public void onUpgrade(SQLiteDatabase db, int oldV, int newV) {}
    
    public synchronized String getPlayerName() {
        try {
            Cursor c = getReadableDatabase().rawQuery("SELECT name FROM player WHERE id=1", null);
            if (c.moveToFirst()) { String n = c.getString(0); c.close(); return n; }
            c.close();
        } catch (Exception e) {}
        return "Soldier";
    }
    
    public synchronized void setPlayerName(String name) {
        try {
            ContentValues cv = new ContentValues();
            cv.put("name", name);
            getWritableDatabase().update("player", cv, "id=1", null);
        } catch (Exception e) {}
    }
    
    public synchronized int getXP() {
        try {
            Cursor c = getReadableDatabase().rawQuery("SELECT xp FROM player WHERE id=1", null);
            if (c.moveToFirst()) { int x = c.getInt(0); c.close(); return x; }
            c.close();
        } catch (Exception e) {}
        return 0;
    }
    
    public synchronized int getCoins() {
        try {
            Cursor c = getReadableDatabase().rawQuery("SELECT coins FROM player WHERE id=1", null);
            if (c.moveToFirst()) { int x = c.getInt(0); c.close(); return x; }
            c.close();
        } catch (Exception e) {}
        return 500;
    }
    
    public synchronized int getLevel() {
        try {
            Cursor c = getReadableDatabase().rawQuery("SELECT level FROM player WHERE id=1", null);
            if (c.moveToFirst()) { int x = c.getInt(0); c.close(); return x; }
            c.close();
        } catch (Exception e) {}
        return 1;
    }
    
    public synchronized int getHighScore() {
        try {
            Cursor c = getReadableDatabase().rawQuery("SELECT high_score FROM player WHERE id=1", null);
            if (c.moveToFirst()) { int x = c.getInt(0); c.close(); return x; }
            c.close();
        } catch (Exception e) {}
        return 0;
    }
    
    public synchronized void addXP(int amount) {
        try {
            getWritableDatabase().execSQL("UPDATE player SET xp = xp + " + amount + " WHERE id=1");
            checkLevelUp();
        } catch (Exception e) {}
    }
    
    public synchronized void addCoins(int amount) {
        try {
            getWritableDatabase().execSQL("UPDATE player SET coins = coins + " + amount + " WHERE id=1");
        } catch (Exception e) {}
    }
    
    public synchronized boolean spendCoins(int amount) {
        try {
            int coins = getCoins();
            if (coins >= amount) {
                getWritableDatabase().execSQL("UPDATE player SET coins = coins - " + amount + " WHERE id=1");
                return true;
            }
        } catch (Exception e) {}
        return false;
    }
    
    private synchronized void checkLevelUp() {
        try {
            int xp = getXP();
            int level = getLevel();
            int requiredXP = level * 200;
            if (xp >= requiredXP) {
                getWritableDatabase().execSQL("UPDATE player SET level = level + 1 WHERE id=1");
            }
        } catch (Exception e) {}
    }
    
    public synchronized void addMatch(int score, int wave, int kills) {
        try {
            if (score > getHighScore()) {
                getWritableDatabase().execSQL("UPDATE player SET high_score = " + score + " WHERE id=1");
            }
            getWritableDatabase().execSQL("UPDATE player SET kills = kills + " + kills + " WHERE id=1");
            String safeName = getPlayerName().replace("'", "");
            getWritableDatabase().execSQL("INSERT INTO ranking (name, score, wave, kills) VALUES ('" + safeName + "', " + score + ", " + wave + ", " + kills + ")");
        } catch (Exception e) {}
    }
    
    public synchronized int getKills() {
        try {
            Cursor c = getReadableDatabase().rawQuery("SELECT kills FROM player WHERE id=1", null);
            if (c.moveToFirst()) { int x = c.getInt(0); c.close(); return x; }
            c.close();
        } catch (Exception e) {}
        return 0;
    }
    
    public synchronized List<String[]> getRanking() {
        List<String[]> list = new ArrayList<>();
        try {
            Cursor c = getReadableDatabase().rawQuery("SELECT name, score, wave, kills, date FROM ranking ORDER BY score DESC LIMIT 20", null);
            while (c.moveToNext()) {
                list.add(new String[]{c.getString(0), String.valueOf(c.getInt(1)), 
                          String.valueOf(c.getInt(2)), String.valueOf(c.getInt(3)), c.getString(4)});
            }
            c.close();
        } catch (Exception e) {}
        return list;
    }
    
    public synchronized int getCurrentSkin() {
        try {
            Cursor c = getReadableDatabase().rawQuery("SELECT skin FROM player WHERE id=1", null);
            if (c.moveToFirst()) { int x = c.getInt(0); c.close(); return x; }
            c.close();
        } catch (Exception e) {}
        return 1;
    }
    
    public synchronized void setSkin(int skinId) {
        try {
            getWritableDatabase().execSQL("UPDATE player SET skin = " + skinId + " WHERE id=1");
        } catch (Exception e) {}
    }
    
    public synchronized void buySkin(int skinId) {
        try {
            getWritableDatabase().execSQL("UPDATE skins SET owned = 1 WHERE id = " + skinId);
        } catch (Exception e) {}
    }
    
    public synchronized boolean isSkinOwned(int skinId) {
        try {
            Cursor c = getReadableDatabase().rawQuery("SELECT owned FROM skins WHERE id=" + skinId, null);
            if (c.moveToFirst()) { boolean x = c.getInt(0) == 1; c.close(); return x; }
            c.close();
        } catch (Exception e) {}
        return false;
    }
    
    public synchronized int getSkinPrice(int skinId) {
        try {
            Cursor c = getReadableDatabase().rawQuery("SELECT price FROM skins WHERE id=" + skinId, null);
            if (c.moveToFirst()) { int x = c.getInt(0); c.close(); return x; }
            c.close();
        } catch (Exception e) {}
        return 99999;
    }
    
    public synchronized String getSkinColor(int skinId) {
        try {
            Cursor c = getReadableDatabase().rawQuery("SELECT color FROM skins WHERE id=" + skinId, null);
            if (c.moveToFirst()) { String x = c.getString(0); c.close(); return x; }
            c.close();
        } catch (Exception e) {}
        return "#6C5CE7";
    }
    
    public synchronized String getSkinName(int skinId) {
        try {
            Cursor c = getReadableDatabase().rawQuery("SELECT name FROM skins WHERE id=" + skinId, null);
            if (c.moveToFirst()) { String x = c.getString(0); c.close(); return x; }
            c.close();
        } catch (Exception e) {}
        return "Desconhecido";
    }
    
    public synchronized List<String[]> getAllSkins() {
        List<String[]> list = new ArrayList<>();
        try {
            Cursor c = getReadableDatabase().rawQuery("SELECT id, name, color, price, owned FROM skins ORDER BY id", null);
            while (c.moveToNext()) {
                list.add(new String[]{String.valueOf(c.getInt(0)), c.getString(1), c.getString(2), 
                          String.valueOf(c.getInt(3)), String.valueOf(c.getInt(4))});
            }
            c.close();
        } catch (Exception e) {}
        return list;
    }
}
