package com.vibestream.shooter;

import android.app.Activity;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.*;
import java.util.List;

public class RankingActivity extends Activity {
    private GameDatabase db;
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, 
                             WindowManager.LayoutParams.FLAG_FULLSCREEN);
        db = new GameDatabase(this);
        
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#0a0a12"));
        root.setPadding(20, 20, 20, 20);
        
        // Title
        TextView title = new TextView(this);
        title.setText("🏆 RANKING");
        title.setTextSize(32);
        title.setTextColor(Color.parseColor("#FFD700"));
        title.setTypeface(null, Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, 30, 0, 30);
        root.addView(title);
        
        // Stats
        TextView stats = new TextView(this);
        stats.setText("Seu recorde: " + db.getHighScore() + " pts | Nível: " + db.getLevel());
        stats.setTextColor(Color.parseColor("#a0a0b8"));
        stats.setTextSize(16);
        stats.setGravity(Gravity.CENTER);
        stats.setPadding(0, 0, 0, 20);
        root.addView(stats);
        
        // Table header
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setPadding(10, 10, 10, 10);
        header.setBackgroundColor(Color.parseColor("#1a1a2e"));
        
        String[] cols = {"#", "JOGADOR", "SCORE", "WAVE", "KILLS"};
        int[] weights = {1, 3, 2, 1, 1};
        for (int i = 0; i < cols.length; i++) {
            TextView tv = new TextView(this);
            tv.setText(cols[i]);
            tv.setTextColor(Color.parseColor("#6C5CE7"));
            tv.setTextSize(13);
            tv.setTypeface(null, Typeface.BOLD);
            tv.setLayoutParams(new LinearLayout.LayoutParams(0, 
                LinearLayout.LayoutParams.WRAP_CONTENT, weights[i]));
            header.addView(tv);
        }
        root.addView(header);
        
        // Ranking entries
        List<String[]> ranking = db.getRanking();
        if (ranking.isEmpty()) {
            TextView empty = new TextView(this);
            empty.setText("Nenhuma partida ainda.\nJogue para aparecer no ranking!");
            empty.setTextColor(Color.parseColor("#555566"));
            empty.setTextSize(16);
            empty.setGravity(Gravity.CENTER);
            empty.setPadding(0, 60, 0, 60);
            root.addView(empty);
        } else {
            for (int i = 0; i < ranking.size(); i++) {
                LinearLayout row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                row.setPadding(10, 12, 10, 12);
                if (i % 2 == 1) row.setBackgroundColor(Color.parseColor("#0d0d18"));
                
                String[] data = ranking.get(i);
                String[] vals = {String.valueOf(i + 1), data[0], data[1], data[2], data[3]};
                
                for (int j = 0; j < vals.length; j++) {
                    TextView tv = new TextView(this);
                    tv.setText(vals[j]);
                    tv.setTextColor(j == 0 ? Color.parseColor("#FFD700") : Color.WHITE);
                    tv.setTextSize(14);
                    tv.setLayoutParams(new LinearLayout.LayoutParams(0, 
                        LinearLayout.LayoutParams.WRAP_CONTENT, weights[j]));
                    row.addView(tv);
                }
                root.addView(row);
            }
        }
        
        // Back
        Button backBtn = new Button(this);
        backBtn.setText("← VOLTAR");
        backBtn.setTextColor(Color.WHITE);
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(12);
        bg.setColor(Color.parseColor("#1a1a2e"));
        bg.setStroke(2, Color.parseColor("#2a2a44"));
        backBtn.setBackground(bg);
        backBtn.setOnClickListener(v -> finish());
        root.addView(backBtn);
        
        setContentView(root);
    }
}
