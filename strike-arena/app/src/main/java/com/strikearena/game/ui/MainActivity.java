package com.strikearena.game.ui;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.TextView;

import com.strikearena.game.audio.SoundManager;
import com.strikearena.game.core.Game;
import com.strikearena.game.gl.MatchActivity3D;
import com.strikearena.game.data.Account;
import com.strikearena.game.data.Db;
import com.strikearena.game.data.Prefs;

/** Menu principal. */
public class MainActivity extends Activity {
    private TextView cardName, cardLevel, cardStats;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Ui.fullscreen(this);
        ScrollView sv = Ui.screen(this);
        LinearLayout col = Ui.colOf(sv);

        col.addView(new PolyLogoView(this));
        col.addView(Ui.title(this, "⚡ VIBESTRIKE 3D"));
        col.addView(Ui.sub(this, "Tiro 2D LOW-POLY • Polícia vs Rivais • offline e LAN"));

        LinearLayout card = Ui.panel(this);
        cardName = new TextView(this);
        cardName.setTextSize(19);
        cardName.setTextColor(0xFFF2F5FA);
        cardName.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        card.addView(cardName);
        cardLevel = new TextView(this);
        cardLevel.setTextSize(14);
        cardLevel.setTextColor(0xFFFFC53D);
        card.addView(cardLevel);
        cardStats = new TextView(this);
        cardStats.setTextSize(13);
        cardStats.setTextColor(0xFF8FA3C8);
        card.addView(cardStats);
        col.addView(card);

        col.addView(Ui.button(this, "▶ JOGAR", true));
        col.addView(Ui.button(this, "🌐 MULTIJOGADOR (LAN)", false));
        col.addView(Ui.button(this, "🛒 LOJA DE SKINS", false));
        col.addView(Ui.button(this, "🏆 RANKING", false));
        col.addView(Ui.button(this, "👤 CONTA", false));
        col.addView(Ui.button(this, "⚙ CONFIGURAÇÕES", false));
        Button exit = Ui.button(this, "Sair", false);
        col.addView(exit);

        Button play = (Button) col.getChildAt(3);
        Button lan = (Button) col.getChildAt(4);
        Button shop = (Button) col.getChildAt(5);
        Button rank = (Button) col.getChildAt(6);
        Button account = (Button) col.getChildAt(7);
        Button settings = (Button) col.getChildAt(8);

        play.setOnClickListener(v -> { SoundManager.get(this).play("click"); showPlayDialog(); });
        lan.setOnClickListener(v -> { SoundManager.get(this).play("click"); startActivity(new Intent(this, OnlineActivity.class)); });
        shop.setOnClickListener(v -> { SoundManager.get(this).play("click"); startActivity(new Intent(this, ShopActivity.class)); });
        rank.setOnClickListener(v -> { SoundManager.get(this).play("click"); startActivity(new Intent(this, RankingActivity.class)); });
        account.setOnClickListener(v -> { SoundManager.get(this).play("click"); startActivity(new Intent(this, LoginActivity.class)); });
        settings.setOnClickListener(v -> { SoundManager.get(this).play("click"); startActivity(new Intent(this, SettingsActivity.class)); });
        exit.setOnClickListener(v -> finish());
    }

    private void showPlayDialog() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = Ui.dp(this, 18);
        box.setPadding(pad, pad, pad, 0);

        RadioGroup modeRg = addGroup(box, "Modo", new String[]{"POLÍCIA vs RIVAIS (4x4 bots)", "Todos Contra Todos", "Sobrevivência (ondas)", "TREINO (prática livre)"});
        RadioGroup mapRg = addGroup(box, "Mapa", new String[]{"Comunidade Vila Nova", "Depósito", "Zona Norte"});
        RadioGroup diffRg = addGroup(box, "Dificuldade", new String[]{"Fácil", "Normal", "Difícil"});
        modeRg.check(1); mapRg.check(1); diffRg.check(2);

        new AlertDialog.Builder(this)
                .setTitle("Nova partida")
                .setView(box)
                .setNegativeButton("Cancelar", null)
                .setPositiveButton("JOGAR", (d, w) -> {
                    int mode = indexOf(modeRg);
                    int map = indexOf(mapRg);
                    int diff = indexOf(diffRg);
                    Prefs prefs = Prefs.get(this);
                    int skin = 0;
                    if (!prefs.isGuest) {
                        Account a = Db.get(this).get(prefs.activeAccount);
                        if (a != null) skin = a.skinEquipped;
                    }
                    Intent i = new Intent(this, MatchActivity3D.class);
                    i.putExtra("mode", mode);
                    i.putExtra("map", map);
                    i.putExtra("diff", diff);
                    i.putExtra("skin", skin);
                    i.putExtra("host", false);
                    startActivity(i);
                }).show();
    }

    private RadioGroup addGroup(LinearLayout parent, String title, String[] options) {
        TextView t = new TextView(this);
        t.setText(title);
        t.setTextSize(15);
        t.setTextColor(0xFFF2F5FA);
        t.setPadding(0, Ui.dp(this, 12), 0, Ui.dp(this, 6));
        parent.addView(t);
        RadioGroup rg = new RadioGroup(this);
        for (int i = 0; i < options.length; i++) {
            android.widget.RadioButton rb = new android.widget.RadioButton(this);
            rb.setId(parent.getChildCount() * 100 + i + 1);
            rb.setText(options[i]);
            rb.setTextColor(0xFFCFD9EA);
            rb.setTextSize(14);
            rg.addView(rb);
        }
        parent.addView(rg);
        return rg;
    }

    private int indexOf(RadioGroup rg) {
        int id = rg.getCheckedRadioButtonId();
        if (id <= 0) return 0;
        int base = id - 1;
        int count = rg.getChildCount();
        int firstId = ((android.widget.RadioButton) rg.getChildAt(0)).getId();
        if (firstId <= 0) return 0;
        int idx = base - firstId;
        return Math.max(0, Math.min(count - 1, idx));
    }

    @Override protected void onResume() {
        super.onResume();
        SoundManager.get(this).preload();
        SoundManager.get(this).startAmbient();
        Prefs prefs = Prefs.get(this);
        cardName.setText("👤 " + prefs.playerName());
        if (prefs.isGuest) {
            cardLevel.setText("Modo convidado — crie uma conta para salvar progresso");
            cardStats.setText("");
        } else {
            Account a = Db.get(this).get(prefs.activeAccount);
            if (a != null) {
                cardLevel.setText("Nível " + a.level() + "   (" + a.xpIntoLevel() + "/" + a.xpForNextLevel() + " XP)");
                cardStats.setText("🪙 " + a.coins + " moedas   •   Abates: " + a.kills
                        + "   •   Vitórias: " + a.wins + "   •   Partidas: " + a.matches);
            }
        }
    }
}
