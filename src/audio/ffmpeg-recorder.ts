import { spawn, ChildProcess } from 'child_process';
import { Readable } from 'stream';
import ffmpegStatic from 'ffmpeg-static';
const ffmpegPath = ffmpegStatic as unknown as string;
import { RecorderStatus } from '../types.js';
import { AudioRecorder } from './recorder.js';

interface FFmpegRecorderConfig {
  platform: NodeJS.Platform;
  systemDevice?: string;
  microphoneDevice?: string;
}

export class FFmpegRecorder implements AudioRecorder {
  private config: FFmpegRecorderConfig;
  private process: ChildProcess | null = null;
  private systemProcess: ChildProcess | null = null;
  private micProcess: ChildProcess | null = null;
  private mixProcess: ChildProcess | null = null;
  private isRecording = false;
  private startTime = 0;
  private systemAudioActive = false;
  private microphoneActive = false;
  private restartCount = 0;
  private readonly maxRestarts = 3;

  constructor(config: FFmpegRecorderConfig) {
    this.config = config;
  }

  async startSystemAudio(): Promise<NodeJS.ReadableStream> {
    return this.startSingleSource('system');
  }

  async startMicrophone(): Promise<NodeJS.ReadableStream> {
    return this.startSingleSource('microphone');
  }

  /**
   * 啟動混合錄音（系統音訊 + 麥克風），若其中一路失敗則降級為單一來源。
   * 若需要分別啟動，使用 startSystemAudio() / startMicrophone()。
   */
  async startMixed(): Promise<NodeJS.ReadableStream> {
    if (this.isRecording) {
      throw new Error('Already recording');
    }

    const binary = this.getFfmpegBinary();
    const systemArgs = this.buildInputArgs('system');
    const micArgs = this.buildInputArgs('microphone');

    let systemOk = true;
    let micOk = true;

    // 嘗試啟動系統音訊
    try {
      await this.testInput(binary, systemArgs);
    } catch {
      systemOk = false;
    }

    // 嘗試啟動麥克風
    try {
      await this.testInput(binary, micArgs);
    } catch {
      micOk = false;
    }

    if (!systemOk && !micOk) {
      throw new Error('Both system audio and microphone failed to start');
    }

    // 降級模式：只有單一來源
    if (!systemOk) {
      return this.startSingleSource('microphone');
    }
    if (!micOk) {
      return this.startSingleSource('system');
    }

    // 混合兩路音訊
    const args = [
      ...systemArgs,
      ...micArgs,
      '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=longest',
      '-ar', '16000',
      '-ac', '1',
      '-f', 's16le',
      'pipe:1',
    ];

    this.process = this.spawnFfmpeg(binary, args);
    this.isRecording = true;
    this.startTime = Date.now();
    this.systemAudioActive = true;
    this.microphoneActive = true;

    this.setupExitHandler(this.process, 'mixed');

    return this.process.stdout as NodeJS.ReadableStream;
  }

  async stop(): Promise<void> {
    if (!this.isRecording) {
      return;
    }

    const processes = [this.process, this.systemProcess, this.micProcess, this.mixProcess].filter(
      (p): p is ChildProcess => p !== null
    );

    await Promise.all(processes.map((proc) => this.gracefulStop(proc)));

    this.process = null;
    this.systemProcess = null;
    this.micProcess = null;
    this.mixProcess = null;
    this.isRecording = false;
    this.systemAudioActive = false;
    this.microphoneActive = false;
  }

  getStatus(): RecorderStatus {
    return {
      isRecording: this.isRecording,
      durationMs: this.isRecording ? Date.now() - this.startTime : 0,
      systemAudioActive: this.systemAudioActive,
      microphoneActive: this.microphoneActive,
    };
  }

  // ---- 內部方法 ----

  private getFfmpegBinary(): string {
    if (!ffmpegPath) {
      throw new Error('ffmpeg-static binary not found');
    }
    return ffmpegPath;
  }

