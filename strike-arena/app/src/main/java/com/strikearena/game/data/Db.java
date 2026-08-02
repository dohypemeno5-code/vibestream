package com.strikearena.game.data;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;

/** Banco local de contas (SQLite). Senhas com hash SHA-256 + salt. */
public class Db extends SQLiteOpenHelper {
    private static final String DB_NAME = "strikearena.db";
    private static final int DB_VERSION = 1;
    private static Db instance;

    public static synchronized Db get(Context c) {
        if (instance == null) instance = new Db(c.getApplicationContext());
        return instance;
    }

    private Db(Context c) { super(c, DB_NAME, null, DB_VERSION); }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE accounts(" +
                "name TEXT PRIMARY KEY," +
                "pass_hash TEXT NOT NULL," +
                "salt TEXT NOT NULL," +
                "xp INTEGER DEFAULT 0," +
                "coins INTEGER DEFAULT 0," +
                "wins INTEGER DEFAULT 0," +
                "losses INTEGER DEFAULT 0," +
                "kills INTEGER DEFAULT 0," +
                "deaths INTEGER DEFAULT 0," +
                "matches INTEGER DEFAULT 0," +
                "best_wave INTEGER DEFAULT 0," +
                "skins_owned TEXT DEFAULT '0'," +
                "skin_equipped INTEGER DEFAULT 0)");
    }

    @Override public void onUpgrade(SQLiteDatabase db, int o, int n) { onCreate(db); }

    private static String sha256(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] d = md.digest(s.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) { return s; }
    }

    private static String randomSalt() {
        byte[] b = new byte[16];
        new SecureRandom().nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }

    public synchronized boolean register(String name, String pass) {
        name = name.trim();
        if (name.length() < 3 || name.length() > 16 || pass.length() < 4) return false;
        SQLiteDatabase db = getWritableDatabase();
        if (get(name) != null) return false;
        Account a = new Account(name);
        a.salt = randomSalt();
        a.passHash = sha256(a.salt + pass);
        db.insert("accounts", null, toValues(a));
        return true;
    }

    public synchronized Account login(String name, String pass) {
        Account a = get(name.trim());
        if (a == null) return null;
        String h = sha256(a.salt + pass);
        return h.equals(a.passHash) ? a : null;
    }

    public synchronized Account get(String name) {
        if (name == null || name.isEmpty()) return null;
        Cursor c = getReadableDatabase().rawQuery(
                "SELECT * FROM accounts WHERE name=?", new String[]{name});
        if (c.moveToFirst()) { Account a = fromCursor(c); c.close(); return a; }
        c.close(); return null;
    }

    public synchronized void save(Account a) {
        getWritableDatabase().insertWithOnConflict("accounts", null, toValues(a),
                SQLiteDatabase.CONFLICT_REPLACE);
    }

    /** Registra resultado de partida e aplica recompensas. */
    public synchronized void recordMatch(Account a, boolean win, int kills, int deaths,
                                         long xpGain, long coinsGain, int wave) {
        a.xp += xpGain;
        a.coins += coinsGain;
        a.kills += kills;
        a.deaths += deaths;
        a.matches += 1;
        if (win) a.wins += 1; else a.losses += 1;
        if (wave > a.bestWave) a.bestWave = wave;
        save(a);
    }

    public synchronized List<Account> leaderboard(int limit) {
        ArrayList<Account> list = new ArrayList<>();
        Cursor c = getReadableDatabase().rawQuery(
                "SELECT * FROM accounts ORDER BY xp DESC, kills DESC LIMIT " + limit, null);
        while (c.moveToNext()) list.add(fromCursor(c));
        c.close();
        return list;
    }

    public synchronized int accountCount() {
        Cursor c = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM accounts", null);
        int n = 0; if (c.moveToFirst()) n = c.getInt(0); c.close();
        return n;
    }

    private static ContentValues toValues(Account a) {
        ContentValues v = new ContentValues();
        v.put("name", a.name); v.put("pass_hash", a.passHash); v.put("salt", a.salt);
        v.put("xp", a.xp); v.put("coins", a.coins); v.put("wins", a.wins);
        v.put("losses", a.losses); v.put("kills", a.kills); v.put("deaths", a.deaths);
        v.put("matches", a.matches); v.put("best_wave", a.bestWave);
        v.put("skins_owned", a.skinsOwned); v.put("skin_equipped", a.skinEquipped);
        return v;
    }

    private static Account fromCursor(Cursor c) {
        Account a = new Account(c.getString(0));
        a.passHash = c.getString(1); a.salt = c.getString(2);
        a.xp = c.getLong(3); a.coins = c.getLong(4);
        a.wins = c.getInt(5); a.losses = c.getInt(6);
        a.kills = c.getInt(7); a.deaths = c.getInt(8); a.matches = c.getInt(9);
        a.bestWave = c.getInt(10); a.skinsOwned = c.getString(11); a.skinEquipped = c.getInt(12);
        return a;
    }
}
