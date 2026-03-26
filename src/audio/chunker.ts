import { spawn, ChildProcess } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
const ffmpegPath = ffmpegStatic as unknown as string;
import { AudioChunk, ChunkerConfig } from '../types.js';

type ChunkCallback = (chunk: AudioChunk) => void;

export class Chunker {
  private config: ChunkerConfig;
  private buffer: Buffer = Buffer.alloc(0);
  private chunkIndex = 0;
  private overlapBuffer: Buffer = Buffer.alloc(0);
  private callbacks: ChunkCallback[] = [];
  private running = false;
  private streamStartTimeMs = 0;

  // PCM 參數：16kHz, 16-bit, mono
  private readonly sampleRate = 16000;
  private readonly bytesPerSample = 2;
  private readonly channels = 1;

  constructor(config: ChunkerConfig) {
    this.config = config;
  }

  /**
   * 註冊 chunk 完成回呼。
   */
  onChunk(callback: ChunkCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * 開始從 ReadableStream 讀取 PCM 資料。
   */
  start(stream: NodeJS.ReadableStream): void {
    this.running = true;
    this.streamStartTimeMs = Date.now();
    this.chunkIndex = 0;
    this.buffer = Buffer.alloc(0);
    this.overlapBuffer = Buffer.alloc(0);

    stream.on('data', (data: Buffer) => {
      if (!this.running) return;

      this.buffer = Buffer.concat([this.buffer, data]);

      const chunkBytes = this.msToPcmBytes(this.config.chunkDurationMs);

      while (this.buffer.length >= chunkBytes) {
        const chunkData = this.buffer.subarray(0, chunkBytes);
        this.buffer = this.buffer.subarray(chunkBytes);

        this.emitChunk(chunkData).catch((err) => {
          console.error('[Chunker] emitChunk error:', err);
        });
      }
    });

    stream.on('end', () => {
      if (this.running) {
        this.flush().catch((err) => {
          console.error('[Chunker] flush error:', err);
        });
      }
    });

    stream.on('error', (err) => {
      console.error('[Chunker] Stream error:', err);
    });
  }

  /**
   * 送出最後不足完整時長的 chunk。
   */
  async flush(): Promise<AudioChunk | null> {
    if (this.buffer.length > 0) {
      const chunk = await this.emitChunk(this.buffer);
      this.buffer = Buffer.alloc(0);
      return chunk;
    }
    return null;
  }

  /**
   * 停止接收。
   */
  stop(): void {
    this.running = false;
  }

  // ---- 內部方法 ----

  private async emitChunk(pcmData: Buffer): Promise<AudioChunk> {
    const overlapBytes = this.msToPcmBytes(this.config.overlapMs);

    // 前面加上前一個 chunk 尾端的重疊資料
    let fullPcm: Buffer;
    if (this.overlapBuffer.length > 0) {
      fullPcm = Buffer.concat([this.overlapBuffer, pcmData]);
    } else {
      fullPcm = pcmData;
    }

    // 保存當前 chunk 尾端作為下一個 chunk 的重疊資料
    if (pcmData.length >= overlapBytes) {
      this.overlapBuffer = pcmData.subarray(pcmData.length - overlapBytes);
    } else {
      this.overlapBuffer = Buffer.from(pcmData);
    }

    const index = this.chunkIndex++;
    const bytesPerMs = (this.sampleRate * this.bytesPerSample * this.channels) / 1000;
    const chunkDurationMs = pcmData.length / bytesPerMs;

    const startTimeMs = index === 0
      ? 0
      : index * this.config.chunkDurationMs - this.config.overlapMs;
    const endTimeMs = startTimeMs + chunkDurationMs + (this.overlapBuffer.length > 0 ? this.config.overlapMs : 0);

    // PCM → MP3 轉換
    const mp3Buffer = await this.convertToMp3(fullPcm);
    const chunk: AudioChunk = {
      index,
      buffer: mp3Buffer,
      startTimeMs,
      endTimeMs,
      overlapStartMs: index > 0 ? this.config.overlapMs : 0,
      overlapEndMs: this.config.overlapMs,
    };

    for (const cb of this.callbacks) {
      try {
        cb(chunk);
      } catch (err) {
        console.error('[Chunker] Callback error:', err);
      }
    }

    return chunk;
  }

  /**
   * 使用 ffmpeg 將 PCM 資料轉為 MP3。
   */
  private convertToMp3(pcmData: Buffer): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const binary = this.getFfmpegBinary();

      const proc: ChildProcess = spawn(binary, [
        '-f', 's16le',
        '-ar', String(this.sampleRate),
        '-ac', String(this.channels),
        '-i', 'pipe:0',
        '-codec:a', 'libmp3lame',
        '-b:a', '64k',
        '-f', 'mp3',
        'pipe:1',
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const chunks: Buffer[] = [];

      proc.stdout?.on('data', (data: Buffer) => {
        chunks.push(data);
      });

      proc.on('exit', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`ffmpeg MP3 conversion exited with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });

      // 將 PCM 資料寫入 stdin
      proc.stdin?.write(pcmData);
      proc.stdin?.end();
    });
  }

  private getFfmpegBinary(): string {
    if (!ffmpegPath) {
      throw new Error('ffmpeg-static binary not found');
    }
    return ffmpegPath;
  }

  private msToPcmBytes(ms: number): number {
    return Math.floor((ms / 1000) * this.sampleRate * this.bytesPerSample * this.channels);
  }
}