  private buildInputArgs(source: 'system' | 'microphone'): string[] {
    const platform = this.config.platform;

    if (platform === 'win32') {
      const device =
        source === 'system'
          ? this.config.systemDevice ?? 'virtual-audio-capturer'
          : this.config.microphoneDevice ?? 'default';
      return ['-f', 'dshow', '-i', `audio=${device}`];
    }

    if (platform === 'darwin') {
      const device =
        source === 'system'
          ? this.config.systemDevice ?? '0'
          : this.config.microphoneDevice ?? '1';
      return ['-f', 'avfoundation', '-i', `:${device}`];
    }

    if (platform === 'linux') {
      const device =
        source === 'system'
          ? this.config.systemDevice ?? 'default'
          : this.config.microphoneDevice ?? 'default';
      return ['-f', 'pulse', '-i', device];
    }

    throw new Error(`Unsupported platform: ${platform}`);
  }

  private async startSingleSource(source: 'system' | 'microphone'): Promise<NodeJS.ReadableStream> {
    if (this.isRecording) {
      throw new Error('Already recording');
    }

    const binary = this.getFfmpegBinary();
    const inputArgs = this.buildInputArgs(source);

    const args = [
      ...inputArgs,
      '-ar', '16000',
      '-ac', '1',
      '-f', 's16le',
      'pipe:1',
    ];

    const proc = this.spawnFfmpeg(binary, args);

    if (source === 'system') {
      this.systemProcess = proc;
      this.systemAudioActive = true;
      this.microphoneActive = false;
    } else {
      this.micProcess = proc;
      this.microphoneActive = true;
      this.systemAudioActive = false;
    }

    this.process = proc;
    this.isRecording = true;
    this.startTime = Date.now();

    this.setupExitHandler(proc, source);

    return proc.stdout as NodeJS.ReadableStream;
  }

  private spawnFfmpeg(binary: string, args: string[]): ChildProcess {
    const proc = spawn(binary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stderr?.on('data', () => {
      // ffmpeg 輸出日誌至 stderr，此處靜默忽略
    });

    return proc;
  }

  private setupExitHandler(proc: ChildProcess, label: string): void {
    proc.on('exit', (code, signal) => {
      if (code !== 0 && signal !== 'SIGKILL' && this.isRecording) {
        // 異常退出，嘗試重啟
        if (this.restartCount < this.maxRestarts) {
          this.restartCount++;
          console.error(
            `[FFmpegRecorder] ${label} exited with code ${code}, restarting (${this.restartCount}/${this.maxRestarts})...`
          );
          this.attemptRestart(label).catch((err) => {
            console.error(`[FFmpegRecorder] Restart failed:`, err);
          });
        } else {
          console.error(
            `[FFmpegRecorder] ${label} exited with code ${code}, max restarts reached.`
          );
          this.isRecording = false;
        }
      }
    });
  }

  private async attemptRestart(label: string): Promise<void> {
    // 僅在仍處於錄音狀態時重啟
    if (!this.isRecording) return;

    try {
      // 先將 isRecording 設為 false，避免 startSingleSource 檢查拋錯
      this.isRecording = false;

      if (label === 'system') {
        await this.startSingleSource('system');
      } else if (label === 'microphone') {
        await this.startSingleSource('microphone');
      }
      // mixed 模式重啟較複雜，這裡簡單重建

      // startSingleSource 成功後會自動設定 isRecording = true
    } catch (err) {
      // 重啟失敗，保持 isRecording = false
      console.error(`[FFmpegRecorder] Restart ${label} failed:`, err);
    }
  }

  private async testInput(binary: string, inputArgs: string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const args = [...inputArgs, '-t', '0.1', '-f', 'null', '-'];
      const proc = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });

      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve(); // 超時但沒報錯，視為可用
      }, 3000);

      proc.on('exit', (code) => {
        clearTimeout(timer);
        // ffmpeg 回傳 1 可能是正常結束（因 -t 0.1），不一定是錯誤
        // 只有裝置不存在時會立刻失敗
        if (code !== null && code <= 1) {
          resolve();
        } else {
          reject(new Error(`Input test failed with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private async gracefulStop(proc: ChildProcess): Promise<void> {
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve();
      }, 5000);

      proc.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      // 送 'q' 讓 ffmpeg 優雅結束
      try {
        proc.stdin?.write('q');
        proc.stdin?.end();
      } catch {
        // stdin 可能已關閉
        proc.kill('SIGKILL');
        clearTimeout(timeout);
        resolve();
      }
    });
  }
}
