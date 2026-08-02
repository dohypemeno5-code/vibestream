package com.strikearena.game.ui;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.text.InputType;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import com.strikearena.game.audio.SoundManager;
import com.strikearena.game.core.Game;
import com.strikearena.game.core.Maps;
import com.strikearena.game.data.Account;
import com.strikearena.game.data.Db;
import com.strikearena.game.data.Prefs;
import com.strikearena.game.gl.MatchActivity3D;
import com.strikearena.game.net.LanProtocol;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** Multijogador online via LAN (mesmo Wi-Fi). */
public class OnlineActivity extends Activity {
    private static class Room {
        String name, ip, players, modeName, mapName;
    }

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Ui.fullscreen(this);
        ScrollView sv = Ui.screen(this);
        LinearLayout col = Ui.colOf(sv);

        col.addView(Ui.title(this, "🌐 MULTIJOGADOR"));
        LinearLayout info = Ui.panel(this);
        TextView t1 = new TextView(this);
        t1.setText("As partidas online funcionam em LAN (mesmo Wi-Fi), sem servidor externo: um aparelho cria a sala e os outros entram.");
        t1.setTextColor(0xFFCFD9EA);
        t1.setTextSize(14);
        info.addView(t1);
        TextView t2 = new TextView(this);
        t2.setText("Nota: não há matchmaking pela internet neste APK — para jogar com amigos à distância seria necessário um servidor dedicado.");
        t2.setTextColor(0xFFFFC53D);
        t2.setTextSize(13);
        t2.setPadding(0, Ui.dp(this, 8), 0, 0);
        info.addView(t2);
        col.addView(info);

        Button create = Ui.button(this, "➕ CRIAR PARTIDA", true);
        Button search = Ui.button(this, "🔍 BUSCAR PARTIDAS", false);
        Button byIp = Ui.button(this, "📡 ENTRAR POR IP", false);
        Button back = Ui.button(this, "Voltar", false);
        col.addView(create);
        col.addView(search);
        col.addView(byIp);
        col.addView(back);

