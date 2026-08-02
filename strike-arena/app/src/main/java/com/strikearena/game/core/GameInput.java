package com.strikearena.game.core;

/** Estado de entrada de um jogador (joystick, mira, botões). */
public class GameInput {
    public float moveX, moveY;
    public float aimX, aimY;
    public boolean aimActive;
    public boolean fire;
    public boolean firePressed;
    public boolean reload;
    public boolean dash;
    public int weaponSwitch;

    public synchronized void resetButtons() {
        firePressed = false;
        reload = false;
        dash = false;
        weaponSwitch = 0;
    }

    public synchronized void copyTo(GameInput o) {
        o.moveX = moveX; o.moveY = moveY;
        o.aimX = aimX; o.aimY = aimY;
        o.aimActive = aimActive;
        o.fire = fire; o.firePressed = firePressed;
        o.reload = reload; o.dash = dash;
        o.weaponSwitch = weaponSwitch;
    }
}
