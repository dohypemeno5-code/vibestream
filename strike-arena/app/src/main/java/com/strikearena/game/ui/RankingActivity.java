package com.strikearena.game.ui;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ScrollView;
import android.widget.TextView;

import com.strikearena.game.audio.SoundManager;
import com.strikearena.game.core.Skins;
import com.strikearena.game.data.Account;
import com.strikearena.game.data.Db;

import java.util.List;

/** Ranking local dos jogadores por XP. */
public class RankingActivity extends Activity {

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Ui.fullscreen(this);
        ScrollView sv = Ui.screen(this);
        LinearLayout col = Ui.colOf(sv);
        col.addView(Ui.title(this, "🏆 RANKING LOCAL"));
        col.addView(Ui.sub(this, "Classificação dos jogadores deste aparelho (por XP)"));

        List<Account> list = Db.get(this).leaderboard(10);
        if (list.isEmpty()) {
            col.addView(Ui.sub(this, "Nenhum jogador ainda. Crie uma conta e jogue!"));
        } else {
            ListView lv = new ListView(this);
            lv.setDivider(null);
            lv.setAdapter(new Adapter(list));
            lv.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 42 * list.size() + 16)));
            col.addView(lv);
        }
        Button back = Ui.button(this, "Voltar", false);
        col.addView(back);
        back.setOnClickListener(v -> { SoundManager.get(this).play("click"); finish(); });
    }

    private class Adapter extends BaseAdapter {
        final List<Account> items;
        Adapter(List<Account> items) { this.items = items; }
        @Override public int getCount() { return items.size(); }
        @Override public Object getItem(int i) { return items.get(i); }
        @Override public long getItemId(int i) { return i; }

        @Override public View getView(int i, View convert, ViewGroup parent) {
            Account a = items.get(i);
            LinearLayout row = new LinearLayout(RankingActivity.this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(android.view.Gravity.CENTER_VERTICAL);
            row.setPadding(Ui.dp(RankingActivity.this, 14), Ui.dp(RankingActivity.this, 10),
                    Ui.dp(RankingActivity.this, 14), Ui.dp(RankingActivity.this, 10));
            row.setBackgroundResource(com.strikearena.game.R.drawable.panel);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.bottomMargin = Ui.dp(RankingActivity.this, 6);
            row.setLayoutParams(lp);

            TextView pos = new TextView(RankingActivity.this);
            pos.setText("#" + (i + 1));
            pos.setTextSize(17);
            pos.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            pos.setTextColor(i == 0 ? 0xFFFFC53D : 0xFF8FA3C8);
            row.addView(pos);

            LinearLayout info = new LinearLayout(RankingActivity.this);
            info.setOrientation(LinearLayout.VERTICAL);
            info.setPadding(Ui.dp(RankingActivity.this, 14), 0, 0, 0);
            TextView name = new TextView(RankingActivity.this);
            name.setText(a.name + "  •  Nível " + a.level());
            name.setTextColor(0xFFF2F5FA);
            name.setTextSize(15);
            name.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            info.addView(name);
            TextView stats = new TextView(RankingActivity.this);
            stats.setText("XP " + a.xp + "   🪙 " + a.coins + "   Abates " + a.kills + "   Vitórias " + a.wins);
            stats.setTextColor(0xFF8FA3C8);
            stats.setTextSize(12);
            info.addView(stats);
            row.addView(info, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

            // avatar com a cor da skin equipada
            TextView av = new TextView(RankingActivity.this);
            Skins.Def sk = Skins.get(a.skinEquipped);
            av.setText("●");
            av.setTextColor(sk.body);
            av.setTextSize(26);
            row.addView(av);
            return row;
        }
    }
}
