package com.vibestream.shooter;

import android.content.Context;
import android.graphics.*;
import android.media.AudioAttributes;
import android.media.SoundPool;
import android.os.Build;
import android.view.MotionEvent;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;

public class GameView extends SurfaceView implements Runnable {
    private Thread gameThread;
    private SurfaceHolder holder;
    private volatile boolean isRunning = false;
    private volatile boolean isPaused = false;
    
    // Screen
    private int screenW, screenH;
    private float scale = 1f;
    
    // Game objects
    private Player player;
    private CopyOnWriteArrayList<Bullet> bullets = new CopyOnWriteArrayList<>();
    private CopyOnWriteArrayList<Enemy> enemies = new CopyOnWriteArrayList<>();
    private List<Explosion> explosions = new ArrayList<>();
    private List<Particle> particles = new ArrayList<>();
    
    // Controls
    private Joystick moveJoystick, aimJoystick;
    private RectF shootBtn, reloadBtn;
    private boolean isShooting = false;
    private long lastShotTime = 0;
    private static final long SHOT_COOLDOWN = 300;
    private int ammo = 30, maxAmmo = 30;
    private long reloadStartTime = 0;
    private static final long RELOAD_TIME = 2000;
    private boolean isReloading = false;
    
    // HUD
    private HUD hud;
    private int score = 0, kills = 0;
    private int wave = 1, enemiesPerWave = 4;
    private boolean initialized = false;
    private boolean gameOver = false;
    
    // Map
    private GameMap gameMap;
    
    // Sound (optional - no files, safe no-op)
    private SoundPool soundPool;
    private boolean soundOk = false;
    
    // Database
    private GameDatabase db;
    private String playerName = "Soldier";
    
