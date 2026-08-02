package com.strikearena.game.ui;

import android.app.Activity;
import android.os.Bundle;
import android.view.WindowManager;
import android.widget.Toast;

import com.strikearena.game.core.Game;
import com.strikearena.game.core.Maps;
import com.strikearena.game.data.Prefs;
import com.strikearena.game.net.LanClient;
import com.strikearena.game.net.LanHost;

/** Executa a partida (offline, host LAN ou cliente LAN). */
public class MatchActivity extends Activity {
    private GameView view;
    private Game game;
    private LanHost host;
    private LanClient client;
    private boolean isClient;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Ui.fullscreen(this);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        int mode = getIntent().getIntExtra("mode", Game.MODE_TDM);
        int mapIdx = getIntent().getIntExtra("map", 0);
        int diff = getIntent().getIntExtra("diff", 1);
        boolean hostMode = getIntent().getBooleanExtra("host", false);
        isClient = getIntent().getBooleanExtra("client", false);
        String ip = getIntent().getStringExtra("ip");
        String name = getIntent().getStringExtra("name");
        if (name == null || name.isEmpty()) name = Prefs.get(this).playerName();
        int skin = getIntent().getIntExtra("skin", 0);
        Prefs prefs = Prefs.get(this);
        skin = prefs.isGuest ? skin : (com.strikearena.game.data.Db.get(this).get(prefs.activeAccount) != null
                ? com.strikearena.game.data.Db.get(this).get(prefs.activeAccount).skinEquipped : skin);

        game = new Game(mode, mapIdx, diff, name, skin, isClient);
        view = new GameView(this, game);
        setContentView(view);

        if (hostMode) {
            host = new LanHost(game, prefs.roomName(), name, msg -> view.showNetNotice(msg));
            if (!host.start()) {
                Toast.makeText(this, "Falha ao abrir servidor: " + host.lastError(), Toast.LENGTH_LONG).show();
                finish();
                return;
            }
            view.showNetNotice("Aguardando jogadores... IP desta sala: " + localIp());
        } else if (isClient) {
            client = new LanClient(game, ip, name, skin, new LanClient.Callback() {
                @Override public void onHandshake(int myId, int mapIdx, int mode, int maxPlayers) {
                    runOnUiThread(() -> {
                        game.map = Maps.ALL[Math.max(0, Math.min(Maps.ALL.length - 1, mapIdx))];
                        game.mode = mode;
                        view.showNetNotice("Conectado à partida!");
                    });
                }
                @Override public void onSnapshot(String snap) {}
                @Override public void onMessage(String msg) {
                    runOnUiThread(() -> view.onMessage(msg));
                }
                @Override public void onDisconnected(String reason) {
                    runOnUiThread(() -> view.onRemoteDisconnect(reason));
                }
            });
            if (!client.connect()) {
                Toast.makeText(this, client.lastError(), Toast.LENGTH_LONG).show();
                finish();
                return;
            }
        }
    }

    private String localIp() {
        try {
            for (java.net.NetworkInterface ni : java.util.Collections.list(java.net.NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (java.net.InetAddress a : java.util.Collections.list(ni.getInetAddresses())) {
                    if (!a.isLoopbackAddress() && a instanceof java.net.Inet4Address) return a.getHostAddress();
                }
            }
        } catch (Exception ignored) {}
        return "desconhecido";
    }

    @Override protected void onResume() {
        super.onResume();
        if (view != null) view.resumeGame();
    }

    @Override protected void onPause() {
        super.onPause();
        if (view != null) view.pauseGame();
    }

    @Override protected void onDestroy() {
        if (host != null) host.stop();
        if (client != null) client.stop();
        if (view != null) view.shutdown();
        super.onDestroy();
    }
}
