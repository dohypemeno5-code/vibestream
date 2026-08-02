package com.strikearena.game.gl;

/** Matrizes 4x4 (coluna-major, padrão GLES) sem dependências. */
public final class GlMath {

    public static float[] identity() {
        return new float[]{1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
    }

    /** Projeção em perspectiva. out = P. */
    public static void perspective(float fovyDeg, float aspect, float near, float far, float[] out) {
        float f = (float) (1.0 / Math.tan(Math.toRadians(fovyDeg) * 0.5));
        java.util.Arrays.fill(out, 0);
        out[0] = f / aspect;
        out[5] = f;
        out[10] = (far + near) / (near - far);
        out[11] = -1;
        out[14] = (2 * far * near) / (near - far);
    }

    /** Matriz de visão (câmera). out = V. */
    public static void lookAt(float ex, float ey, float ez, float cx, float cy, float cz, float[] out) {
        float fx = cx - ex, fy = cy - ey, fz = cz - ez;
        float fl = (float) Math.sqrt(fx * fx + fy * fy + fz * fz);
        fx /= fl; fy /= fl; fz /= fl;
        // up = (0,1,0); s = f x up = (-fz, 0, fx)
        float sx = -fz, sy = 0, sz = fx;
        float sl = (float) Math.sqrt(sx * sx + sy * sy + sz * sz);
        if (sl < 1e-6f) { sx = 1; sy = 0; sz = 0; sl = 1; }
        sx /= sl; sy /= sl; sz /= sl;
        float ux = sy * fz - sz * fy;               // u = s x f
        float uy = sz * fx - sx * fz;
        float uz = sx * fy - sy * fx;
        out[0] = sx; out[1] = ux; out[2] = -fx; out[3] = 0;
        out[4] = sy; out[5] = uy; out[6] = -fy; out[7] = 0;
        out[8] = sz; out[9] = uz; out[10] = -fz; out[11] = 0;
        out[12] = -(sx * ex + sy * ey + sz * ez);
        out[13] = -(ux * ex + uy * ey + uz * ez);
        out[14] =  (fx * ex + fy * ey + fz * ez);
        out[15] = 1;
    }

    public static void multiply(float[] a, float[] b, float[] out) {
        float[] r = new float[16];
        for (int c = 0; c < 4; c++) {
            for (int rw = 0; rw < 4; rw++) {
                r[c * 4 + rw] = a[0 * 4 + rw] * b[c * 4 + 0]
                        + a[1 * 4 + rw] * b[c * 4 + 1]
                        + a[2 * 4 + rw] * b[c * 4 + 2]
                        + a[3 * 4 + rw] * b[c * 4 + 3];
            }
        }
        System.arraycopy(r, 0, out, 0, 16);
    }

    /** Modelo: translação * rotaçãoY * escala. */
    public static float[] model(float tx, float ty, float tz, float rotYDeg, float sx, float sy, float sz) {
        float r = (float) Math.toRadians(rotYDeg);
        float cos = (float) Math.cos(r), sin = (float) Math.sin(r);
        // M = T * R_y * S (rotação no plano XZ, eixo vertical Y)
        return new float[]{
                cos * sx, 0, -sin * sx, 0,
                0, sy, 0, 0,
                sin * sz, 0, cos * sz, 0,
                tx, ty, tz, 1
        };
    }

    private GlMath() {}
}
