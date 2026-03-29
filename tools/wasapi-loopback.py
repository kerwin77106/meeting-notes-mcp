#!/usr/bin/env python3
"""
WASAPI Loopback Audio Capture - Windows only
Captures system audio output (including Bluetooth) via WASAPI loopback.
Outputs raw PCM: 16000Hz, mono, 16-bit signed little-endian to stdout.

Usage: python wasapi-loopback.py
"""
import sys


def main():
    try:
        import soundcard as sc
        import numpy as np
    except ImportError:
        sys.stderr.write('ERROR: Missing dependencies. Run: pip install soundcard numpy\n')
        sys.stderr.flush()
        sys.exit(1)

    SAMPLE_RATE = 16000
    CHANNELS = 1
    FRAMES = 1600  # 100ms per chunk

    try:
        speaker = sc.default_speaker()
        sys.stderr.write(f'[wasapi-loopback] device: {speaker.name}\n')
        sys.stderr.flush()

        loopback = sc.get_microphone(speaker.id, include_loopback=True)

        with loopback.recorder(samplerate=SAMPLE_RATE, channels=CHANNELS) as rec:
            sys.stderr.write('[wasapi-loopback] READY\n')
            sys.stderr.flush()
            while True:
                data = rec.record(numframes=FRAMES)
                # float32 [-1.0, 1.0] -> int16 little-endian
                pcm = np.clip(data * 32767, -32768, 32767).astype('<i2')
                sys.stdout.buffer.write(pcm.tobytes())
                sys.stdout.buffer.flush()

    except KeyboardInterrupt:
        pass
    except Exception as e:
        sys.stderr.write(f'ERROR: {e}\n')
        sys.stderr.flush()
        sys.exit(1)


if __name__ == '__main__':
    main()
