package com.strikearena.game.net;

import com.strikearena.game.core.Game;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

/** Cliente de partida LAN: envia inputs e recebe snapshots do host. */
public class LanClient {
    public interface Callback {
        void onHandshake(int myId, int mapIdx, int mode, int maxPlayers);
        void onSnapshot(String snap);
        void onMessage(String msg);
        void onDisconnected(String reason);
    }

    private final Game game;
    private final Callback cb;
    private final String ip;
    private final String name;
    private final int skinId;
    private Socket sock;
    private PrintWriter out;
    private volatile boolean running;
    private Thread readerThread, writerThread;
    private String error;
    private int myId;

    public LanClient(Game game, String ip, String name, int skinId, Callback cb) {
        this.game = game;
        this.ip = ip;
        this.name = name;
        this.skinId = skinId;
        this.cb = cb;
    }

    public boolean connect() {
        try {
            sock = new Socket();
            sock.connect(new InetSocketAddress(ip, LanProtocol.TCP_PORT), 6000);
            sock.setTcpNoDelay(true);
            out = new PrintWriter(new BufferedWriter(new OutputStreamWriter(
                    sock.getOutputStream(), StandardCharsets.UTF_8)), true);
            BufferedReader in = new BufferedReader(new InputStreamReader(
                    sock.getInputStream(), StandardCharsets.UTF_8));
            out.println("J|" + LanProtocol.sanitize(name) + "|" + skinId);
            String hs = in.readLine();
            if (hs == null || !hs.startsWith("W|")) {
                error = "Resposta inválida do host.";
                sock.close();
                return false;
            }
            String[] f = hs.split("\\|", -1);
            myId = Integer.parseInt(f[1]);
            int mapIdx = Integer.parseInt(f[2]);
            int mode = Integer.parseInt(f[3]);
            int max = Integer.parseInt(f[4]);
            if (cb != null) cb.onHandshake(myId, mapIdx, mode, max);
            running = true;
            readerThread = new Thread(() -> readerLoop(in), "sa-client-read");
            writerThread = new Thread(this::writerLoop, "sa-client-write");
            readerThread.start();
            writerThread.start();
            return true;
        } catch (Exception e) {
            error = "Não foi possível conectar: " + e.getMessage();
            return false;
        }
    }

    private void readerLoop(BufferedReader in) {
        try {
            String line;
            while (running && (line = in.readLine()) != null) {
                if (line.startsWith("S|")) {
                    synchronized (game) {
                        game.applySnapshot(line);
                    }
                } else if (line.startsWith("M|")) {
                    if (cb != null) cb.onMessage(line.substring(2));
                }
            }
            if (cb != null) cb.onDisconnected("Conexão com o host encerrada.");
        } catch (Exception e) {
            if (cb != null) cb.onDisconnected("Erro de conexão: " + e.getMessage());
        } finally {
            running = false;
            try { sock.close(); } catch (Exception ignored) {}
        }
    }

    private void writerLoop() {
        while (running) {
            try {
                GameInputSnapshot snap = new GameInputSnapshot();
                synchronized (game.input) {
                    snap.mx = game.input.moveX;
                    snap.my = game.input.moveY;
                    snap.ax = game.input.aimX;
                    snap.ay = game.input.aimY;
                    snap.aimActive = game.input.aimActive;
                    snap.fire = game.input.fire;
                    snap.firePressed = game.input.firePressed;
                    snap.reload = game.input.reload;
                    snap.dash = game.input.dash;
                    snap.switchW = game.input.weaponSwitch;
                }
                String msg = "I|" + myId + "|" + fmt(snap.mx) + "|" + fmt(snap.my) + "|" + fmt(snap.ax)
                        + "|" + fmt(snap.ay) + "|" + (snap.aimActive ? 1 : 0) + "|" + (snap.fire ? 1 : 0)
                        + "|" + (snap.firePressed ? 1 : 0) + "|" + (snap.reload ? 1 : 0)
                        + "|" + (snap.dash ? 1 : 0) + "|" + snap.switchW;
                out.println(msg);
                Thread.sleep(40);
            } catch (InterruptedException e) {
                break;
            } catch (Exception e) {
                break;
            }
        }
    }

    private static class GameInputSnapshot {
        float mx, my, ax, ay;
        boolean aimActive, fire, firePressed, reload, dash;
        int switchW;
    }

    private static String fmt(float v) {
        return String.valueOf(Math.round(v * 1000f) / 1000f);
    }

    public void stop() {
        running = false;
        try {
            if (out != null) out.println("Q|");
            if (sock != null) sock.close();
        } catch (Exception ignored) {}
    }

    public String lastError() { return error; }
}
