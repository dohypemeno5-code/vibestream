package com.strikearena.game.core;

/** Definições de skins compráveis na loja. */
public final class Skins {
    public static class Def {
        public final int id;
        public final String name;
        public final int price;
        public final int body;
        public final int sec;
        public final int visor;
        public final int pattern; // 0 nenhum, 1 listra, 2 chevron, 3 brilho

        public Def(int id, String name, int price, int body, int sec, int visor, int pattern) {
            this.id = id; this.name = name; this.price = price; this.body = body;
            this.sec = sec; this.visor = visor; this.pattern = pattern;
        }
    }

    public static final Def[] ALL = {
            new Def(0, "Recruta", 0, 0xFF3D6BB5, 0xFF27466F, 0xFF9FE8FF, 0),
            new Def(1, "Fúria Carmesim", 150, 0xFFC0392B, 0xFF7B241C, 0xFFFFE082, 1),
            new Def(2, "Vipera", 250, 0xFF27AE60, 0xFF145A32, 0xFFFFF59D, 2),
            new Def(3, "Néon", 300, 0xFF8E44AD, 0xFF3A1F5C, 0xFF7CF6FF, 3),
            new Def(4, "Dourado", 500, 0xFFD4AC0D, 0xFF7D6608, 0xFFFFFFFF, 1),
            new Def(5, "Fantasma", 400, 0xFFB0BEC5, 0xFF78909C, 0xFFE0F7FA, 0),
            new Def(6, "Abismo", 450, 0xFF1B4F72, 0xFF0B2E45, 0xFF7EF9E4, 2),
            new Def(7, "Lenda", 1000, 0xFFE91E63, 0xFF880E4F, 0xFFFFEB3B, 3)
    };

    public static Def get(int id) { return ALL[Math.max(0, Math.min(ALL.length - 1, id))]; }
    private Skins() {}
}
