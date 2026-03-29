import { PassThrough } from 'node:stream';
import { spawn, ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { RecorderStatus } from '../types.js';
import { AudioRecorder } from './recorder.js';
import { NaudiodonDeviceDetector, LoopbackDevice, MicDevice } from './naudiodon-device-detector.js';
import { Resampler } from './resampler.js';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const naudiodon = require('naudiodon');

/** 目標輸出規格（與 Chunker 相容） */
const TARGET_RATE = 16000;
const TARGET_CHANNELS = 1;

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASAPI_LOOPBACK_SCRIPT = join(__dirname, '..', '..', 'tools', 'wasapi-loopback.py');

/**
 * naudiodon (PortAudio) 錄音器。
 * 支援 WDM-KS loopback 系統音訊捕捉，相容藍芽耳機。
 * 僅用於 Windows，其他平台使用 FFmpegRecorder。
 */
export class NaudiodonRecorder implements AudioRecorder {
  private loopbackDevice: LoopbackDevice | null = null;
  private micDevice: MicDevice | null = null;

  private loopbackProcess: ChildProcess | null = null;
  private loopbackStream: ReturnType<typeof naudiodon.AudioIO> | null = null;
  private micStream: ReturnType<typeof naudiodon.AudioIO> | null = null;
  private output: PassThrough | null = null;

  private isRecording = false;
  private startTime = 0;
  private hasLoopback = false;
  private hasMic = false;

  // 混音緩衝
  private sysBuffer: Buffer = Buffer.alloc(0);
  private micBuffer: Buffer = Buffer.alloc(0);
  private mixMode = false;

  private detectedWarning?: string;

  private loopbackCandidates: LoopbackDevice[] = [];

  constructor(loopback: LoopbackDevice | null, mic: MicDevice | null, warning?: string, loopbackCandidates: LoopbackDevice[] = []) {
    this.loopbackDevice = loopback;
    this.micDevice = mic;
    this.detectedWarning = warning;
    this.loopbackCandidates = loopbackCandidates;
  }

  /**
   * 工廠方法：自動偵測裝置並建立 NaudiodonRecorder。
   */
  static detect(): { recorder: NaudiodonRecorder; warning?: string } {
    const { loopback, loopbackCandidates, mic, warning } = NaudiodonDeviceDetector.detect();
    return { recorder: new NaudiodonRecorder(loopback, mic, warning, loopbackCandidates), warning };
  }

  async startMixed(): Promise<NodeJS.ReadableStream> {
    if (this.isRecording) throw new Error('Already recording');

    this.output = new PassThrough();
    this.isRecording = true;
    this.startTime = Date.now();
    this.mixMode = true;

    if (this.loopbackDevice) {
      this.startLoopbackStream();
      this.hasLoopback = true;
    }
    if (this.micDevice) {
      this.startMicStream();
      this.hasMic = true;
    }

    return this.output;
  }

  async startSystemAudio(): Promise<NodeJS.ReadableStream> {
    if (this.isRecording) throw new Error('Already recording');
    if (!this.loopbackDevice) throw new Error('No loopback device available');

    this.output = new PassThrough();
    this.isRecording = true;
    this.startTime = Date.now();
    this.mixMode = false;
    this.hasLoopback = true;

    this.startLoopbackStream();
    return this.output;
  }

  async startMicrophone(): Promise<NodeJS.ReadableStream> {
    if (this.isRecording) throw new Error('Already recording');
    if (!this.micDevice) throw new Error('No microphone device available');

    this.output = new PassThrough();
    this.isRecording = true;
    this.startTime = Date.now();
    this.mixMode = false;
    this.hasMic = true;

    this.startMicStream();
    return this.output;
  }

  async stop(): Promise<void> {
    this.isRecording = false;

    try { this.loopbackProcess?.kill(); } catch { /* ignore */ }
    try { this.loopbackStream?.quit(); } catch { /* ignore */ }
    try { this.micStream?.quit(); } catch { /* ignore */ }

    // 送出剩餘緩衝
    if (this.output) {
      if (this.mixMode && this.sysBuffer.length > 0 && this.micBuffer.length > 0) {
        this.flushMix();
      } else if (!this.mixMode && this.sysBuffer.length > 0) {
        this.output.push(this.sysBuffer);
      } else if (!this.mixMode && this.micBuffer.length > 0) {
        this.output.push(this.micBuffer);
      }
      this.output.end();
    }

    this.loopbackProcess = null;
    this.loopbackStream = null;
    this.micStream = null;
    this.output = null;
    this.sysBuffer = Buffer.alloc(0);
    this.micBuffer = Buffer.alloc(0);
    this.hasLoopback = false;
    this.hasMic = false;
  }

  getStatus(): RecorderStatus {
    return {
      isRecording: this.isRecording,
      durationMs: this.isRecording ? Date.now() - this.startTime : 0,
      systemAudioActive: this.hasLoopback,
      microphoneActive: this.hasMic,
    };
  }

  get warning(): string | undefined {
    return this.detectedWarning;
  }

  // ---- 內部方法 ----

  private startLoopbackStream(): void {
    // 優先嘗試 Python WASAPI loopback（支援藍芽耳機系統音訊）
    if (existsSync(WASAPI_LOOPBACK_SCRIPT) && this.tryOpenPythonLoopback()) {
      return;
    }

    // Fallback：依優先順序嘗試 naudiodon loopback 候選
    const candidates = this.loopbackCandidates.length > 0
      ? this.loopbackCandidates
      : (this.loopbackDevice ? [this.loopbackDevice] : []);

    for (const dev of candidates) {
      if (this.tryOpenLoopback(dev)) {
        this.loopbackDevice = dev;
        return;
      }
    }

    console.error('[NaudiodonRecorder] All loopback candidates failed');
    this.hasLoopback = false;
  }

  private tryOpenPythonLoopback(): boolean {
    try {
      const proc = spawn('python', [WASAPI_LOOPBACK_SCRIPT], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.on('error', (err: Error) => {
        console.error('[NaudiodonRecorder] Python loopback error:', err.message);
        if (this.isRecording) this.hasLoopback = false;
      });

      proc.on('exit', (code: number | null) => {
        if (code !== 0 && code !== null && this.isRecording) {
          console.error('[NaudiodonRecorder] Python loopback exited with code:', code);
          this.hasLoopback = false;
        }
      });

      proc.stderr!.on('data', (data: Buffer) => {
        console.error('[wasapi-loopback]', data.toString().trim());
      });

      proc.stdout!.on('data', (chunk: Buffer) => {
        if (!this.isRecording || !this.output) return;
        // Python 腳本已輸出 16kHz mono int16，不需 resample
        if (this.mixMode) {
          this.sysBuffer = Buffer.concat([this.sysBuffer, chunk]);
          this.tryMix();
        } else {
          this.output.push(chunk);
        }
      });

      this.loopbackProcess = proc;
      console.error('[NaudiodonRecorder] Python WASAPI loopback started');
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[NaudiodonRecorder] Failed to start Python loopback:', msg);
      return false;
    }
  }

  private tryOpenLoopback(dev: LoopbackDevice): boolean {
    const channels = Math.min(dev.channels, 2);

    try {
      const stream = new naudiodon.AudioIO({
        inOptions: {
          channelCount: channels,
          sampleFormat: naudiodon.SampleFormat16Bit,
          sampleRate: dev.sampleRate,
          deviceId: dev.id,
          closeOnError: true,
        },
      });

      stream.on('data', (chunk: Buffer) => {
        if (!this.isRecording || !this.output) return;
        let pcm = chunk;

        // stereo → mono
        if (channels === 2) {
          pcm = Resampler.stereoToMono(pcm);
        }
        // resample to 16kHz
        if (dev.sampleRate !== TARGET_RATE) {
          pcm = Resampler.resample(pcm, dev.sampleRate, TARGET_RATE);
        }

        if (this.mixMode) {
          this.sysBuffer = Buffer.concat([this.sysBuffer, pcm]);
          this.tryMix();
        } else {
          this.output.push(pcm);
        }
      });

      stream.on('error', (err: Error) => {
        console.error(`[NaudiodonRecorder] Loopback error (${dev.name}):`, err.message);
        this.hasLoopback = false;
      });

      stream.start();
      this.loopbackStream = stream;
      console.error(`[NaudiodonRecorder] Loopback opened: [ID:${dev.id}] ${dev.name}`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[NaudiodonRecorder] Skipping [ID:${dev.id}] ${dev.name}: ${msg}`);
      return false;
    }
  }

  private startMicStream(): void {
    const dev = this.micDevice!;

    try {
      this.micStream = new naudiodon.AudioIO({
        inOptions: {
          channelCount: TARGET_CHANNELS,
          sampleFormat: naudiodon.SampleFormat16Bit,
          sampleRate: dev.sampleRate,
          deviceId: dev.id,
          closeOnError: true,
        },
      });

      this.micStream.on('data', (chunk: Buffer) => {
        if (!this.isRecording || !this.output) return;
        let pcm = chunk;

        // resample to 16kHz
        if (dev.sampleRate !== TARGET_RATE) {
          pcm = Resampler.resample(pcm, dev.sampleRate, TARGET_RATE);
        }

        if (this.mixMode) {
          this.micBuffer = Buffer.concat([this.micBuffer, pcm]);
          this.tryMix();
        } else {
          this.output.push(pcm);
        }
      });

      this.micStream.on('error', (err: Error) => {
        console.error('[NaudiodonRecorder] Mic error:', err.message);
        this.hasMic = false;
      });

      this.micStream.start();
    } catch (err) {
      console.error('[NaudiodonRecorder] Failed to open mic device:', err);
      this.hasMic = false;
    }
  }

  /**
   * 嘗試混音：取兩個緩衝區最小的共同長度進行混音並輸出。
   * 若其中一路遠超另一路（超過 1 秒），用 0 補齊較慢的一路，避免資料卡住。
   * 為避免緩衝區過大（一路超前太多），設定上限 640KB。
   */
  private tryMix(): void {
    const MAX_BUFFER = 640 * 1024;
    // 16kHz, 16-bit, mono → 32000 bytes/sec → 1 秒 = 32000 bytes
    const SYNC_THRESHOLD = 32000;

    // 緩衝區超過上限：捨棄過多的資料（避免記憶體爆炸）
    if (this.sysBuffer.length > MAX_BUFFER) {
      this.sysBuffer = this.sysBuffer.subarray(this.sysBuffer.length - MAX_BUFFER);
    }
    if (this.micBuffer.length > MAX_BUFFER) {
      this.micBuffer = this.micBuffer.subarray(this.micBuffer.length - MAX_BUFFER);
    }

    if (!this.output) return;

    const available = Math.min(this.sysBuffer.length, this.micBuffer.length);

    if (available >= 2) {
      // 兩路都有資料：正常混音
      const mixed = Resampler.mix(
        this.sysBuffer.subarray(0, available),
        this.micBuffer.subarray(0, available),
      );
      this.sysBuffer = this.sysBuffer.subarray(available);
      this.micBuffer = this.micBuffer.subarray(available);
      this.output.push(mixed);
    } else if (this.sysBuffer.length > SYNC_THRESHOLD) {
      // 僅 loopback 有資料（mic 沒跟上）：用 0 補齊 mic，輸出 loopback
      const len = this.sysBuffer.length - SYNC_THRESHOLD;
      const padding = Buffer.alloc(len);
      const mixed = Resampler.mix(this.sysBuffer.subarray(0, len), padding);
      this.sysBuffer = this.sysBuffer.subarray(len);
      this.output.push(mixed);
    } else if (this.micBuffer.length > SYNC_THRESHOLD) {
      // 僅 mic 有資料（loopback 沒跟上）：用 0 補齊 loopback，輸出 mic
      const len = this.micBuffer.length - SYNC_THRESHOLD;
      const padding = Buffer.alloc(len);
      const mixed = Resampler.mix(padding, this.micBuffer.subarray(0, len));
      this.micBuffer = this.micBuffer.subarray(len);
      this.output.push(mixed);
    }
  }

  private flushMix(): void {
    if (!this.output) return;
    const available = Math.min(this.sysBuffer.length, this.micBuffer.length);
    if (available < 2) return;

    const mixed = Resampler.mix(
      this.sysBuffer.subarray(0, available),
      this.micBuffer.subarray(0, available),
    );
    this.output.push(mixed);
    this.sysBuffer = Buffer.alloc(0);
    this.micBuffer = Buffer.alloc(0);
  }
}
