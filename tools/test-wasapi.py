#!/usr/bin/env python3
"""
測試 WASAPI Loopback（系統音訊）+ 麥克風 同時擷取
執行後：播放 YouTube 音樂 + 對麥克風講話，觀察兩路 RMS 變化
按 Ctrl+C 停止
"""
import sys
import math
import threading

try:
    import soundcard as sc
    import numpy as np
except ImportError:
    print("ERROR: pip install soundcard numpy")
    sys.exit(1)

SAMPLE_RATE = 16000
CHANNELS = 1
FRAMES = 1600  # 100ms

# ── 系統音訊 loopback ──
speaker = sc.default_speaker()
loopback = sc.get_microphone(speaker.id, include_loopback=True)

# ── 麥克風：找第一個非 loopback 的輸入 ──
all_mics = sc.all_microphones()
mic = None
for m in all_mics:
    if speaker.id not in m.id and 'loopback' not in m.name.lower():
        mic = m
        break
if mic is None and all_mics:
    mic = all_mics[0]

print(f"系統音訊 loopback : {loopback.name}")
print(f"麥克風            : {mic.name if mic else '找不到'}")
print("─" * 60)
print("播放音樂 + 對麥克風講話，觀察 RMS 變化（Ctrl+C 停止）\n")

sys_rms = 0.0
mic_rms = 0.0

def capture_loopback():
    global sys_rms
    with loopback.recorder(samplerate=SAMPLE_RATE, channels=CHANNELS) as rec:
        while True:
            data = rec.record(numframes=FRAMES)
            sys_rms = math.sqrt(float(np.mean(data ** 2))) * 32767

def capture_mic():
    global mic_rms
    if not mic:
        return
    with mic.recorder(samplerate=SAMPLE_RATE, channels=CHANNELS) as rec:
        while True:
            data = rec.record(numframes=FRAMES)
            mic_rms = math.sqrt(float(np.mean(data ** 2))) * 32767

t1 = threading.Thread(target=capture_loopback, daemon=True)
t2 = threading.Thread(target=capture_mic, daemon=True)
t1.start()
t2.start()

try:
    import time
    while True:
        sys_bar = '█' * min(int(sys_rms / 200), 30)
        mic_bar = '█' * min(int(mic_rms / 200), 30)
        print(f"系統音訊 RMS: {sys_rms:6.0f}  {sys_bar:<30}", end='')
        print(f"  麥克風 RMS: {mic_rms:6.0f}  {mic_bar:<30}", end='\r')
        time.sleep(0.1)
except KeyboardInterrupt:
    print("\n\n結果：")
    print(f"  系統音訊 RMS: {sys_rms:.0f} {'✅ 有訊號' if sys_rms > 100 else '❌ 無訊號'}")
    print(f"  麥克風   RMS: {mic_rms:.0f} {'✅ 有訊號' if mic_rms > 100 else '❌ 無訊號'}")
