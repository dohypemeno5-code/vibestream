package com.strikearena.game;

import android.app.Application;
import android.os.Build;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Aplicação: registra handler global de crash para nunca fechar em silêncio. */
public class VibeStrikeApp extends Application {

    public static volatile String lastCrash = "";

    @Override public void onCreate() {
        super.onCreate();
        final Thread.UncaughtExceptionHandler def = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
            try {
                StringBuilder sb = new StringBuilder();
                sb.append(new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
                        .format(new Date())).append('\n');
                sb.append("Device: ").append(Build.MANUFACTURER).append(' ')
                        .append(Build.MODEL).append(" | API ").append(Build.VERSION.SDK_INT).append('\n');
                sb.append(Log.getStackTraceString(throwable)).append('\n');
                lastCrash = sb.toString();
                File f = new File(getFilesDir(), "crash.log");
                try (PrintWriter w = new PrintWriter(new FileOutputStream(f, true))) {
                    w.print(sb.toString());
                }
            } catch (Exception ignored) {
            } finally {
                if (def != null) def.uncaughtException(thread, throwable);
            }
        });
    }
}
