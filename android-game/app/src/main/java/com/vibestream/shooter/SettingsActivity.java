package com.vibestream.shooter;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.*;

public class SettingsActivity extends Activity {
    private SharedPreferences prefs;
    private GameDatabase db;
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, 
                             WindowManager.LayoutParams.FLAG_FULLSCREEN);
        db = new GameDatabase(this);
        prefs = getSharedPreferences("vibestrike", MODE_PRIVATE);
        
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.parseColor("#0a0a12"));
        root.setPadding(40, 40, 40, 40);
        
        TextView title = new TextView(this);
        title.setText("⚙ CONFIGURAÇÕES");
        title.setTextSize(32);
        title.setTextColor(Color.parseColor("#6C5CE7"));
        title.setTypeface(null, Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, 40, 0, 40);
        root.addView(title);
        
        // Player name
        TextView nameLabel = new TextView(this);
        nameLabel.setText("NOME DO JOGADOR");
        nameLabel.setTextColor(Color.parseColor("#a0a0b8"));
        nameLabel.setTextSize(14);
        nameLabel.setPadding(10, 20, 10, 5);
        root.addView(nameLabel);
        
        EditText nameInput = new EditText(this);
        nameInput.setText(db.getPlayerName());
        nameInput.setTextColor(Color.WHITE);
        nameInput.setTextSize(16);
        nameInput.setGravity(Gravity.CENTER);
        GradientDrawable editBg = new GradientDrawable();
        editBg.setCornerRadius(12);
        editBg.setColor(Color.parseColor("#1a1a2e"));
        editBg.setStroke(2, Color.parseColor("#2a2a44"));
        nameInput.setBackground(editBg);
        nameInput.setPadding(20, 15, 20, 15);
        root.addView(nameInput);
        
        // Save button
        Button saveBtn = new Button(this);
        saveBtn.setText("💾 SALVAR NOME");
        saveBtn.setTextColor(Color.WHITE);
        saveBtn.setTypeface(null, Typeface.BOLD);
        GradientDrawable btnBg = new GradientDrawable();
        btnBg.setCornerRadius(12);
        btnBg.setColor(Color.parseColor("#6C5CE7"));
        saveBtn.setBackground(btnBg);
        saveBtn.setPadding(30, 15, 30, 15);
        saveBtn.setOnClickListener(v -> {
            String name = nameInput.getText().toString().trim();
            if (name.length() < 2) name = "Soldier";
            db.setPlayerName(name);
            Toast.makeText(this, "✅ Nome salvo: " + name, Toast.LENGTH_SHORT).show();
        });
        LinearLayout.LayoutParams btnParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        btnParams.setMargins(0, 20, 0, 30);
        saveBtn.setLayoutParams(btnParams);
        root.addView(saveBtn);
        
        // Sound toggle
        addToggle(root, "🔊 SOM", prefs.getBoolean("sound", true), v -> {
            prefs.edit().putBoolean("sound", v).apply();
        });
        
        // Music toggle
        addToggle(root, "🎵 MÚSICA", prefs.getBoolean("music", true), v -> {
            prefs.edit().putBoolean("music", v).apply();
        });
        
        // Vibration toggle
        addToggle(root, "📳 VIBRAÇÃO", prefs.getBoolean("vibrate", true), v -> {
            prefs.edit().putBoolean("vibrate", v).apply();
        });
        
        // Player stats
        TextView stats = new TextView(this);
        int level = db.getLevel();
        int xp = db.getXP();
        int required = level * 200;
        stats.setText("📊 NÍVEL " + level + " | XP: " + xp + "/" + required + 
                      " | 💰 $" + db.getCoins() + " | 🗡 " + db.getKills() + " kills");
        stats.setTextColor(Color.parseColor("#a0a0b8"));
        stats.setTextSize(14);
        stats.setGravity(Gravity.CENTER);
        stats.setPadding(20, 40, 20, 20);
        root.addView(stats);
        
        // Back button
        Button backBtn = new Button(this);
        backBtn.setText("← VOLTAR");
        backBtn.setTextColor(Color.WHITE);
        GradientDrawable backBg = new GradientDrawable();
        backBg.setCornerRadius(12);
        backBg.setColor(Color.parseColor("#1a1a2e"));
        backBg.setStroke(2, Color.parseColor("#2a2a44"));
        backBtn.setBackground(backBg);
        backBtn.setOnClickListener(v -> finish());
        root.addView(backBtn);
        
        setContentView(root);
    }
    
    private void addToggle(LinearLayout root, String text, boolean defaultValue, 
                          final OnToggleListener listener) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(20, 10, 20, 10);
        
        TextView label = new TextView(this);
        label.setText(text);
        label.setTextColor(Color.WHITE);
        label.setTextSize(18);
        label.setLayoutParams(new LinearLayout.LayoutParams(0, 
            LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        
        Switch toggle = new Switch(this);
        toggle.setChecked(defaultValue);
        toggle.setOnCheckedChangeListener((v, checked) -> listener.onToggle(checked));
        
        row.addView(label);
        row.addView(toggle);
        root.addView(row);
    }
    
    interface OnToggleListener { void onToggle(boolean on); }
}

