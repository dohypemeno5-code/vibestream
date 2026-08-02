# Keep WebView JS interface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep BuildConfig
-keep class com.vibestream.app.BuildConfig { *; }

# Keep app classes
-keep class com.vibestream.app.** { *; }
