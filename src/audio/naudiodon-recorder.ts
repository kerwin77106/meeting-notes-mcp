import { PassThrough } from 'node:stream';
import { RecorderStatus } from '../types.js';
import { AudioRecorder } from './recorder.js';
import { NaudiodonDeviceDetector, LoopbackDevice, MicDevice } from './naudiodon-device-detector.js';
import { Resampler } from './resampler.js';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const naudiodon = require('naudiodon');

/** 目標輸出規格（與 Chunker 相容） */
const TARGET_RATE = 16000;
const TARGET_CHANNELS = 1;

/**
 * naudiodon (PortAudio) 錄音器。
 * 支援 WDM-KS loopback 系統音訊捕捉，相容藍芽耳機。
 * 僅用於 Windows，其他平台使用 FFmpegRecorder。
 */
export class NaudiodonRecorder implements AudioRecorder {
  private loopbackDevice: LoopbackDevice | null = null;
  private micDevice: MicDevice | null = null;

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

  constructor(loopback: LoopbackDevice | null, mic: MicDevice | null, warning?: string) {
    this.loopbackDevice = loopback;
    this.micDevice = mic;
    this.detectedWarning = warning;
  }

  /**
   * 工廠方法：自動偵測裝置並建立 NaudiodonRecorder。
   */
  static detect(): { recorder: NaudiodonRecorder; warning?: string } {
    const { loopback, mic, warning } = NaudiodonDeviceDetector.detect();
    return { recorder: new NaudiodonRecorder(loopback, mic, warning), warning };
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
    const dev = this.loopbackDevice!;
    const channels = Math.min(dev.channels, 2);

    try {
      this.loopbackStream = new naudiodon.AudioIO({
        inOptions: {
          channelCount: channels,
          sampleFormat: naudiodon.SampleFormat16Bit,
          sampleRate: dev.sampleRate,
          deviceId: dev.id,
          closeOnError: true,
        },
      });

      this.loopbackStream.on('data', (chunk: Buffer) => {
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

      this.loopbackStream.on('error', (err: Error) => {
        console.error('[NaudiodonRecorder] Loopback error:', err.message);
        this.hasLoopback = false;
      });

      this.loopbackStream.start();
    } catch (err) {
      console.error('[NaudiodonRecorder] Failed to open loopback device:', err);
      this.hasLoopback = false;
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
   * 為避免緩衝區過大（一路超前太多），設定上限 640KB。
   */
  private tryMix(): void {
    const MAX_BUFFER = 640 * 1024;
    const available = Math.min(this.sysBuffer.length, this.micBuffer.length);

    // 緩衝區超過上限：捨棄過多的資料（避免記憶體爆炸）
    if (this.sysBuffer.length > MAX_BUFFER) {
      this.sysBuffer = this.sysBuffer.subarray(this.sysBuffer.length - MAX_BUFFER);
    }
    if (this.micBuffer.length > MAX_BUFFER) {
      this.micBuffer = this.micBuffer.subarray(this.micBuffer.length - MAX_BUFFER);
    }

    if (available < 2 || !this.output) return;

    const mixed = Resampler.mix(
      this.sysBuffer.subarray(0, available),
      this.micBuffer.subarray(0, available),
    );

    this.sysBuffer = this.sysBuffer.subarray(available);
    this.micBuffer = this.micBuffer.subarray(available);

    this.output.push(mixed);
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
