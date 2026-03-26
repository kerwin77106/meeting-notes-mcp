import {
  SupportedLanguage,
  TranscriptionResult,
  TranscriptionError,
  LANGUAGE_MAP,
} from '../types.js';

export class GroqWhisperClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.groq.com/openai/v1/audio/transcriptions';
  private readonly model = 'whisper-large-v3-turbo';
  private readonly timeoutMs = 30000;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * 轉譯音訊 chunk。
   * @param chunkBuffer MP3 格式的音訊 buffer
   * @param language 語言
   * @param chunkIndex chunk 索引，用於計算時間偏移
   * @param chunkOffsetMs chunk 在整體錄音中的時間偏移（毫秒）
   */
  async transcribe(
    chunkBuffer: Buffer,
    language: SupportedLanguage,
    chunkIndex: number,
    chunkOffsetMs: number = 0,
  ): Promise<TranscriptionResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const formData = new FormData();

      // 將 Buffer 轉為 Blob
      const blob = new Blob([chunkBuffer], { type: 'audio/mpeg' });
      formData.append('file', blob, `chunk_${chunkIndex}.mp3`);
      formData.append('model', this.model);
      formData.append('response_format', 'verbose_json');
      formData.append('timestamp_granularities[]', 'segment');

      // 語言代碼對應
      const langCode = LANGUAGE_MAP[language] ?? language;
      formData.append('language', langCode);

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        const error = this.parseError(response.status, errorBody);
        throw error;
      }

      const data = await response.json() as GroqWhisperResponse;

      // 解析 segments 並調整時間戳
      const offsetSeconds = chunkOffsetMs / 1000;
      const segments = (data.segments ?? []).map((seg) => ({
        start: seg.start + offsetSeconds,
        end: seg.end + offsetSeconds,
        text: seg.text.trim(),
      }));

      return {
        text: data.text ?? '',
        segments,
        duration: data.duration ?? 0,
        language: data.language ?? langCode,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 驗證 API 金鑰是否有效。
   */
  async validateApiKey(): Promise<boolean> {
    try {
      // 發送一個極小的測試請求
      // 使用一個最小的 MP3 檔案（幾乎是空的）
      const minimalMp3 = this.createMinimalMp3();

      const formData = new FormData();
      const blob = new Blob([minimalMp3], { type: 'audio/mpeg' });
      formData.append('file', blob, 'test.mp3');
      formData.append('model', this.model);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(this.baseUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: formData,
          signal: controller.signal,
        });

        // 401 = key 無效，其他狀態碼表示 key 有效（可能內容不合法但 key 本身沒問題）
        return response.status !== 401;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  }

  // ---- 內部方法 ----

  /**
   * 建立最小 MP3 用於驗證 API key。
   * 這是一個合法的 MPEG Audio frame header。
   */
  private createMinimalMp3(): Buffer {
    // MPEG1 Layer 3, 128kbps, 44100Hz, 單聲道
    // Frame header: 0xFF 0xFB 0x90 0x00
    const header = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
    const padding = Buffer.alloc(417 - 4, 0); // 一個 frame 的大小
    return Buffer.concat([header, padding]);
  }

  /**
   * 依 HTTP 狀態碼建立適當的錯誤。
   */
  private parseError(status: number, body: string): TranscriptionError & Error {
    let message = `Groq API error (${status})`;
    let code = 'TRANSCRIPTION_ERROR';
    let retryable = false;

    try {
      const parsed = JSON.parse(body);
      if (parsed.error?.message) {
        message = parsed.error.message;
      }
    } catch {
      // 忽略 JSON 解析錯誤
    }

    switch (status) {
      case 400:
        code = 'BAD_REQUEST';
        retryable = false;
        break;
      case 401:
        code = 'GROQ_API_KEY_INVALID';
        retryable = false;
        break;
      case 413:
        code = 'PAYLOAD_TOO_LARGE';
        retryable = false;
        break;
      case 429:
        code = 'RATE_LIMITED';
        retryable = true;
        break;
      default:
        if (status >= 500) {
          code = 'SERVER_ERROR';
          retryable = true;
        }
        break;
    }

    const error = new Error(message) as TranscriptionError & Error;
    error.code = code;
    error.retryable = retryable;
    return error;
  }
}

// Groq Whisper API 回應格式
interface GroqWhisperResponse {
  text: string;
  segments?: Array<{
    id: number;
    start: number;
    end: number;
    text: string;
  }>;
  duration?: number;
  language?: string;
}