        create.setOnClickListener(v -> { SoundManager.get(this).play("click"); showCreateDialog(); });
        search.setOnClickListener(v -> { SoundManager.get(this).play("click"); searchRooms(); });
        byIp.setOnClickListener(v -> { SoundManager.get(this).play("click"); showJoinByIp(); });
        back.setOnClickListener(v -> { SoundManager.get(this).play("click"); finish(); });
    }

    private void showCreateDialog() {
        Prefs prefs = Prefs.get(this);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = Ui.dp(this, 18);
        box.setPadding(pad, pad, pad, 0);

        EditText roomName = Ui.input(this, "Nome da sala", InputType.TYPE_CLASS_TEXT);
        roomName.setText(prefs.roomName());
        box.addView(roomName);

        RadioGroup mapRg = addGroup(box, "Mapa", new String[]{Maps.ALL[0].name, Maps.ALL[1].name, Maps.ALL[2].name});
        mapRg.check(1);
        RadioGroup modeRg = addGroup(box, "Modo", new String[]{"Polícia vs Rivais", "Todos Contra Todos"});
        modeRg.check(1);

        new AlertDialog.Builder(this)
                .setTitle("Criar sala LAN")
                .setView(box)
                .setNegativeButton("Cancelar", null)
                .setPositiveButton("CRIAR", (d, w) -> {
                    String name = roomName.getText().toString().trim();
                    if (name.isEmpty()) name = "Sala do Jogador";
                    prefs.setRoomName(name);
                    int map = indexOf(mapRg);
                    int mode = indexOf(modeRg) == 0 ? Game.MODE_LAN_TDM : Game.MODE_LAN_FFA;
                    launch(false, true, mode, map, "");
                }).show();
    }

    private void showJoinByIp() {
        Prefs prefs = Prefs.get(this);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = Ui.dp(this, 18);
        box.setPadding(pad, pad, pad, 0);
        EditText ip = Ui.input(this, "IP do anfitrião (ex.: 192.168.0.10)", InputType.TYPE_CLASS_TEXT);
        ip.setText(prefs.lastIp());
        box.addView(ip);
        new AlertDialog.Builder(this)
                .setTitle("Entrar por IP")
                .setView(box)
                .setNegativeButton("Cancelar", null)
                .setPositiveButton("ENTRAR", (d, w) -> {
                    String i = ip.getText().toString().trim();
                    prefs.setLastIp(i);
                    if (i.isEmpty()) {
                        Toast.makeText(this, "Digite o IP do anfitrião.", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    launch(true, false, Game.MODE_LAN_TDM, 0, i);
                }).show();
    }

    private void launch(boolean client, boolean host, int mode, int map, String ip) {
        Prefs prefs = Prefs.get(this);
        int skin = 0;
        if (!prefs.isGuest) {
            Account a = Db.get(this).get(prefs.activeAccount);
            if (a != null) skin = a.skinEquipped;
        }
        Intent i = new Intent(this, MatchActivity3D.class);
        i.putExtra("mode", mode);
        i.putExtra("map", map);
        i.putExtra("diff", 1);
        i.putExtra("skin", skin);
        i.putExtra("client", client);
        i.putExtra("host", host);
        i.putExtra("ip", ip);
        startActivity(i);
    }

    private void searchRooms() {
        Toast.makeText(this, "Buscando salas na rede...", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            List<Room> rooms = discover();
            runOnUiThread(() -> showRoomsDialog(rooms));
        }).start();
    }

    private List<Room> discover() {
        List<Room> rooms = new ArrayList<>();
        DatagramSocket sock = null;
        try {
            sock = new DatagramSocket();
            sock.setBroadcast(true);
            sock.setSoTimeout(1800);
            byte[] q = LanProtocol.QUERY.getBytes(StandardCharsets.UTF_8);
            sock.send(new DatagramPacket(q, q.length, InetAddress.getByName("255.255.255.255"), LanProtocol.UDP_PORT));
            long end = System.currentTimeMillis() + 1700;
            while (System.currentTimeMillis() < end) {
                try {
                    byte[] buf = new byte[256];
                    DatagramPacket pkt = new DatagramPacket(buf, buf.length);
                    sock.receive(pkt);
                    String msg = new String(pkt.getData(), 0, pkt.getLength(), StandardCharsets.UTF_8);
                    if (msg.startsWith(LanProtocol.RESP)) {
                        String[] f = msg.split("\\|", -1);
                        if (f.length >= 6) {
                            Room r = new Room();
                            r.name = f[1];
                            r.ip = pkt.getAddress().getHostAddress();
                            r.players = f[4];
                            r.modeName = Integer.parseInt(f[3]) == Game.MODE_LAN_FFA ? "Todos contra todos" : "Polícia vs Rivais";
                            int mapIdx = Integer.parseInt(f[2]);
                            r.mapName = Maps.ALL[Math.max(0, Math.min(Maps.ALL.length - 1, mapIdx))].name;
                            rooms.add(r);
                        }
                    }
                } catch (java.net.SocketTimeoutException e) {
                    break;
                }
            }
        } catch (Exception e) {
            // rede indisponível: usa entrada manual por IP
        } finally {
            if (sock != null) { try { sock.close(); } catch (Exception ignored) {} }
        }
        return rooms;
    }

    private void showRoomsDialog(List<Room> rooms) {
        if (rooms.isEmpty()) {
            Toast.makeText(this, "Nenhuma sala encontrada. Confira se todos estão no mesmo Wi-Fi e tente entrar por IP.", Toast.LENGTH_LONG).show();
            return;
        }
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = Ui.dp(this, 12);
        box.setPadding(pad, pad, pad, pad);
        for (Room r : rooms) {
            Button b = new Button(this);
            b.setBackgroundResource(com.strikearena.game.R.drawable.btn_secondary);
            b.setTextSize(14);
            b.setAllCaps(false);
            b.setTextColor(0xFFF2F5FA);
            b.setText(r.name + "  •  " + r.modeName + "  •  " + r.mapName + "  •  " + r.players + "\nIP: " + r.ip);
            b.setOnClickListener(v -> {
                Prefs.get(this).setLastIp(r.ip);
                launch(true, false, Game.MODE_LAN_TDM, 0, r.ip);
            });
            box.addView(b);
        }
        new AlertDialog.Builder(this).setTitle("Salas encontradas").setView(box)
                .setNegativeButton("Fechar", null).show();
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
        int firstId = ((android.widget.RadioButton) rg.getChildAt(0)).getId();
        if (firstId <= 0) return 0;
        return Math.max(0, Math.min(rg.getChildCount() - 1, id - 1 - firstId));
    }
}
