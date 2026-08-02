package com.strikearena.game.ui;

import android.app.Activity;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import com.strikearena.game.audio.SoundManager;
import com.strikearena.game.core.Skins;
import com.strikearena.game.data.Account;
import com.strikearena.game.data.Db;
import com.strikearena.game.data.Prefs;

/** Loja de skins (compra e equipa, salvo por conta). */
public class ShopActivity extends Activity {
    private TextView coinsLabel;
    private LinearLayout rows;
    private Account acc;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Ui.fullscreen(this);
        ScrollView sv = Ui.screen(this);
        LinearLayout col = Ui.colOf(sv);
        col.addView(Ui.title(this, "🛒 LOJA DE SKINS"));
        coinsLabel = new TextView(this);
        coinsLabel.setTextSize(16);
        coinsLabel.setTextColor(0xFFFFC53D);
        coinsLabel.setPadding(0, 0, 0, Ui.dp(this, 8));
        col.addView(coinsLabel);
        rows = new LinearLayout(this);
        rows.setOrientation(LinearLayout.VERTICAL);
        col.addView(rows);
        Button back = Ui.button(this, "Voltar", false);
        col.addView(back);
        back.setOnClickListener(v -> { SoundManager.get(this).play("click"); finish(); });
    }

    @Override protected void onResume() {
        super.onResume();
        Prefs prefs = Prefs.get(this);
        if (prefs.isGuest) {
            LinearLayout col = Ui.colOf(Ui.screen(this));
            col.addView(Ui.title(this, "🛒 LOJA DE SKINS"));
            col.addView(Ui.sub(this, "Crie uma conta no menu CONTA para comprar skins."));
            Button b = Ui.button(this, "Voltar", false);
            b.setOnClickListener(v -> finish());
            col.addView(b);
            setContentView((android.view.View) col.getParent());
            return;
        }
        acc = Db.get(this).get(prefs.activeAccount);
        if (acc == null) return;
        coinsLabel.setText("🪙 Moedas: " + acc.coins);
        buildRows();
    }

    private void buildRows() {
        rows.removeAllViews();
        for (Skins.Def s : Skins.ALL) {
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(android.view.Gravity.CENTER_VERTICAL);
            row.setPadding(Ui.dp(this, 10), Ui.dp(this, 6), Ui.dp(this, 10), Ui.dp(this, 6));
            row.setBackgroundResource(com.strikearena.game.R.drawable.panel);
            android.widget.LinearLayout.LayoutParams lp = new android.widget.LinearLayout.LayoutParams(
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.bottomMargin = Ui.dp(this, 8);
            row.setLayoutParams(lp);

            row.addView(new SkinPreview(this, s));
            LinearLayout info = new LinearLayout(this);
            info.setOrientation(LinearLayout.VERTICAL);
            info.setPadding(Ui.dp(this, 12), 0, Ui.dp(this, 8), 0);
            TextView name = new TextView(this);
            name.setText(s.name);
            name.setTextColor(0xFFF2F5FA);
            name.setTextSize(16);
            name.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            info.addView(name);
            TextView price = new TextView(this);
            price.setText(s.price == 0 ? "GRATUITA" : "🪙 " + s.price + " moedas");
            price.setTextColor(s.price == 0 ? 0xFF3ECF7E : 0xFFFFC53D);
            price.setTextSize(13);
            info.addView(price);
            row.addView(info, new LinearLayout.LayoutParams(0, android.view.ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

            boolean owned = acc.ownsSkin(s.id);
            Button btn = Ui.button(this, owned ? (acc.skinEquipped == s.id ? "EQUIPADA ✓" : "EQUIPAR") : "COMPRAR",
                    owned && acc.skinEquipped == s.id);
            btn.setLayoutParams(new LinearLayout.LayoutParams(Ui.dp(this, 130), Ui.dp(this, 46)));
            int sid = s.id;
            btn.setOnClickListener(v -> {
                SoundManager.get(this).play("click");
                if (acc.ownsSkin(sid)) {
                    acc.equipSkin(sid);
                    Db.get(this).save(acc);
                    buildRows();
                } else if (acc.coins >= s.price) {
                    acc.coins -= s.price;
                    acc.addSkin(sid);
                    acc.equipSkin(sid);
                    Db.get(this).save(acc);
                    coinsLabel.setText("🪙 Moedas: " + acc.coins);
                    SoundManager.get(this).play("coin");
                    buildRows();
                } else {
                    Toast.makeText(this, "Moedas insuficientes. Jogue partidas para ganhar mais!", Toast.LENGTH_SHORT).show();
                }
            });
            row.addView(btn);
            rows.addView(row);
        }
    }

    /** Prévia da skin desenhada em tempo real. */
    static class SkinPreview extends View {
        final Skins.Def def;
        final Paint p = new Paint();

        SkinPreview(android.content.Context c, Skins.Def def) {
            super(c);
            this.def = def;
            p.setAntiAlias(true);
        }

        @Override protected void onMeasure(int w, int h) {
            setMeasuredDimension(Ui.dp(getContext(), 58), Ui.dp(getContext(), 58));
        }

        @Override protected void onDraw(Canvas c) {
            float cx = getWidth() / 2f, cy = getHeight() / 2f;
            p.setColor(0x33000000);
            c.drawCircle(cx, cy + 3, 22, p);
            p.setColor(def.body);
            c.drawCircle(cx, cy, 22, p);
            p.setColor(def.sec);
            c.drawCircle(cx + 6, cy - 8, 6, p);
            p.setColor(def.visor);
            c.drawCircle(cx, cy, 8, p);
            p.setColor(def.sec);
            c.drawRect(cx + 8, cy - 3, cx + 26, cy + 3, p);
        }
    }
}
