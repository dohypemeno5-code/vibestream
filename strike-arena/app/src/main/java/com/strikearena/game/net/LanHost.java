package com.strikearena.game.net;

import com.strikearena.game.core.Game;
import com.strikearena.game.core.GameInput;
import com.strikearena.game.core.Maps;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** Host autoritativo de partida LAN: aceita clientes, aplica inputs e transmite snapshots. */
public class LanHost {
    public interface Callback {
        void onLog(String msg);
    }

    private static class Conn {
        Socket sock;
        int playerId;
        BufferedReader in;
        PrintWriter out;
        Thread reader;
    }

    private final Game game;
    private final String roomName;
    private final String hostName;
    private final Callback cb;
    private final List<Conn> conns = new ArrayList<>();
    private ServerSocket server;
    private DatagramSocket udp;
    private volatile boolean running;
    private Thread acceptThread, broadcastThread, udpThread;
    private String error;

    public LanHost(Game game, String roomName, String hostName, Callback cb) {
        this.game = game;
        this.roomName = roomName;
        this.hostName = hostName;
        this.cb = cb;
    }

    public boolean start() {
        try {
            server = new ServerSocket(LanProtocol.TCP_PORT);
        } catch (Exception e) {
            error = "Falha ao abrir porta " + LanProtocol.TCP_PORT + ": " + e.getMessage();
            return false;
        }
        try {
            udp = new DatagramSocket(LanProtocol.UDP_PORT);
        } catch (Exception ignored) {
            udp = null; // descoberta indisponível, entrada manual continua funcionando
        }
        running = true;
        acceptThread = new Thread(this::acceptLoop, "sa-host-accept");
        broadcastThread = new Thread(this::broadcastLoop, "sa-host-broadcast");
        acceptThread.start();
        broadcastThread.start();
        if (udp != null) {
            udpThread = new Thread(this::udpLoop, "sa-host-udp");
            udpThread.start();
        }
        return true;
    }

    private void acceptLoop() {
        while (running) {
            try {
                Socket s = server.accept();
                s.setTcpNoDelay(true);
                Conn c = new Conn();
                c.sock = s;
                c.in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
                c.out = new PrintWriter(new BufferedWriter(new OutputStreamWriter(
                        s.getOutputStream(), StandardCharsets.UTF_8)), true);
                String line = c.in.readLine();
                if (line == null || !line.startsWith("J|")) { s.close(); continue; }
                String[] f = line.split("\\|", -1);
                if (f.length < 3) { s.close(); continue; }
                String name = LanProtocol.sanitize(f[1]);
                int skin = parse(f[2], 0);
                int id = game.addLanPlayer(name, skin);
                c.playerId = id;
                synchronized (conns) { conns.add(c); }
                c.out.println("W|" + id + "|" + Maps.ALL.length + "|" + game.mode + "|8");
                log("Jogador entrou: " + name);
                c.reader = new Thread(() -> clientLoop(c), "sa-host-read-" + id);
                c.reader.start();
            } catch (Exception e) {
                if (running) log("Erro no servidor: " + e.getMessage());
            }
        }
    }

    private void clientLoop(Conn c) {
        try {
            String line;
            while (running && (line = c.in.readLine()) != null) {
                if (line.startsWith("I|")) {
                    parseInput(line, c.playerId);
                } else if (line.startsWith("Q|")) {
                    break;
                }
            }
        } catch (Exception ignored) {
        } finally {
            disconnect(c);
        }
    }

    private void parseInput(String line, int playerId) {
        String[] f = line.split("\\|", -1);
        if (f.length < 12) return;
        GameInput gi = game.remoteInputs.get(playerId);
        if (gi == null) return;
        try {
            synchronized (gi) {
                gi.moveX = Float.parseFloat(f[2]);
                gi.moveY = Float.parseFloat(f[3]);
                gi.aimX = Float.parseFloat(f[4]);
                gi.aimY = Float.parseFloat(f[5]);
                gi.aimActive = f[6].equals("1");
                gi.fire = f[7].equals("1");
                gi.firePressed = f[8].equals("1");
                gi.reload = f[9].equals("1");
                gi.dash = f[10].equals("1");
                gi.weaponSwitch = Integer.parseInt(f[11]);
            }
        } catch (NumberFormatException ignored) {
        }
    }

    private void broadcastLoop() {
        while (running) {
            try {
                String snap;
                synchronized (game) {
                    snap = game.encodeSnapshot();
                }
                synchronized (conns) {
                    for (Conn c : conns) {
                        try {
                            c.out.println(snap);
                        } catch (Exception ignored) {
                        }
                    }
                }
                Thread.sleep(50);
            } catch (InterruptedException e) {
                break;
            }
        }
    }

    private void udpLoop() {
        byte[] buf = new byte[128];
        DatagramPacket pkt = new DatagramPacket(buf, buf.length);
        while (running) {
            try {
                udp.receive(pkt);
                String msg = new String(pkt.getData(), 0, pkt.getLength(), StandardCharsets.UTF_8);
                if (msg.startsWith(LanProtocol.QUERY)) {
                    int n = 0;
                    synchronized (game) {
                        for (com.strikearena.game.core.PlayerEnt p : game.players) {
                            if (!p.leftMatch) n++;
                        }
                    }
                    String resp = LanProtocol.RESP + "|" + LanProtocol.sanitize(roomName) + "|"
                            + Maps.ALL.length + "|" + game.mode + "|" + n + "/8|"
                            + LanProtocol.sanitize(hostName);
                    byte[] out = resp.getBytes(StandardCharsets.UTF_8);
                    udp.send(new DatagramPacket(out, out.length, pkt.getAddress(), pkt.getPort()));
                }
            } catch (Exception e) {
                if (running) log("UDP: " + e.getMessage());
            }
        }
    }

    private void disconnect(Conn c) {
        boolean wasThere;
        synchronized (conns) { wasThere = conns.remove(c); }
        if (wasThere) {
            game.removeLanPlayer(c.playerId);
            log("Jogador saiu.");
        }
        try { c.sock.close(); } catch (Exception ignored) {}
    }

    public void stop() {
        running = false;
        try { if (server != null) server.close(); } catch (Exception ignored) {}
        try { if (udp != null) udp.close(); } catch (Exception ignored) {}
        synchronized (conns) {
            for (Conn c : conns) {
                try { c.sock.close(); } catch (Exception ignored) {}
            }
            conns.clear();
        }
    }

    public String lastError() { return error; }

    private void log(String m) { if (cb != null) cb.onLog(m); }

    private static int parse(String s, int dflt) {
        try { return Integer.parseInt(s); } catch (Exception e) { return dflt; }
    }
}
