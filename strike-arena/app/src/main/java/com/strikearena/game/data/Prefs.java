package com.strikearena.game.data;

import android.content.Context;
import android.content.SharedPreferences;

/** Preferências e estado da sessão. */
public class Prefs {
    private static Prefs inst;
    private final SharedPreferences sp;
    public static String activeAccount = "";
    public static boolean isGuest = true;

    public static synchronized Prefs get(Context c) {
        if (inst == null) inst = new Prefs(c.getApplicationContext());
        return inst;
    }

    private Prefs(Context c) {
        sp = c.getSharedPreferences("strikearena_prefs", Context.MODE_PRIVATE);
        activeAccount = sp.getString("active_account", "");
        isGuest = activeAccount.isEmpty();
    }

    public void setActiveAccount(String name) {
        activeAccount = name == null ? "" : name;
        isGuest = activeAccount.isEmpty();
        sp.edit().putString("active_account", activeAccount).apply();
    }

    public float sens() { return sp.getFloat("sens", 1.0f); }
    public void setSens(float v) { sp.edit().putFloat("sens", v).apply(); }

    public boolean aimAssist() { return sp.getBoolean("aim_assist", true); }
    public void setAimAssist(boolean v) { sp.edit().putBoolean("aim_assist", v).apply(); }

    public boolean soundOn() { return sp.getBoolean("sound", true); }
    public void setSound(boolean v) { sp.edit().putBoolean("sound", v).apply(); }

    public boolean musicOn() { return sp.getBoolean("music", true); }
    public void setMusic(boolean v) { sp.edit().putBoolean("music", v).apply(); }

    public int quality() { return sp.getInt("quality", 1); }
    public void setQuality(int v) { sp.edit().putInt("quality", v).apply(); }

    public boolean showFps() { return sp.getBoolean("show_fps", false); }
    public void setShowFps(boolean v) { sp.edit().putBoolean("show_fps", v).apply(); }

    public float joystickScale() { return sp.getFloat("joy_scale", 1.0f); }
    public void setJoystickScale(float v) { sp.edit().putFloat("joy_scale", v).apply(); }

    public String lastIp() { return sp.getString("last_ip", ""); }
    public void setLastIp(String v) { sp.edit().putString("last_ip", v).apply(); }

    public String playerName() {
        if (!isGuest && !activeAccount.isEmpty()) return activeAccount;
        return "Convidado";
    }

    public String roomName() { return sp.getString("room_name", "Sala do Jogador"); }
    public void setRoomName(String v) { sp.edit().putString("room_name", v).apply(); }
}
