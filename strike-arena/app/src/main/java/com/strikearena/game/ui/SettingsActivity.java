package com.strikearena.game.ui;

import android.app.Activity;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;

import com.strikearena.game.audio.SoundManager;
import com.strikearena.game.data.Prefs;

/** Configurações do jogo (salvas em SharedPreferences). */
public class SettingsActivity extends Activity {

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Ui.fullscreen(this);
        Prefs prefs = Prefs.get(this);
        ScrollView sv = Ui.screen(this);
        LinearLayout col = Ui.colOf(sv);

        col.addView(Ui.title(this, "⚙ CONFIGURAÇÕES"));

        LinearLayout soundPanel = Ui.panel(this);
        Switch soundSw = new Switch(this);
        soundSw.setText("Efeitos sonoros");
        soundSw.setTextColor(0xFFF2F5FA);
        soundSw.setChecked(prefs.soundOn());
        soundPanel.addView(soundSw);
        Switch musicSw = new Switch(this);
        musicSw.setText("Música ambiente");
        musicSw.setTextColor(0xFFF2F5FA);
        musicSw.setChecked(prefs.musicOn());
        soundPanel.addView(musicSw);
        col.addView(soundPanel);

        LinearLayout sensPanel = Ui.panel(this);
        sensPanel.addView(Ui.label(this, "Sensibilidade da mira"));
        SeekBar sens = new SeekBar(this);
        sens.setMax(170);
        sens.setProgress((int) ((prefs.sens() - 0.3f) / 1.7f * 170f));
        sensPanel.addView(sens);
        TextView sensVal = new TextView(this);
        sensVal.setTextColor(0xFF8FA3C8);
        sensVal.setTextSize(12);
        sensPanel.addView(sensVal);
        sens.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar sb, int p, boolean fromUser) {
                float v = 0.3f + 1.7f * p / 170f;
                Prefs.get(SettingsActivity.this).setSens(v);
                sensVal.setText(String.format("%.2f", v));
            }
            @Override public void onStartTrackingTouch(SeekBar sb) {}
            @Override public void onStopTrackingTouch(SeekBar sb) {}
        });
        col.addView(sensPanel);

        LinearLayout joyPanel = Ui.panel(this);
        joyPanel.addView(Ui.label(this, "Tamanho do joystick"));
        SeekBar joy = new SeekBar(this);
        joy.setMax(70);
        joy.setProgress((int) ((prefs.joystickScale() - 0.7f) / 0.7f * 70f));
        joyPanel.addView(joy);
        TextView joyVal = new TextView(this);
        joyVal.setTextColor(0xFF8FA3C8);
        joyVal.setTextSize(12);
        joyPanel.addView(joyVal);
        joy.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar sb, int p, boolean fromUser) {
                float v = 0.7f + 0.7f * p / 70f;
                Prefs.get(SettingsActivity.this).setJoystickScale(v);
                joyVal.setText(String.format("%.2f", v));
            }
            @Override public void onStartTrackingTouch(SeekBar sb) {}
            @Override public void onStopTrackingTouch(SeekBar sb) {}
        });
        col.addView(joyPanel);

        LinearLayout qPanel = Ui.panel(this);
        qPanel.addView(Ui.label(this, "Qualidade gráfica (otimização)"));
        RadioGroup qRg = new RadioGroup(this);
        String[] opts = {"Baixa (sem partículas)", "Média (recomendada)", "Alta"};
        for (int i = 0; i < opts.length; i++) {
            android.widget.RadioButton rb = new android.widget.RadioButton(this);
            rb.setId(i + 1);
            rb.setText(opts[i]);
            rb.setTextColor(0xFFCFD9EA);
            if (i == prefs.quality()) rb.setChecked(true);
            qRg.addView(rb);
        }
        qPanel.addView(qRg);
        col.addView(qPanel);

        LinearLayout miscPanel = Ui.panel(this);
        Switch fpsSw = new Switch(this);
        fpsSw.setText("Mostrar FPS");
        fpsSw.setTextColor(0xFFF2F5FA);
        fpsSw.setChecked(prefs.showFps());
        miscPanel.addView(fpsSw);
        Switch assistSw = new Switch(this);
        assistSw.setText("Mira automática (assistência)");
        assistSw.setTextColor(0xFFF2F5FA);
        assistSw.setChecked(prefs.aimAssist());
        miscPanel.addView(assistSw);
        col.addView(miscPanel);

        Button save = Ui.button(this, "SALVAR", true);
        col.addView(save);
        Button back = Ui.button(this, "Voltar", false);
        col.addView(back);

        save.setOnClickListener(v -> {
            SoundManager.get(this).play("click");
            Prefs p = Prefs.get(this);
            p.setSound(soundSw.isChecked());
            p.setMusic(musicSw.isChecked());
            p.setShowFps(fpsSw.isChecked());
            p.setAimAssist(assistSw.isChecked());
            int qId = qRg.getCheckedRadioButtonId();
            p.setQuality(qId <= 0 ? 1 : qId - 1);
            if (p.musicOn()) SoundManager.get(this).startAmbient();
            else SoundManager.get(this).stopAmbient();
            Toast(this, "Configurações salvas!");
        });
        back.setOnClickListener(v -> { SoundManager.get(this).play("click"); finish(); });
    }

    private void Toast(android.content.Context c, String m) {
        android.widget.Toast.makeText(c, m, android.widget.Toast.LENGTH_SHORT).show();
    }
}
