package com.vibestream.shooter;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Typeface;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.*;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;

public class MainActivity extends Activity {
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, 
                             WindowManager.LayoutParams.FLAG_FULLSCREEN);
        
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.parseColor("#0a0a12"));
        root.setPadding(40, 40, 40, 40);
        
        // Title
        TextView title = new TextView(this);
        title.setText("🏙 VIBESTRIKE");
        title.setTextSize(42);
        title.setTextColor(Color.parseColor("#6C5CE7"));
        title.setTypeface(null, Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, 40, 0, 10);
        root.addView(title);
        
        TextView subtitle = new TextView(this);
        subtitle.setText("Batalha na Comunidade • 2D Shooter");
        subtitle.setTextSize(15);
        subtitle.setTextColor(Color.parseColor("#a0a0b8"));
        subtitle.setGravity(Gravity.CENTER);
        subtitle.setPadding(0, 0, 0, 40);
        root.addView(subtitle);
        
        // Menu buttons
        root.addView(createButton("▶ INICIAR PARTIDA (OFFLINE)", v -> {
            startActivity(new Intent(this, GameActivity.class));
        }));
        
        root.addView(createButton("🌐 MODO ONLINE", v -> {
            Toast.makeText(this, "🌐 Modo online em breve - jogando offline por enquanto",
                           Toast.LENGTH_SHORT).show();
            startActivity(new Intent(this, GameActivity.class));
        }));
        
        root.addView(createButton("🏪 LOJA DE SKINS", v -> {
            startActivity(new Intent(this, ShopActivity.class));
        }));
        
        root.addView(createButton("🏆 RANKING", v -> {
            startActivity(new Intent(this, RankingActivity.class));
        }));
        
        root.addView(createButton("⚙ CONFIGURAÇÕES", v -> {
            startActivity(new Intent(this, SettingsActivity.class));
        }));
        
        // Version
        TextView ver = new TextView(this);
        ver.setText("v2.0 | © 2026 VibeStrike | Comunidade Urbana");
        ver.setTextSize(12);
        ver.setTextColor(Color.parseColor("#555566"));
        ver.setGravity(Gravity.CENTER);
        ver.setPadding(0, 60, 0, 0);
        root.addView(ver);
        
        setContentView(root);
    }
    
    private Button createButton(String text, View.OnClickListener listener) {
        Button btn = new Button(this);
        btn.setText(text);
        btn.setTextSize(16);
        btn.setTextColor(Color.WHITE);
        btn.setTypeface(null, Typeface.BOLD);
        btn.setGravity(Gravity.CENTER);
        btn.setPadding(30, 20, 30, 20);
        
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 
            LinearLayout.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, 8, 0, 8);
        btn.setLayoutParams(params);
        
        GradientDrawable gd = new GradientDrawable();
        gd.setCornerRadius(16);
        gd.setColor(Color.parseColor("#1a1a2e"));
        gd.setStroke(2, Color.parseColor("#2a2a44"));
        btn.setBackground(gd);
        
        btn.setOnClickListener(listener);
        return btn;
    }
}
