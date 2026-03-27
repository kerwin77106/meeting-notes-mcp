import {
  AudioChunk,
  QueueConfig,
  TranscriptionResult,
  SupportedLanguage,
} from '../types.js';
import { UsageTracker } from './usage-tracker.js';

/**
 * STT Client 介面 — GroqWhisperClient 和 DeepgramClient 皆可適用。
 */
interface SttClient {
  transcribe(
    chunkBuffer: Buffer,
    language: SupportedLanguage,
    chunkIndex: number,
    chunkOffsetMs?: number,
  ): Promise<TranscriptionResult>;
}

type TranscriptionCompleteCallback = (
  sessionId: string,
  chunkIndex: number,
  result: TranscriptionResult,
) => void;

type TranscriptionFailedCallback = (
  sessionId: string,
  chunkIndex: number,
  error: Error,
) => void;

interface QueueItem {
  sessionId: string;
  chunk: AudioChunk;
  language: SupportedLanguage;
  attempt: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: TranscriptionResult;
  error?: Error;
}

interface WaitHandle {
  sessionId: string;
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class TranscriptionQueue {
  private config: QueueConfig;
  private sttClient: SttClient;
  private usageTracker: UsageTracker;

  private queue: QueueItem[] = [];
  private activeCount = 0;
  private onCompleteCallbacks: TranscriptionCompleteCallback[] = [];
  private onFailedCallbacks: TranscriptionFailedCallback[] = [];
  private waitHandles: WaitHandle[] = [];

  constructor(config: QueueConfig, sttClient: SttClient, usageTracker: UsageTracker) {
    this.config = config;
    this.sttClient = sttClient;
    this.usageTracker = usageTracker;
  }

  /**
   * 加入 chunk 至佇列。
   */
  enqueue(sessionId: string, chunk: AudioChunk, language: SupportedLanguage): void {
    const item: QueueItem = {
      sessionId,
      chunk,
      language,
      attempt: 0,
      status: 'pending',
    };

    this.queue.push(item);
    this.processNext();
  }

  /**
   * 等待指定 session 的所有 chunk 完成。
   */
  waitForAll(sessionId: string, timeoutMs: number = 300000): Promise<void> {
    // 檢查是否已經全部完成
    if (this.isSessionComplete(sessionId)) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // 移除 wait handle
        const idx = this.waitHandles.findIndex(
          (h) => h.sessionId === sessionId && h.resolve === resolve,
        );
        if (idx >= 0) {
          this.waitHandles.splice(idx, 1);
        }
        reject(new Error(`Transcription timeout for session ${sessionId} after ${timeoutMs}ms`));
      }, timeoutMs);

      this.waitHandles.push({ sessionId, resolve, reject, timer });
    });
  }

  /**
   * 取得指定 session 的統計。
   */
  getStats(sessionId: string): {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  } {
    const items = this.queue.filter((i) => i.sessionId === sessionId);
    return {
      pending: items.filter((i) => i.status === 'pending').length,
      processing: items.filter((i) => i.status === 'processing').length,
      completed: items.filter((i) => i.status === 'completed').length,
      failed: items.filter((i) => i.status === 'failed').length,
    };
  }

  /**
   * 註冊轉譯完成回呼。
   */
  onTranscriptionComplete(callback: TranscriptionCompleteCallback): void {
    this.onCompleteCallbacks.push(callback);
  }

  /**
   * 註冊轉譯失敗回呼。
   */
  onTranscriptionFailed(callback: TranscriptionFailedCallback): void {
    this.onFailedCallbacks.push(callback);
  }

  // ---- 內部方法 ----

  private processNext(): void {
    if (this.activeCount >= this.config.maxConcurrent) {
      return;
    }

    const item = this.queue.find((i) => i.status === 'pending');
    if (!item) {
      return;
    }

    item.status = 'processing';
    this.activeCount++;

    this.processItem(item)
      .then((result) => {
        item.status = 'completed';
        item.result = result;
        this.activeCount--;

        // 通知回呼
        for (const cb of this.onCompleteCallbacks) {
          try {
            cb(item.sessionId, item.chunk.index, result);
          } catch (err) {
            console.error('[TranscriptionQueue] Complete callback error:', err);
          }
        }

        // 記錄用量
        this.usageTracker.addUsage(result.duration).catch((err) => {
          console.error('[TranscriptionQueue] Usage tracking error:', err);
        });

        // 檢查 session 是否全部完成
        this.checkSessionComplete(item.sessionId);

        // 繼續處理下一個
        this.processNext();
      })
      .catch((err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        const retryable = (error as any).retryable ?? false;

        if (retryable && item.attempt < this.config.retryAttempts) {
          // 指數退避重試
          item.attempt++;
          item.status = 'pending';
          this.activeCount--;

          const delay = this.config.retryDelayMs * Math.pow(2, item.attempt - 1);
          setTimeout(() => {
            this.processNext();
          }, delay);
        } else {
          item.status = 'failed';
          item.error = error;
          this.activeCount--;

          // 通知回呼
          for (const cb of this.onFailedCallbacks) {
            try {
              cb(item.sessionId, item.chunk.index, error);
            } catch (cbErr) {
              console.error('[TranscriptionQueue] Failed callback error:', cbErr);
            }
          }

          // 檢查 session 是否全部完成（含失敗的）
          this.checkSessionComplete(item.sessionId);

          // 繼續處理下一個
          this.processNext();
        }
      });
  }

  private async processItem(item: QueueItem): Promise<TranscriptionResult> {
    // 跳過靜音 chunk（buffer 為空表示音量太低）
    if (item.chunk.buffer.length === 0) {
      return { text: '', segments: [], duration: 0, language: '' };
    }

    return this.sttClient.transcribe(
      item.chunk.buffer,
      item.language,
      item.chunk.index,
      item.chunk.startTimeMs,
    );
  }

  private isSessionComplete(sessionId: string): boolean {
    const items = this.queue.filter((i) => i.sessionId === sessionId);
    if (items.length === 0) return true;
    return items.every((i) => i.status === 'completed' || i.status === 'failed');
  }

  private checkSessionComplete(sessionId: string): void {
    if (!this.isSessionComplete(sessionId)) return;

    // 解除所有等待此 session 的 handle
    const handles = this.waitHandles.filter((h) => h.sessionId === sessionId);
    for (const handle of handles) {
      clearTimeout(handle.timer);
      handle.resolve();
    }
    this.waitHandles = this.waitHandles.filter((h) => h.sessionId !== sessionId);
  }
}
