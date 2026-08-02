#!/usr/bin/env python3
"""Gera efeitos sonoros e musica ambiente (assets 100% originais) para o Strike Arena 2D."""
import math, os, random, struct, wave

SR = 22050
OUT = os.path.join(os.path.dirname(__file__), "..", "app", "src", "main", "res", "raw")
os.makedirs(OUT, exist_ok=True)

def save(name, samples, vol=0.85):
    # normaliza para o pico target
    peak = max(1e-9, max(abs(s) for s in samples))
    scale = (vol * 32767 * 0.9) / peak
    frames = bytearray()
    for s in samples:
        v = int(max(-1.0, min(1.0, s * scale)) * 32767)
        frames += struct.pack('<h', v)
    path = os.path.join(OUT, name + ".wav")
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(bytes(frames))
    print(f"  {name}.wav  {len(samples)/SR:.2f}s  {os.path.getsize(path)} bytes")

def noise(n, seed=None):
    r = random.Random(seed)
    return [r.uniform(-1, 1) for _ in range(int(n))]

def env_exp(n, decay):
    return [math.exp(-i * decay) for i in range(n)]

def lowpass(s, a=0.35):
    out = [0.0] * len(s); acc = 0.0
    for i, x in enumerate(s):
        acc += a * (x - acc)
        out[i] = acc
    return out

def bandish(s, cut=0.18):
    return [x - lowpass([y for y in s], cut)[i] for i, x in enumerate(s)]

def shoot(n, f0, f1, dur, noise_amt=0.7, tone=0.35, click=0.0):
    n = int(SR * dur)
    env = env_exp(n, 4.0 / dur)
    out = []
    for i in range(n):
        t = i / SR
        f = f0 + (f1 - f0) * (t / dur)
        ph = 2 * math.pi * f * t
        v = tone * math.sin(ph) + noise_amt * random.uniform(-1, 1) * (0.4 + 0.6 * math.sin(ph * 0.3))
        out.append(v * env[i])
    out = lowpass(out, 0.28)
    if click > 0:
        c = int(SR * 0.012)
        for i in range(c):
            out[i] += click * (1 - i / c) * random.uniform(-1, 1)
    return out

rng = random.Random(42)
print("Gerando efeitos sonoros...")
save("shoot_rifle", shoot(0, 420, 90, 0.16, 0.75, 0.4, 0.5), 0.55)
save("shoot_smg",   shoot(0, 620, 160, 0.09, 0.8, 0.35, 0.6), 0.5)
save("shoot_shotgun", shoot(0, 180, 55, 0.30, 0.9, 0.5, 0.7), 0.7)
save("shoot_sniper", shoot(0, 1400, 300, 0.22, 0.85, 0.45, 0.9), 0.6)
save("shoot_pistol", shoot(0, 500, 120, 0.13, 0.7, 0.4, 0.5), 0.55)

# empty click
n = int(SR * 0.08); s = [rng.uniform(-1, 1) * math.exp(-i * 60 / SR) for i in range(n)]
save("empty", lowpass(s, 0.4), 0.5)

# reload: 3 clicks
parts = []
for k in range(3):
    n = int(SR * 0.05); s = [rng.uniform(-1, 1) * math.exp(-i * 90 / SR) for i in range(n)]
    parts += [0.0] * int(SR * 0.06) + lowpass(s, 0.4)
save("reload", parts[:int(SR * 0.9)], 0.5)

# hit
n = int(SR * 0.10)
s = [math.sin(2 * math.pi * 190 * i / SR) * math.exp(-i * 30 / SR) + rng.uniform(-1, 1) * 0.3 * math.exp(-i * 50 / SR) for i in range(n)]
save("hit", lowpass(s, 0.3), 0.5)

# hurt
n = int(SR * 0.22)
s = [math.sin(2 * math.pi * (140 - 60 * i / n) * i / SR) * math.exp(-i * 18 / SR) + rng.uniform(-1, 1) * 0.4 * math.exp(-i * 30 / SR) for i in range(n)]
save("hurt", lowpass(s, 0.35), 0.6)

