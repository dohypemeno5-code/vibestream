package com.strikearena.game.core;

/** Mapas disponíveis (todos fictícios — nenhum nome, marca ou local real). */
public final class Maps {
    public static final MapDef[] ALL = {
            // Comunidade urbana fictícia: becos, casas e base de cada equipe
            new MapDef("Comunidade Vila Nova", 2400, 1600,
                    0xFF3A342C, 0xFF332E27, 0xFF7A5C4A, 0xFF9B7B63,
                    new float[]{
                            1100, 700, 200, 200,          // praça central
                            340, 260, 220, 140,           // casa sup-esq
                            1840, 260, 220, 140,          // casa sup-dir
                            340, 1200, 220, 140,          // casa inf-esq
                            1840, 1200, 220, 140,         // casa inf-dir
                            660, 320, 150, 100,           // casa média sup-esq
                            1590, 320, 150, 100,          // casa média sup-dir
                            660, 1180, 150, 100,          // casa média inf-esq
                            1590, 1180, 150, 100,         // casa média inf-dir
                            880, 700, 90, 160,            // cobertura esq
                            1430, 700, 90, 160,           // cobertura dir
                            300, 560, 40, 480,            // muro da base da polícia
                            2060, 560, 40, 480,           // muro da base dos rivais
                            1200, 150, 70, 260,           // beco vertical superior
                            1200, 1190, 70, 260           // beco vertical inferior
                    },
                    new float[]{2260, 620, 2260, 980, 2160, 300, 2160, 1300},
                    new float[]{140, 620, 140, 980, 240, 300, 240, 1300},
                    new float[]{1200, 500, 1200, 1100, 700, 800, 1700, 800},
                    new float[]{1200, 800, 400, 800, 2000, 800, 700, 500, 1700, 1100,
                            1700, 500, 700, 1100, 1200, 300, 1200, 1300, 900, 400, 1500, 1200},
                    new float[]{2060, 560, 260, 480},    // base rivais (direita)
                    new float[]{80, 560, 260, 480},     // base polícia (esquerda)
                    // postes de rua (fios ligam postes vizinhos)
                    new float[]{600, 120, 600, 420, 600, 800, 600, 1180, 600, 1480,
                            1800, 120, 1800, 420, 1800, 800, 1800, 1180, 1800, 1480,
                            120, 300, 120, 1300, 2280, 300, 2280, 1300, 1200, 150, 1200, 1450},
                    // carros estacionados: x, y, ângulo (rad)
                    new float[]{700, 790, 0f, 1650, 810, 3.14159f, 500, 170, 1.5708f,
                            1900, 1430, -1.5708f, 760, 1430, 0f, 1700, 170, 3.14159f,
                            950, 300, 1.5708f, 1450, 1300, -1.5708f},
                    // lojas (marquises) + nomes fictícios
                    new float[]{560, 300, 70, 100, 560, 1230, 70, 100,
                            1770, 300, 70, 100, 1770, 1230, 70, 100},
                    new String[]{"PADARIA PÃO QUENTE", "MERCADINHO VILA NOVA", "BAR DO ZÉ", "OFICINA DO NINO"}),

            new MapDef("Depósito", 2600, 1700,
                    0xFF2A2A24, 0xFF25251F, 0xFF5A544A, 0xFF756E60,
                    new float[]{
                            1100, 700, 400, 300,
                            700, 400, 90, 90, 850, 400, 90, 90,
                            700, 1210, 90, 90, 850, 1210, 90, 90,
                            1750, 400, 90, 90, 1900, 400, 90, 90,
                            1750, 1210, 90, 90, 1900, 1210, 90, 90,
                            400, 760, 120, 180, 2080, 760, 120, 180,
                            280, 350, 90, 400, 280, 950, 90, 400,
                            2230, 350, 90, 400, 2230, 950, 90, 400,
                            1200, 250, 220, 80, 1200, 1370, 220, 80
                    },
                    new float[]{150, 150, 150, 1550},
                    new float[]{2450, 150, 2450, 1550},
                    new float[]{150, 150, 150, 1550, 2450, 150, 2450, 1550, 1300, 300, 1300, 1400},
                    new float[]{1300, 850, 500, 850, 2100, 850, 1300, 550, 1300, 1150},
                    new float[]{2350, 120, 180, 1460},
                    new float[]{70, 120, 180, 1460}),

            new MapDef("Zona Norte", 2400, 1600,
                    0xFF23303B, 0xFF1F2B35, 0xFF4A6379, 0xFF62849C,
                    new float[]{
                            1120, 700, 160, 200,
                            700, 450, 200, 40, 1500, 450, 200, 40,
                            700, 1110, 200, 40, 1500, 1110, 200, 40,
                            300, 300, 120, 120, 1980, 300, 120, 120,
                            300, 1180, 120, 120, 1980, 1180, 120, 120,
                            600, 760, 80, 80, 1720, 760, 80, 80
                    },
                    new float[]{140, 140, 140, 1460},
                    new float[]{2260, 140, 2260, 1460},
                    new float[]{140, 140, 140, 1460, 2260, 140, 2260, 1460, 1200, 140, 1200, 1460},
                    new float[]{1200, 800, 300, 800, 2100, 800, 1200, 300, 1200, 1300},
                    new float[]{2120, 120, 200, 1360},
                    new float[]{80, 120, 200, 1360})
    };
    private Maps() {}
}
