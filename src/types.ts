// 支援語言
export type SupportedLanguage = 'zh-TW' | 'zh-CN' | 'en' | 'ja' | 'ko';

// Session 狀態
export type SessionStatus = 'RECORDING' | 'STOPPING' | 'COMPLETED' | 'ERROR';

// 逐字稿片段
export interface TranscriptSegment {
  start: number;   // 起始時間（秒），相對於錄音開始
  end: number;     // 結束時間（秒）
  text: string;    // 轉譯文字
}

// 音訊裝置
export interface AudioDevice {
  name: string;
  type: 'system' | 'microphone';
  platform: NodeJS.Platform;
  deviceId?: string;
}

// 音訊 chunk
export interface AudioChunk {
  index: number;
  buffer: Buffer;
  startTimeMs: number;
  endTimeMs: number;
  overlapStartMs: number;
  overlapEndMs: number;
}

// Chunker 設定
export interface ChunkerConfig {
  chunkDurationMs: number;    // 預設 30000
  overlapMs: number;          // 前後重疊 1000ms
  maxChunkSizeBytes: number;  // 上限 25MB
  outputFormat: 'mp3';
}

// 佇列設定
export interface QueueConfig {
  maxConcurrent: number;      // 預設 3
  retryAttempts: number;      // 預設 3
  retryDelayMs: number;       // 預設 1000
  timeoutMs: number;          // 預設 30000
}

// 應用設定
export interface AppConfig {
  groqApiKey: string | null;
  language: SupportedLanguage;
  outputDir: string;
  chunkDurationMs: number;
  maxConcurrentTranscriptions: number;
}

// 使用量資料
export interface UsageData {
  dailyUsedSeconds: number;
  dailyLimitSeconds: number;
  warningThresholdPercent: number;
  lastResetDate: string;
  totalUsedSeconds: number;
  totalSessions: number;
}

// 轉譯結果
export interface TranscriptionResult {
  text: string;
  segments: TranscriptSegment[];
  duration: number;
  language: string;
}

// 轉譯錯誤
export interface TranscriptionError {
  code: string;
  message: string;
  retryable: boolean;
}

// Recorder 狀態
export interface RecorderStatus {
  isRecording: boolean;
  durationMs: number;
  systemAudioActive: boolean;
  microphoneActive: boolean;
}

// Chunk 記錄（SessionManager 內部）
export interface ChunkRecord {
  index: number;
  startTimeMs: number;
  endTimeMs: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: TranscriptionResult;
  error?: string;
}

// Session
export interface Session {
  sessionId: string;
  meetingName: string;
  participants: string[];
  language: SupportedLanguage;
  status: SessionStatus;
  startedAt: Date;
  completedAt?: Date;
  transcript: TranscriptSegment[];
  chunks: ChunkRecord[];
  recorder?: {
    stop(): Promise<void>;
    getStatus(): RecorderStatus;
  };
  chunker?: {
    flush(): Promise<AudioChunk | null>;
    stop(): void;
  };
}

// MCP Tool 回傳
export interface McpToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// 歷史紀錄項目
export interface RecordingEntry {
  filename: string;
  path: string;
  size_bytes: number;
  created_at: string;
  format: 'md' | 'txt' | 'docx';
}

// Docx 中繼資料
export interface DocxMetadata {
  meetingName: string;
  participants: string[];
  duration: string;
  language: SupportedLanguage;
  date: string;
}

// 失敗 Chunk 資訊
export interface FailedChunk {
  chunk_index: number;
  start_time: number;
  end_time: number;
  error: string;
}

// 語言代碼對應表
export const LANGUAGE_MAP: Record<SupportedLanguage, string> = {
  'zh-TW': 'zh',
  'zh-CN': 'zh',
  'en': 'en',
  'ja': 'ja',
  'ko': 'ko',
};

// 支援的語言列表
export const SUPPORTED_LANGUAGES: SupportedLanguage[] = ['zh-TW', 'zh-CN', 'en', 'ja', 'ko'];

// 檔案系統非法字元正則
export const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/;

// session_id 格式正則
export const SESSION_ID_PATTERN = /^mtg-\d{14}-[a-f0-9]{4}$/;

// 錯誤碼
export type ErrorCode =
  | 'ALREADY_RECORDING'
  | 'AUDIO_DEVICE_NOT_FOUND'
  | 'MICROPHONE_NOT_FOUND'
  | 'MICROPHONE_PERMISSION_DENIED'
  | 'GROQ_API_KEY_MISSING'
  | 'GROQ_API_KEY_INVALID'
  | 'UNSUPPORTED_PLATFORM'
  | 'NATIVE_MODULE_MISSING'
  | 'VALIDATION_ERROR'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_NOT_RECORDING'
  | 'TRANSCRIPTION_TIMEOUT'
  | 'TRANSCRIPTION_PARTIAL_FAILURE'
  | 'WRITE_PERMISSION_DENIED'
  | 'DISK_FULL'
  | 'DOCX_GENERATION_FAILED'
  | 'READ_PERMISSION_DENIED';
