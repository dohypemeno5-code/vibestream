package com.vibestream.app;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebSettings;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.widget.ProgressBar;
import android.view.WindowManager;
import android.view.KeyEvent;
import android.view.View;

public class MainActivity extends Activity {
    private WebView webView;
    private ProgressBar progressBar;
    private static final String SITE_URL = "https://post-pioneer-kruger-saves.trycloudflare.com";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String pkg = getPackageName();
        setContentView(getResources().getIdentifier("activity_main", "layout", pkg));
        
        if (Build.VERSION.SDK_INT >= 11) {
            getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        }
        
        webView = findViewById(getResources().getIdentifier("webView", "id", pkg));
        progressBar = findViewById(getResources().getIdentifier("progressBar", "id", pkg));
        
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= 21) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
        s.setUserAgentString(s.getUserAgentString() + " VibeStream/1.0");
        if (Build.VERSION.SDK_INT >= 29) {
            try { s.setForceDark(WebSettings.FORCE_DARK_AUTO); } catch(Exception e) {}
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (progressBar != null) progressBar.setVisibility(View.VISIBLE);
            }
            @Override
            public void onPageFinished(WebView view, String url) {
                if (progressBar != null) progressBar.setVisibility(View.GONE);
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) { return false; }
            @Override
            public void onReceivedError(WebView view, int errorCode, String desc, String url) {
                view.loadDataWithBaseURL(null,
                    "<html><body style='background:#0a0a0f;color:white;text-align:center;padding:40px;font-family:sans-serif'>" +
                    "<div style='font-size:64px;margin:20px'>&#x1F30A;</div>" +
                    "<h2 style='color:#6C5CE7'>VibeStream</h2>" +
                    "<p>Conectando pessoas</p>" +
                    "<button onclick='location.reload()' style='padding:12px 20px;margin-top:16px;background:#6C5CE7;color:white;border:none;border-radius:8px;font-size:16px'>Tentar Novamente</button>" +
                    "</body></html>", "text/html", "UTF-8", null);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (progressBar != null) {
                    progressBar.setProgress(newProgress);
                    progressBar.setVisibility(newProgress < 100 ? View.VISIBLE : View.GONE);
                }
            }
        });

        webView.loadUrl(SITE_URL);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}
