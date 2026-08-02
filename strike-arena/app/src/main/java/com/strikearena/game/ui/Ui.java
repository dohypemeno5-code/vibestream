package com.strikearena.game.ui;

import android.app.Activity;
import android.content.Context;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Helpers para construção de telas sem dependências externas. */
public final class Ui {
    private Ui() {}

    public static void fullscreen(Activity a) {
        Window w = a.getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            w.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    /** Raiz rolável com fundo do tema e padding seguro (edge-to-edge). */
    public static ScrollView screen(Activity a) {
        ScrollView sv = new ScrollView(a);
        sv.setFillViewport(true);
        sv.setBackgroundResource(com.strikearena.game.R.drawable.bg_theme);
        LinearLayout col = new LinearLayout(a);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        int pad = dp(a, 18);
        col.setPadding(pad, dp(a, 30), pad, dp(a, 40));
        sv.addView(col);
        return sv;
    }

    public static LinearLayout colOf(ScrollView sv) {
        return (LinearLayout) sv.getChildAt(0);
    }

    public static int dp(Context c, int v) {
        return Math.round(c.getResources().getDisplayMetrics().density * v);
    }

    public static TextView title(Context c, String text) {
        TextView t = new TextView(c);
        t.setText(text);
        t.setTextSize(26);
        t.setTextColor(0xFFF2F5FA);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setGravity(Gravity.CENTER);
        t.setPadding(0, dp(c, 8), 0, dp(c, 8));
        return t;
    }

    public static TextView sub(Context c, String text) {
        TextView t = new TextView(c);
        t.setText(text);
        t.setTextSize(14);
        t.setTextColor(0xFF8FA3C8);
        t.setGravity(Gravity.CENTER);
        t.setPadding(0, 0, 0, dp(c, 10));
        return t;
    }

    public static TextView label(Context c, String text) {
        TextView t = new TextView(c);
        t.setText(text);
        t.setTextSize(15);
        t.setTextColor(0xFFF2F5FA);
        t.setPadding(dp(c, 2), dp(c, 10), dp(c, 2), dp(c, 4));
        return t;
    }

    public static LinearLayout panel(Context c) {
        LinearLayout p = new LinearLayout(c);
        p.setOrientation(LinearLayout.VERTICAL);
        p.setBackgroundResource(com.strikearena.game.R.drawable.panel);
        p.setPadding(dp(c, 14), dp(c, 12), dp(c, 14), dp(c, 12));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(c, 10);
        p.setLayoutParams(lp);
        return p;
    }

    public static Button button(Context c, String text, boolean primary) {
        Button b = new Button(c);
        b.setText(text);
        b.setTextSize(16);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setTextColor(primary ? 0xFF0B1020 : 0xFFF2F5FA);
        b.setAllCaps(false);
        b.setBackgroundResource(primary ? com.strikearena.game.R.drawable.btn_primary
                : com.strikearena.game.R.drawable.btn_secondary);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(c, 54));
        lp.topMargin = dp(c, 5); lp.bottomMargin = dp(c, 5);
        b.setLayoutParams(lp);
        return b;
    }

    public static EditText input(Context c, String hint, int inputType) {
        EditText e = new EditText(c);
        e.setHint(hint);
        e.setSingleLine(true);
        e.setTextColor(0xFFF2F5FA);
        e.setHintTextColor(0xFF6C7FA3);
        e.setBackgroundResource(com.strikearena.game.R.drawable.input_bg);
        e.setPadding(dp(c, 14), 0, dp(c, 14), 0);
        e.setInputType(inputType);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(c, 50));
        lp.bottomMargin = dp(c, 8);
        e.setLayoutParams(lp);
        return e;
    }

    public static View spacer(Context c, int h) {
        View v = new View(c);
        v.setLayoutParams(new LinearLayout.LayoutParams(1, dp(c, h)));
        return v;
    }

    public static void margins(View v, int top, int bottom) {
        ViewGroup.LayoutParams lp = v.getLayoutParams();
        if (lp instanceof LinearLayout.LayoutParams) {
            ((LinearLayout.LayoutParams) lp).topMargin = dp(v.getContext(), top);
            ((LinearLayout.LayoutParams) lp).bottomMargin = dp(v.getContext(), bottom);
        }
    }
}
