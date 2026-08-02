package com.strikearena.game.gl;

import android.content.Context;
import android.opengl.GLSurfaceView;

import com.strikearena.game.core.Game;
import com.strikearena.game.data.Prefs;

/** Superfície GLES 2.0 do jogo 3D (loop de simulação no thread de render). */
public class Game3DView extends GLSurfaceView {

    private final Game game;
    private final GlRenderer renderer;

    public Game3DView(Context c, Game game) {
        super(c);
        this.game = game;
        setEGLContextClientVersion(2);
        float scale = 1f;
        try {
            int q = Prefs.get(c).quality();
            scale = q <= 0 ? 0.62f : q == 1 ? 0.8f : 1f;
        } catch (Exception ignored) {}
        renderer = new GlRenderer(game, scale);
        setRenderer(renderer);
        setRenderMode(GLSurfaceView.RENDERMODE_CONTINUOUSLY);
        setKeepScreenOn(true);
    }

    public Game game() { return game; }

    public void pauseGame() { renderer.paused = true; }
    public void resumeGame() { renderer.paused = false; }
}
