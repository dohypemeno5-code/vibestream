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

public class ShopActivity extends Activity {
    private GameDatabase db;
    private LinearLayout gridContainer;
    
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
        title.setText("🏪 LOJA DE SKINS");
        title.setTextSize(32);
        title.setTextColor(Color.parseColor("#6C5CE7"));
        title.setTypeface(null, Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, 30, 0, 10);
        root.addView(title);
        
        // Coins display
        TextView coinsTv = new TextView(this);
        coinsTv.setText("💰 $" + db.getCoins());
        coinsTv.setTextSize(20);
        coinsTv.setTextColor(Color.parseColor("#FFD700"));
        coinsTv.setGravity(Gravity.CENTER);
        coinsTv.setPadding(0, 0, 0, 20);
        root.addView(coinsTv);
        
        // Grid container
        gridContainer = new LinearLayout(this);
        gridContainer.setOrientation(LinearLayout.VERTICAL);
        root.addView(gridContainer);
        
        loadSkins();
        
        // Back button
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
    
    private void loadSkins() {
        gridContainer.removeAllViews();
        List<String[]> skins = db.getAllSkins();
        
        LinearLayout row = null;
        for (int i = 0; i < skins.size(); i++) {
            if (i % 2 == 0) {
                row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                row.setPadding(0, 5, 0, 5);
            }
            
            String[] skin = skins.get(i);
            int id = Integer.parseInt(skin[0]);
            String name = skin[1];
            String color = skin[2];
            int price = Integer.parseInt(skin[3]);
            boolean owned = Integer.parseInt(skin[4]) == 1;
            boolean active = db.getCurrentSkin() == id;
            
            CardView card = new CardView(this, id, name, color, price, owned, active);
            
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0,
                LinearLayout.LayoutParams.WRAP_CONTENT, 1);
            params.setMargins(5, 5, 5, 5);
            card.setLayoutParams(params);
            
            if (row != null) row.addView(card);
            if (i % 2 == 1 || i == skins.size() - 1) {
                gridContainer.addView(row);
            }
        }
    }
    
    private class CardView extends LinearLayout {
        public CardView(Activity activity, int id, String name, String color, 
                       int price, boolean owned, boolean active) {
            super(activity);
            setOrientation(VERTICAL);
            setPadding(15, 15, 15, 15);
            setGravity(Gravity.CENTER);
            
            GradientDrawable bg = new GradientDrawable();
            bg.setCornerRadius(16);
            if (active) {
                bg.setColor(Color.parseColor("#2a2a44"));
                bg.setStroke(3, Color.parseColor("#6C5CE7"));
            } else if (owned) {
                bg.setColor(Color.parseColor("#1a1a2e"));
                bg.setStroke(2, Color.parseColor("#3a3a55"));
            } else {
                bg.setColor(Color.parseColor("#15152a"));
                bg.setStroke(2, Color.parseColor("#2a2a44"));
            }
            setBackground(bg);
            
            // Color preview
            View preview = new View(activity);
            preview.setBackgroundColor(Color.parseColor(color));
            LinearLayout.LayoutParams previewParams = new LinearLayout.LayoutParams(80, 80);
            previewParams.setMargins(0, 10, 0, 10);
            preview.setLayoutParams(previewParams);
            addView(preview);
            
            // Name
            TextView nameTv = new TextView(activity);
            nameTv.setText(name);
            nameTv.setTextColor(Color.WHITE);
            nameTv.setTextSize(14);
            nameTv.setGravity(Gravity.CENTER);
            addView(nameTv);
            
            if (active) {
                TextView activeTv = new TextView(activity);
                activeTv.setText("✓ ATIVO");
                activeTv.setTextColor(Color.parseColor("#00FF00"));
                activeTv.setTextSize(12);
                activeTv.setGravity(Gravity.CENTER);
                addView(activeTv);
            } else if (owned) {
                Button useBtn = new Button(activity);
                useBtn.setText("USAR");
                useBtn.setTextColor(Color.WHITE);
                useBtn.setTextSize(12);
                GradientDrawable btnBg = new GradientDrawable();
                btnBg.setCornerRadius(8);
                btnBg.setColor(Color.parseColor("#6C5CE7"));
                useBtn.setBackground(btnBg);
                useBtn.setOnClickListener(v -> {
                    db.setSkin(id);
                    loadSkins();
                });
                addView(useBtn);
            } else {
                Button buyBtn = new Button(activity);
                buyBtn.setText("$" + price);
                buyBtn.setTextColor(Color.WHITE);
                buyBtn.setTextSize(12);
                GradientDrawable btnBg = new GradientDrawable();
                btnBg.setCornerRadius(8);
                btnBg.setColor(Color.parseColor("#FF8800"));
                buyBtn.setBackground(btnBg);
                buyBtn.setOnClickListener(v -> {
                    if (db.spendCoins(price)) {
                        db.buySkin(id);
                        db.setSkin(id);
                        Toast.makeText(activity, "✅ Skin " + name + " comprada!", Toast.LENGTH_SHORT).show();
                        loadSkins();
                    } else {
                        Toast.makeText(activity, "❌ Moedas insuficientes!", Toast.LENGTH_SHORT).show();
                    }
                });
                addView(buyBtn);
            }
        }
    }
}
