package com.strikearena.game.ui;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.text.InputType;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import com.strikearena.game.audio.SoundManager;
import com.strikearena.game.data.Db;
import com.strikearena.game.data.Prefs;

/** Login opcional / criação de conta. */
public class LoginActivity extends Activity {

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Ui.fullscreen(this);
        ScrollView sv = Ui.screen(this);
        LinearLayout col = Ui.colOf(sv);

        col.addView(Ui.title(this, "👤 CONTA"));
        col.addView(Ui.sub(this, "Login opcional — os dados ficam salvos apenas neste aparelho"));

        android.widget.EditText name = Ui.input(this, "Nome (3-16 caracteres)", InputType.TYPE_CLASS_TEXT);
        android.widget.EditText pass = Ui.input(this, "Senha (mínimo 4 caracteres)", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        col.addView(name);
        col.addView(pass);

        Button enter = Ui.button(this, "ENTRAR", true);
        Button create = Ui.button(this, "CRIAR CONTA", false);
        Button guest = Ui.button(this, "JOGAR COMO CONVIDADO", false);
        Button back = Ui.button(this, "Voltar", false);
        col.addView(enter);
        col.addView(create);
        col.addView(guest);
        col.addView(back);

        enter.setOnClickListener(v -> {
            SoundManager.get(this).play("click");
            String n = name.getText().toString().trim();
            String p = pass.getText().toString();
            com.strikearena.game.data.Account a = Db.get(this).login(n, p);
            if (a == null) {
                Toast.makeText(this, "Usuário ou senha incorretos.", Toast.LENGTH_SHORT).show();
            } else {
                Prefs.get(this).setActiveAccount(a.name);
                Toast.makeText(this, "Bem-vindo, " + a.name + "!", Toast.LENGTH_SHORT).show();
                finish();
            }
        });
        create.setOnClickListener(v -> {
            SoundManager.get(this).play("click");
            String n = name.getText().toString().trim();
            String p = pass.getText().toString();
            if (Db.get(this).register(n, p)) {
                Prefs.get(this).setActiveAccount(n);
                Toast.makeText(this, "Conta criada: " + n + "!", Toast.LENGTH_SHORT).show();
                finish();
            } else {
                Toast.makeText(this, "Não foi possível criar (nome inválido, em uso ou senha curta).", Toast.LENGTH_LONG).show();
            }
        });
        guest.setOnClickListener(v -> {
            SoundManager.get(this).play("click");
            Prefs.get(this).setActiveAccount("");
            Toast.makeText(this, "Modo convidado: progresso não será salvo.", Toast.LENGTH_SHORT).show();
            finish();
        });
        back.setOnClickListener(v -> {
            SoundManager.get(this).play("click");
            finish();
        });
    }
}
