import {
  SupportedLanguage,
  TranscriptionResult,
  TranscriptionError,
  LANGUAGE_MAP,
} from '../types.js';

/**
 * Deepgram Nova-2 STT Client。
 * 取代 Groq Whisper，幻覺問題大幅改善。
 */
export class DeepgramClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.deepgram.com/v1/listen';
  private readonly model = 'nova-2';
  private readonly timeoutMs = 30000;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * 轉譯音訊 chunk。
   * @param chunkBuffer MP3 格式的音訊 buffer
   * @param language 語言
   * @param chunkIndex chunk 索引
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
      // Deepgram 直接支援 zh-TW / zh-CN，不需映射為 zh
      const langCode = language;

      // Deepgram 使用 query parameters 而非 form-data
      const params = new URLSearchParams({
        model: this.model,
        language: langCode,
        punctuate: 'true',
        utterances: 'false',
        smart_format: 'true',
      });

      const response = await fetch(`${this.baseUrl}?${params.toString()}`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.apiKey}`,
          'Content-Type': 'audio/mpeg',
        },
        body: chunkBuffer,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        const error = this.parseError(response.status, errorBody);
        throw error;
      }

      const data = (await response.json()) as DeepgramResponse;

      // 解析結果
      const offsetSeconds = chunkOffsetMs / 1000;
      const channel = data.results?.channels?.[0];
      const alternative = channel?.alternatives?.[0];

      if (!alternative) {
        return { text: '', segments: [], duration: 0, language: langCode };
      }

      // 從 words 組裝 segments（按句子/段落分組）
      const segments = this.buildSegments(alternative, offsetSeconds);

      const duration = data.metadata?.duration ?? 0;

      return {
        text: alternative.transcript ?? '',
        segments,
        duration,
        language: data.metadata?.language ?? langCode,
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
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);

      try {
        // 用 projects endpoint 檢查 key 是否有效
        const response = await fetch('https://api.deepgram.com/v1/projects', {
          method: 'GET',
          headers: {
            Authorization: `Token ${this.apiKey}`,
          },
          signal: controller.signal,
        });

        return response.status !== 401 && response.status !== 403;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  }

  // ---- 內部方法 ----

  /**
   * 從 Deepgram alternative 建立 segments。
   * 利用 words 的時間戳，以標點符號斷句。
   */
  private buildSegments(
    alternative: DeepgramAlternative,
    offsetSeconds: number,
  ): Array<{ start: number; end: number; text: string }> {
    const words = alternative.words;
    if (!words || words.length === 0) {
      // 沒有 word-level 資訊，回傳整段
      if (alternative.transcript) {
        return [
          {
            start: offsetSeconds,
            end: offsetSeconds,
            text: alternative.transcript.trim(),
          },
        ];
      }
      return [];
    }

    // 以標點符號為斷點分組
    const segments: Array<{ start: number; end: number; text: string }> = [];
    let segStart = words[0].start;
    let segWords: string[] = [];

    for (const word of words) {
      segWords.push(word.punctuated_word ?? word.word);

      // 遇到句尾標點或最後一個 word 時結束 segment
      const punctuated = word.punctuated_word ?? word.word;
      const isEndOfSentence = /[。？！.?!；;]$/.test(punctuated);

      if (isEndOfSentence || word === words[words.length - 1]) {
        segments.push({
          start: segStart + offsetSeconds,
          end: word.end + offsetSeconds,
          text: segWords.join('').trim(),
        });
        // 下一段開始
        segStart = word.end;
        segWords = [];
      }
    }

    return segments;
  }

  /**
   * 依 HTTP 狀態碼建立適當的錯誤。
   */
  private parseError(status: number, body: string): TranscriptionError & Error {
    let message = `Deepgram API error (${status})`;
    let code = 'TRANSCRIPTION_ERROR';
    let retryable = false;

    try {
      const parsed = JSON.parse(body);
      if (parsed.err_msg) {
        message = parsed.err_msg;
      } else if (parsed.error) {
        message = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error);
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
      case 403:
        code = 'DEEPGRAM_API_KEY_INVALID';
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

// Deepgram API 回應格式
interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  punctuated_word?: string;
}

interface DeepgramAlternative {
  transcript: string;
  confidence: number;
  words?: DeepgramWord[];
}

interface DeepgramChannel {
  alternatives: DeepgramAlternative[];
}

interface DeepgramResponse {
  metadata?: {
    transaction_key?: string;
    request_id?: string;
    sha256?: string;
    created?: string;
    duration?: number;
    channels?: number;
    models?: string[];
    model_info?: Record<string, unknown>;
    language?: string;
  };
  results?: {
    channels?: DeepgramChannel[];
  };
}
