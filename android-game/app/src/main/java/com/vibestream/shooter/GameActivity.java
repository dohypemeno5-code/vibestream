package com.vibestream.shooter;

import android.app.Activity;
import android.os.Bundle;
import android.view.WindowManager;

public class GameActivity extends Activity {
    private GameView gameView;
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, 
                                 WindowManager.LayoutParams.FLAG_FULLSCREEN);
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            
            gameView = new GameView(this);
            setContentView(gameView);
        } catch (Exception e) {
            e.printStackTrace();
            finish();
        }
    }
    
    @Override
    protected void onPause() {
        super.onPause();
        if (gameView != null) gameView.pause();
    }
    
    @Override
    protected void onResume() {
        super.onResume();
        if (gameView != null) gameView.resume();
    }
    
    @Override
    protected void onDestroy() {
        if (gameView != null) gameView.pause();
        super.onDestroy();
    }
    
    @Override
    public void onBackPressed() {
        if (gameView != null) gameView.pause();
        finish();
    }
}
