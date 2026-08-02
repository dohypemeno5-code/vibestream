package com.strikearena.game.net;

public final class LanProtocol {
    public static final int TCP_PORT = 47771;
    public static final int UDP_PORT = 47777;
    public static final String QUERY = "SA2D_DISCOVER";
    public static final String RESP = "SA2D_HOST";

    public static String sanitize(String s) {
        if (s == null) return "Jogador";
        String r = s.replace('|', ' ').replace(',', ' ').replace('\n', ' ').trim();
        if (r.isEmpty()) return "Jogador";
        return r.length() > 16 ? r.substring(0, 16) : r;
    }
    private LanProtocol() {}
}