# kill (ding)
n = int(SR * 0.35)
s = [0.0] * n
for f, a in ((880, 0.55), (1320, 0.35), (1760, 0.2)):
    for i in range(n):
        s[i] += a * math.sin(2 * math.pi * f * i / SR) * math.exp(-i * 8 / SR)
save("kill", s, 0.55)

# death
n = int(SR * 0.6)
s = [0.0] * n
for f, a in ((440, 0.5), (330, 0.5), (220, 0.5)):
    for i in range(n):
        env = math.exp(-i * 5 / SR) if i < n * 0.5 else math.exp(-i * 10 / SR)
        s[i] += a * math.sin(2 * math.pi * f * i / SR) * env
save("death", s, 0.5)

# explosion
n = int(SR * 0.8)
s = [rng.uniform(-1, 1) * math.exp(-i * 5.5 / SR) for i in range(n)]
s = lowpass(s, 0.2)
for i in range(n):
    s[i] += 0.5 * math.sin(2 * math.pi * (90 - 40 * i / n) * i / SR) * math.exp(-i * 4 / SR)
save("explosion", s, 0.75)

# coin (two tones up)
n = int(SR * 0.28); s = []
for i in range(n):
    t = i / SR
    f = 880 if t < 0.12 else 1318
    s.append(0.5 * math.sin(2 * math.pi * f * t) * math.exp(-i * 10 / SR))
save("coin", s, 0.55)

# pickup
n = int(SR * 0.18); s = []
for i in range(n):
    t = i / SR
    s.append(0.5 * math.sin(2 * math.pi * (660 + 400 * t / 0.18) * t) * math.exp(-i * 12 / SR))
save("pickup", s, 0.5)

# ui click
n = int(SR * 0.06); s = [rng.uniform(-1, 1) * math.exp(-i * 90 / SR) for i in range(n)]
save("ui_click", lowpass(s, 0.4), 0.45)

# wave start (arpeggio up)
n = int(SR * 0.9); s = []
notes = [523, 659, 784, 1047]
for i in range(n):
    t = i / SR
    idx = min(3, int(t / 0.18))
    s.append(0.4 * math.sin(2 * math.pi * notes[idx] * t) * math.exp(-((t % 0.18) * 18)))
save("wave_start", s, 0.55)

# win (major arpeggio)
n = int(SR * 1.6); s = []
notes = [523, 659, 784, 1047, 1318]
for i in range(n):
    t = i / SR
    idx = min(4, int(t / 0.22))
    s.append(0.4 * math.sin(2 * math.pi * notes[idx] * t) * math.exp(-((t % 0.22) * 16)))
save("win", s, 0.6)

# lose (descending)
n = int(SR * 1.6); s = []
notes = [523, 494, 440, 392, 349]
for i in range(n):
    t = i / SR
    idx = min(4, int(t / 0.22))
    s.append(0.4 * math.sin(2 * math.pi * notes[idx] * t) * math.exp(-((t % 0.22) * 16)))
save("lose", s, 0.55)

# dash (whoosh)
n = int(SR * 0.25)
s = [rng.uniform(-1, 1) * (i / n) * math.exp(-i * 20 / SR) for i in range(n)]
s = bandish(s, 0.25)
save("dash", s, 0.45)

# spawn
n = int(SR * 0.3); s = []
for i in range(n):
    t = i / SR
    s.append(0.35 * math.sin(2 * math.pi * (300 + 700 * t / 0.3) * t) * math.exp(-i * 8 / SR))
save("spawn", s, 0.5)

# ambient pad (8s loop suave)
n = int(SR * 8)
s = []
for i in range(n):
    t = i / SR
    v = 0.0
    for f, a in ((110, 0.16), (165, 0.10), (220, 0.07), (275, 0.05)):
        v += a * math.sin(2 * math.pi * f * t + 0.5 * math.sin(2 * math.pi * 0.11 * t))
    v += 0.5 * math.sin(2 * math.pi * 0.5 * t) * 0.03 * math.sin(2 * math.pi * 55 * t)
    v += rng.uniform(-1, 1) * 0.008
    s.append(v)
s = lowpass(s, 0.15)
save("ambient", s, 0.5)
print("OK")
