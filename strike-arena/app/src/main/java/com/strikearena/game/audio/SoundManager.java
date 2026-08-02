package com.strikearena.game.audio;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.SoundPool;
import android.util.SparseIntArray;

import com.strikearena.game.R;
import com.strikearena.game.data.Prefs;

/** Carrega e toca os efeitos sonoros do jogo. */
public class SoundManager {
    private static SoundManager inst;
    private SoundPool pool;
    private final SparseIntArray ids = new SparseIntArray();
    private int ambientId = -1;
    private boolean ready;
    private boolean soundOn = true;
    private boolean musicOn = true;
    private float masterVol = 0.8f;
    private Context ctx;

    public static synchronized SoundManager get(Context c) {
        if (inst == null) inst = new SoundManager(c.getApplicationContext());
        return inst;
    }

    private SoundManager(Context c) {
        ctx = c;
        try {
        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        pool = new SoundPool.Builder().setMaxStreams(14).setAudioAttributes(attrs).build();
        pool.setOnLoadCompleteListener((sp, sampleId, status) -> {
            if (status == 0 && sampleId == ambientId && musicOn) {
                try { pool.play(sampleId, masterVol * 0.55f, masterVol * 0.55f, 1, -1, 1f); } catch (Exception ignored) {}
            }
            if (status == 0) ready = true;
        });
        } catch (Exception ignored) { pool = null; }
    }

    private int load(int res) {
        if (pool == null) return -1;
        try {
            int id = pool.load(ctx, res, 1);
            ids.put(res, id);
            return id;
        } catch (Exception ignored) { return -1; }
    }

    public void preload() {
        soundOn = Prefs.get(ctx).soundOn();
        musicOn = Prefs.get(ctx).musicOn();
        load(R.raw.shoot_rifle); load(R.raw.shoot_smg); load(R.raw.shoot_shotgun);
        load(R.raw.shoot_sniper); load(R.raw.shoot_pistol); load(R.raw.empty);
        load(R.raw.reload); load(R.raw.hit); load(R.raw.hurt); load(R.raw.kill);
        load(R.raw.death); load(R.raw.explosion); load(R.raw.coin); load(R.raw.pickup);
        load(R.raw.ui_click); load(R.raw.wave_start); load(R.raw.win); load(R.raw.lose);
        load(R.raw.dash); load(R.raw.spawn); load(R.raw.ambient);
    }

    public void startAmbient() {
        if (!musicOn || pool == null) return;
        if (ambientId == -1) ambientId = load(R.raw.ambient);
        else try { pool.play(ambientId, masterVol * 0.55f, masterVol * 0.55f, 1, -1, 1f); } catch (Exception ignored) {}
    }

    public void stopAmbient() {
        if (ambientId != -1 && pool != null) {
            try { pool.stop(ambientId); } catch (Exception ignored) {}
        }
    }

    public void play(String key) { play(key, 1f); }

    public void play(String key, float vol) {
        if (!soundOn || !ready || pool == null) return;
        int res;
        switch (key) {
            case "rifle": res = R.raw.shoot_rifle; break;
            case "smg": res = R.raw.shoot_smg; break;
            case "shotgun": res = R.raw.shoot_shotgun; break;
            case "sniper": res = R.raw.shoot_sniper; break;
            case "pistol": res = R.raw.shoot_pistol; break;
            case "empty": res = R.raw.empty; break;
            case "reload": res = R.raw.reload; break;
            case "hit": res = R.raw.hit; break;
            case "hurt": res = R.raw.hurt; break;
            case "kill": res = R.raw.kill; break;
            case "death": res = R.raw.death; break;
            case "explosion": res = R.raw.explosion; break;
            case "coin": res = R.raw.coin; break;
            case "pickup": res = R.raw.pickup; break;
            case "click": res = R.raw.ui_click; break;
            case "wave": res = R.raw.wave_start; break;
            case "win": res = R.raw.win; break;
            case "lose": res = R.raw.lose; break;
            case "dash": res = R.raw.dash; break;
            case "spawn": res = R.raw.spawn; break;
            default: return;
        }
        int id = ids.get(res, 0);
        if (id != 0 && pool != null) {
            float v = Math.min(1f, vol * masterVol);
            try { pool.play(id, v, v, 1, 0, 1f); } catch (Exception ignored) {}
        }
    }

    public void setMasterVol(float v) { masterVol = v; }
    public void release() { if (pool != null) pool.release(); pool = null; }
}
