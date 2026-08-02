package com.strikearena.game.core;

import java.util.Random;

/** Cérebro simples de bot: patrulha, persegue, atira, recua e recarrega. */
public class BotBrain {
    private final Random rnd = new Random();
    private float thinkT;
    private float strafeDir = 1f;
    private float burstT;
    private float patrolX, patrolY;
    private boolean hasPatrol;
    private PlayerEnt target;
    private boolean targetVisible;
    private float targetDist;

    public void update(Game g, PlayerEnt me, float dt) {
        if (!me.alive) return;
        thinkT -= dt;
        target = g.nearestEnemy(me);
        targetVisible = false;
        float dx = 0, dy = 0;
        if (target != null) {
            dx = target.x - me.x;
            dy = target.y - me.y;
            targetDist = (float) Math.sqrt(dx * dx + dy * dy);
            targetVisible = targetDist < g.botSightRange(me) && g.lineOfSight(me.x, me.y, target.x, target.y);
        }
        if (thinkT <= 0) {
            thinkT = 0.10f + rnd.nextFloat() * 0.18f;
            if (rnd.nextFloat() < 0.25f) strafeDir = -strafeDir;
        }

        float mvx = 0, mvy = 0;
        float desiredAim = me.aim;

        boolean lowHp = me.hp < 32f;
        if (targetVisible) {
            desiredAim = (float) Math.atan2(target.y - me.y, target.x - me.x);
            float err = g.botAimError(me) * (rnd.nextFloat() - 0.5f) * 2f;
            desiredAim += err;

            float preferred = g.botPreferredRange(me);
            if (lowHp && targetDist < 600f) {
                mvx = -dx / targetDist; mvy = -dy / targetDist; // recua
            } else if (targetDist > preferred + 90f) {
                mvx = dx / targetDist; mvy = dy / targetDist;
            } else if (targetDist < preferred - 90f) {
                mvx = -dx / targetDist; mvy = -dy / targetDist;
            }
            float pdx = -dy / targetDist, pdy = dx / targetDist;
            mvx += pdx * strafeDir * 0.7f;
            mvy += pdy * strafeDir * 0.7f;

            burstT -= dt;
            float fireRange = g.botFireRange(me);
            if (targetDist < fireRange && !me.reloading && me.ammo[me.weapon] > 0) {
                if (burstT <= 0) {
                    g.fireWeapon(me);
                    burstT = 0.09f + g.botFireRate(me) + rnd.nextFloat() * 0.12f;
                    if (rnd.nextFloat() < 0.06f) burstT = 0f; // rajada dupla
                }
            } else if (me.ammo[me.weapon] <= 0 && me.reserve[me.weapon] > 0) {
                g.startReload(me);
            } else if (me.ammo[me.weapon] <= 0) {
                burstT = 0f;
            }
        } else {
            // Patrulha: anda até um ponto aleatório
            if (!hasPatrol || dist(me.x, me.y, patrolX, patrolY) < 60f) {
                patrolX = 160 + rnd.nextFloat() * (g.map.w - 320);
                patrolY = 160 + rnd.nextFloat() * (g.map.h - 320);
                hasPatrol = true;
            }
            float pdx0 = patrolX - me.x, pdy0 = patrolY - me.y;
            float d = (float) Math.sqrt(pdx0 * pdx0 + pdy0 * pdy0);
            if (d > 1f) { mvx = pdx0 / d; mvy = pdy0 / d; }
            if (me.reloading) {
                g.continueReload(me, dt);
            }
        }

        // suaviza a mira
        float diff = (float) Math.atan2(Math.sin(desiredAim - me.aim), Math.cos(desiredAim - me.aim));
        me.aim += diff * Math.min(1f, dt * 7f);

        if (mvx != 0 || mvy != 0) {
            float d = (float) Math.sqrt(mvx * mvx + mvy * mvy);
            g.movePlayer(me, mvx / d, mvy / d, dt);
        }
        if (me.reloading) g.continueReload(me, dt);
        me.fireCd -= dt;
    }

    private float dist(float x1, float y1, float x2, float y2) {
        float dx = x1 - x2, dy = y1 - y2;
        return (float) Math.sqrt(dx * dx + dy * dy);
    }
}