    public GameView(Context context) {
        super(context);
        holder = getHolder();
        
        try {
            db = new GameDatabase(context);
            playerName = db.getPlayerName();
        } catch (Exception e) {
            // DB failure should not crash the game
            db = null;
            playerName = "Soldier";
        }
        
        // SoundPool (optional)
        try {
            if (Build.VERSION.SDK_INT >= 21) {
                AudioAttributes attr = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_GAME)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
                soundPool = new SoundPool.Builder()
                    .setMaxStreams(4)
                    .setAudioAttributes(attr)
                    .build();
                soundOk = true;
            }
        } catch (Exception e) {
            soundPool = null;
            soundOk = false;
        }
    }
    
    @Override
    public void run() {
        while (isRunning) {
            try {
                if (!isPaused) {
                    update();
                }
                draw();
            } catch (Exception e) {
                // Never crash the game thread
                e.printStackTrace();
            }
            try { Thread.sleep(16); } catch (Exception e) {}
        }
    }
    
    private void initGame() {
        if (initialized) return;
        if (screenW <= 0 || screenH <= 0) return;
        
        scale = Math.max(0.5f, Math.min(screenW, screenH) / 800f);
        
        // Player
        if (player == null) {
            player = new Player(screenW / 2f, screenH / 2f, scale);
            applySkin();
        } else {
            player.reset();
            applySkin();
            player.setPosition(screenW / 2f, screenH / 2f);
        }
        
        // Joysticks
        float joySize = 180 * scale;
        moveJoystick = new Joystick(joySize * 0.7f, screenH - joySize * 0.7f, joySize * 0.5f, joySize);
        aimJoystick = new Joystick(screenW - joySize * 0.7f, screenH - joySize * 0.7f, joySize * 0.5f, joySize);
        
        // Buttons
        float btnSize = 100 * scale;
        shootBtn = new RectF(screenW - btnSize * 1.8f, screenH - btnSize * 1.5f, 
                              screenW - btnSize * 0.8f, screenH - btnSize * 0.5f);
        reloadBtn = new RectF(screenW - btnSize * 3.0f, screenH - btnSize * 1.5f, 
                               screenW - btnSize * 2.0f, screenH - btnSize * 0.5f);
        
        // HUD
        hud = new HUD(scale);
        
        // Map - urban community theme
        gameMap = new GameMap(screenW, screenH);
        
        // Reset state
        score = 0; kills = 0; wave = 1;
        enemiesPerWave = 4;
        ammo = maxAmmo;
        isReloading = false;
        gameOver = false;
        bullets.clear();
        enemies.clear();
        explosions.clear();
        particles.clear();
        
        // Spawn first wave
        spawnWave();
        
        initialized = true;
    }
    
    private void update() {
        if (!initialized) {
            initGame();
            if (!initialized) return;
        }
        if (gameOver) return;
        if (player == null || !player.isAlive()) {
            gameOver = true;
            saveGameResult();
            return;
        }
        
        // Player movement
        if (moveJoystick != null && moveJoystick.isPressed()) {
            float dx = moveJoystick.getDirectionX() * 5 * scale;
            float dy = moveJoystick.getDirectionY() * 5 * scale;
            player.move(dx, dy, screenW, screenH);
        }
        
        // Player rotation (aim direction)
        if (aimJoystick != null && aimJoystick.isPressed()) {
            float angle = (float) Math.atan2(aimJoystick.getDirectionY(), aimJoystick.getDirectionX());
            player.setAngle(angle);
        }
        
        // Auto-aim to nearest enemy
        Enemy nearest = findNearestEnemy();
        if (nearest != null && (aimJoystick == null || !aimJoystick.isPressed())) {
            float dx = nearest.getX() - player.getX();
            float dy = nearest.getY() - player.getY();
            player.setAngle((float) Math.atan2(dy, dx));
        }
        
        // Shooting
        if (isShooting && !isReloading && ammo > 0) {
            long now = System.currentTimeMillis();
            if (now - lastShotTime > SHOT_COOLDOWN) {
                shoot();
                lastShotTime = now;
            }
        }
        
        // Reload
        if (isReloading) {
            if (System.currentTimeMillis() - reloadStartTime > RELOAD_TIME) {
                ammo = maxAmmo;
                isReloading = false;
            }
        }
        
        // Update bullets
        for (Bullet b : bullets) {
            b.update();
        }
        
        // Update enemies
        for (Enemy e : enemies) {
            if (player != null) {
                e.update(player.getX(), player.getY(), bullets, screenW, screenH);
            }
        }
        
        // Collision detection
        checkCollisions();
        
        // Clean up
        cleanup();
        
        // Check wave completion
        if (enemies.isEmpty()) {
            wave++;
            enemiesPerWave = 4 + wave * 2;
            spawnWave();
        }
        
        // Update effects
        for (Explosion ex : explosions) {
            ex.update();
        }
        for (Particle p : particles) {
            p.update();
        }
    }
    
    private void shoot() {
        if (player == null) return;
        float bx = player.getX() + (float) Math.cos(player.getAngle()) * 40 * scale;
        float by = player.getY() + (float) Math.sin(player.getAngle()) * 40 * scale;
        bullets.add(new Bullet(bx, by, player.getAngle(), 12 * scale, true));
        ammo--;
        playSound(1);
        
        // Muzzle flash particles
        for (int i = 0; i < 5; i++) {
            float angle = player.getAngle() + (float) (Math.random() - 0.5) * 0.5f;
            float speed = 3 + (float) Math.random() * 4;
            particles.add(new Particle(bx, by, 
                (float) Math.cos(angle) * speed * scale,
                (float) Math.sin(angle) * speed * scale,
                0xFFFFD700, 10 + (int)(Math.random() * 10)));
        }
    }
    
    private void playSound(int soundId) {
        // Sounds disabled - no audio files included
        // This is a safe no-op that prevents crashes on all devices
    }
    
    private Enemy findNearestEnemy() {
        if (player == null) return null;
        Enemy nearest = null;
        float minDist = Float.MAX_VALUE;
        for (Enemy e : enemies) {
            if (e == null || !e.isAlive()) continue;
            float d = dist(player.getX(), player.getY(), e.getX(), e.getY());
            if (d < minDist) {
                minDist = d;
                nearest = e;
            }
        }
        return nearest;
    }
    
    private void checkCollisions() {
        if (player == null) return;
        
        // Bullet vs Enemy
        for (Bullet b : bullets) {
            if (b == null || !b.isActive()) continue;
            for (Enemy e : enemies) {
                if (e == null || !e.isAlive()) continue;
                if (dist(b.getX(), b.getY(), e.getX(), e.getY()) < 30 * scale) {
                    b.deactivate();
                    e.takeDamage(25);
                    
                    // Hit particles
                    for (int i = 0; i < 8; i++) {
                        float angle = (float) (Math.random() * 2 * Math.PI);
                        float speed = 2 + (float) Math.random() * 4;
                        particles.add(new Particle(b.getX(), b.getY(),
                            (float) Math.cos(angle) * speed * scale,
                            (float) Math.sin(angle) * speed * scale,
                            0xFFFF4444, 15 + (int)(Math.random() * 10)));
                    }
                    
                    if (!e.isAlive()) {
                        score += 100;
                        kills++;
                        explosions.add(new Explosion(e.getX(), e.getY(), scale));
                        
                        // XP and coins
                        if (db != null) {
                            try {
                                db.addXP(50);
                                db.addCoins(25);
                            } catch (Exception ex) {}
                        }
                    }
                    break;
                }
            }
        }
        
        // Enemy vs Player
        for (Enemy e : enemies) {
            if (e == null || !e.isAlive()) continue;
            if (dist(player.getX(), player.getY(), e.getX(), e.getY()) < 35 * scale) {
                player.takeDamage(10);
                e.takeDamage(30);
            }
            
            // Enemy bullets vs Player
            for (Bullet b : e.getBullets()) {
                if (b == null || !b.isActive()) continue;
                if (dist(b.getX(), b.getY(), player.getX(), player.getY()) < 25 * scale) {
                    b.deactivate();
                    player.takeDamage(8);
                }
            }
        }
    }
    
    private void spawnWave() {
        for (int i = 0; i < enemiesPerWave; i++) {
            float x, y;
            int side = (int)(Math.random() * 4);
            switch (side) {
                case 0: x = -50; y = (float)(Math.random() * Math.max(1, screenH)); break;
                case 1: x = screenW + 50; y = (float)(Math.random() * Math.max(1, screenH)); break;
                case 2: x = (float)(Math.random() * Math.max(1, screenW)); y = -50; break;
                default: x = (float)(Math.random() * Math.max(1, screenW)); y = screenH + 50; break;
            }
            enemies.add(new Enemy(x, y, scale, wave));
        }
    }
    
    private void cleanup() {
        try {
            bullets.removeIf(b -> b == null || !b.isActive() || b.getX() < -100 || b.getX() > screenW + 100 || 
                             b.getY() < -100 || b.getY() > screenH + 100);
            enemies.removeIf(e -> e == null || !e.isAlive());
            explosions.removeIf(e -> e == null || e.isDone());
            particles.removeIf(p -> p == null || p.isDead());
        } catch (Exception e) {}
    }
    
    private void saveGameResult() {
        if (db != null && score > 0) {
            try {
                db.addMatch(score, wave, kills);
            } catch (Exception e) {}
        }
    }
    
    private void draw() {
        if (!initialized) {
            initGame();
            if (!initialized) return;
        }
        
        Canvas canvas = null;
        try {
            canvas = holder.lockCanvas();
            if (canvas == null) return;
            
            // Background
            canvas.drawColor(Color.parseColor("#0a0a12"));
            
            // Draw grid (streets pattern)
            Paint gridPaint = new Paint();
            gridPaint.setColor(Color.parseColor("#151520"));
            gridPaint.setStrokeWidth(1);
            for (int x = 0; x < screenW; x += Math.max(1, (int)(80 * scale))) {
                canvas.drawLine(x, 0, x, screenH, gridPaint);
            }
            for (int y = 0; y < screenH; y += Math.max(1, (int)(80 * scale))) {
                canvas.drawLine(0, y, screenW, y, gridPaint);
            }
            
            // Draw map objects (urban community)
            if (gameMap != null) gameMap.draw(canvas, scale);
            
            // Draw particles
            for (Particle p : particles) {
                if (p != null) p.draw(canvas);
            }
            
            // Draw enemies
            for (Enemy e : enemies) {
                if (e != null) e.draw(canvas, scale);
            }
            
            // Draw player
            if (player != null) player.draw(canvas, scale);
            
            // Draw bullets
            for (Bullet b : bullets) {
                if (b != null) b.draw(canvas, scale);
            }
            
            // Draw explosions
            for (Explosion ex : explosions) {
                if (ex != null) ex.draw(canvas);
            }
            
            // Draw joysticks
            if (moveJoystick != null) moveJoystick.draw(canvas);
            if (aimJoystick != null) aimJoystick.draw(canvas);
            
            // Draw buttons
            drawButtons(canvas);
            
            // Draw HUD
            if (hud != null && player != null) {
                hud.draw(canvas, player, score, kills, wave, ammo, maxAmmo, isReloading,
                         reloadStartTime, RELOAD_TIME, screenW, screenH, scale);
            }
            
            // Draw game over screen
            if (gameOver) {
                drawGameOver(canvas);
            }
            
            // Pause button
            Paint p = new Paint();
            p.setColor(Color.parseColor("#44FFFFFF"));
            p.setTextSize(24 * scale);
            p.setTextAlign(Paint.Align.LEFT);
            canvas.drawText("⏸", 15 * scale, 40 * scale, p);
            
        } catch (Exception e) {
            // Silently handle drawing errors
        } finally {
            if (canvas != null) {
                try { holder.unlockCanvasAndPost(canvas); } catch (Exception e) {}
            }
        }
    }
    
    private void drawGameOver(Canvas canvas) {
        Paint bg = new Paint();
        bg.setColor(0xAA000000);
        canvas.drawRect(0, 0, screenW, screenH, bg);
        
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(Color.parseColor("#FF4444"));
        p.setTextSize(48 * scale);
        p.setTextAlign(Paint.Align.CENTER);
        canvas.drawText("FIM DE JOGO", screenW / 2f, screenH / 2f - 60 * scale, p);
        
        p.setColor(Color.WHITE);
        p.setTextSize(24 * scale);
        canvas.drawText("Score: " + score + " | Kills: " + kills + " | Wave: " + wave, 
                        screenW / 2f, screenH / 2f + 20 * scale, p);
        
        p.setColor(Color.parseColor("#FFD700"));
        p.setTextSize(20 * scale);
        canvas.drawText("Toque para reiniciar", screenW / 2f, screenH / 2f + 80 * scale, p);
    }
    
    private void drawButtons(Canvas canvas) {
        if (shootBtn == null || reloadBtn == null) return;
        Paint p = new Paint();
        p.setStyle(Paint.Style.FILL);
        
        // Shoot button
        p.setColor(isShooting ? Color.parseColor("#66FF4444") : Color.parseColor("#44FF4444"));
        canvas.drawRoundRect(shootBtn, 16, 16, p);
        p.setColor(Color.WHITE);
        p.setTextSize(36 * scale);
        p.setTextAlign(Paint.Align.CENTER);
        canvas.drawText("🔥", shootBtn.centerX(), shootBtn.centerY() + 12 * scale, p);
        
        // Reload button
        p.setStyle(Paint.Style.FILL);
        p.setColor(isReloading ? Color.parseColor("#664444FF") : Color.parseColor("#444444FF"));
        canvas.drawRoundRect(reloadBtn, 16, 16, p);
        p.setColor(Color.WHITE);
        p.setTextSize(28 * scale);
        canvas.drawText("R", reloadBtn.centerX(), reloadBtn.centerY() + 10 * scale, p);
        
        // Wave info
        Paint wp = new Paint();
        wp.setColor(Color.parseColor("#FFD700"));
        wp.setTextSize(20 * scale);
        wp.setTextAlign(Paint.Align.CENTER);
        canvas.drawText("WAVE " + wave, screenW / 2f, 30 * scale, wp);
    }
    
    @Override
    public boolean onTouchEvent(MotionEvent event) {
        try {
            int pointerCount = event.getPointerCount();
            int action = event.getActionMasked();
            
            for (int i = 0; i < pointerCount; i++) {
                float x = event.getX(i);
                float y = event.getY(i);
                
                switch (action) {
                    case MotionEvent.ACTION_DOWN:
                    case MotionEvent.ACTION_POINTER_DOWN:
                        if (gameOver) {
                            // Restart game
                            initialized = false;
                            initGame();
                            break;
                        }
                        if (moveJoystick != null && moveJoystick.contains(x, y)) {
                            moveJoystick.setPressed(true);
                        } else if (aimJoystick != null && aimJoystick.contains(x, y)) {
                            aimJoystick.setPressed(true);
                        } else if (shootBtn != null && shootBtn.contains(x, y)) {
                            isShooting = true;
                        } else if (reloadBtn != null && reloadBtn.contains(x, y) && !isReloading && ammo < maxAmmo) {
                            isReloading = true;
                            reloadStartTime = System.currentTimeMillis();
                        } else if (x < 60 * scale && y < 60 * scale) {
                            isPaused = !isPaused;
                        }
                        break;
                        
                    case MotionEvent.ACTION_MOVE:
                        if (moveJoystick != null) moveJoystick.update(x, y);
                        if (aimJoystick != null) aimJoystick.update(x, y);
                        isShooting = shootBtn != null && shootBtn.contains(x, y);
                        break;
                        
                    case MotionEvent.ACTION_UP:
                    case MotionEvent.ACTION_POINTER_UP:
                        if (moveJoystick != null) moveJoystick.setPressed(false);
                        if (aimJoystick != null) aimJoystick.setPressed(false);
                        isShooting = false;
                        break;
                }
            }
        } catch (Exception e) {}
        
        return true;
    }
    
    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        screenW = w; screenH = h;
        initialized = false;
        initGame();
    }
    
    private float dist(float x1, float y1, float x2, float y2) {
        return (float) Math.sqrt((x2-x1)*(x2-x1) + (y2-y1)*(y2-y1));
    }
    
    public void pause() {
        isRunning = false;
        try {
            if (gameThread != null && gameThread != Thread.currentThread()) {
                gameThread.join(500);
            }
        } catch (Exception e) {}
    }
    
    public void resume() {
        if (isRunning) return;
        isRunning = true;
        isPaused = false;
        gameThread = new Thread(this);
        gameThread.start();
    }
    
    @Override
    protected void onDetachedFromWindow() {
        super.onDetachedFromWindow();
        pause();
        try {
            if (soundPool != null) soundPool.release();
        } catch (Exception e) {}
        soundPool = null;
    }

    private void applySkin() {
        try {
            if (db != null && player != null) {
                int skinId = db.getCurrentSkin();
                String color = db.getSkinColor(skinId);
                player.setSkinColor(Color.parseColor(color));
            }
        } catch (Exception e) {
            if (player != null) player.setSkinColor(Color.parseColor("#6C5CE7"));
        }
    }

}
