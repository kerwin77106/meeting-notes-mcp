import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AppConfig, SupportedLanguage } from '../types.js';
import { SUPPORTED_LANGUAGES } from '../types.js';

/**
 * 設定檔路徑：~/.meeting-notes-mcp/config.json
 * 優先順序：環境變數 GROQ_API_KEY > config.json > 預設值
 */

const DEFAULT_CONFIG: AppConfig = {
  groqApiKey: null,
  language: 'zh-TW',
  outputDir: path.join(os.homedir(), 'meeting-notes'),
  chunkDurationMs: 30000,
  maxConcurrentTranscriptions: 3,
};

export class Settings {
  private configDir: string;
  private configPath: string;
  private config: AppConfig;

  constructor() {
    this.configDir = path.join(os.homedir(), '.meeting-notes-mcp');
    this.configPath = path.join(this.configDir, 'config.json');
    this.config = { ...DEFAULT_CONFIG };
  }

  /**
   * 從檔案載入設定，若檔案不存在則使用預設值。
   * 環境變數 GROQ_API_KEY 永遠覆蓋 config.json 中的值。
   */
  async load(): Promise<void> {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = await fs.promises.readFile(this.configPath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<AppConfig>;

        // 合併設定：config.json 的值覆蓋預設值
        if (parsed.groqApiKey !== undefined) {
          this.config.groqApiKey = parsed.groqApiKey;
        }
        if (parsed.language !== undefined && SUPPORTED_LANGUAGES.includes(parsed.language)) {
          this.config.language = parsed.language;
        }
        if (parsed.outputDir !== undefined) {
          this.config.outputDir = this.expandHome(parsed.outputDir);
        }
        if (parsed.chunkDurationMs !== undefined && parsed.chunkDurationMs > 0) {
          this.config.chunkDurationMs = parsed.chunkDurationMs;
        }
        if (parsed.maxConcurrentTranscriptions !== undefined && parsed.maxConcurrentTranscriptions > 0) {
          this.config.maxConcurrentTranscriptions = parsed.maxConcurrentTranscriptions;
        }
      }
    } catch {
      // 檔案不存在或 JSON 解析失敗，使用預設值
    }

    // 環境變數 GROQ_API_KEY 優先
    const envKey = process.env['GROQ_API_KEY'];
    if (envKey) {
      this.config.groqApiKey = envKey;
    }
  }

  /**
   * 將目前設定寫入 config.json（權限 600）
   */
  async save(): Promise<void> {
    // 確保目錄存在
    if (!fs.existsSync(this.configDir)) {
      await fs.promises.mkdir(this.configDir, { recursive: true });
    }

    const data = JSON.stringify(this.config, null, 2);
    await fs.promises.writeFile(this.configPath, data, { encoding: 'utf-8', mode: 0o600 });
  }

  /**
   * 展開 ~ 為使用者家目錄
   */
  private expandHome(filePath: string): string {
    if (filePath.startsWith('~')) {
      return path.join(os.homedir(), filePath.slice(1));
    }
    return filePath;
  }

  // ---- Getters ----

  get groqApiKey(): string | null {
    return this.config.groqApiKey;
  }

  get language(): SupportedLanguage {
    return this.config.language;
  }

  get outputDir(): string {
    return this.config.outputDir;
  }

  get chunkDurationMs(): number {
    return this.config.chunkDurationMs;
  }

  get maxConcurrentTranscriptions(): number {
    return this.config.maxConcurrentTranscriptions;
  }

  // ---- Setters ----

  setGroqApiKey(key: string | null): void {
    this.config.groqApiKey = key;
  }

  setLanguage(lang: SupportedLanguage): void {
    if (SUPPORTED_LANGUAGES.includes(lang)) {
      this.config.language = lang;
    }
  }

  setOutputDir(dir: string): void {
    this.config.outputDir = this.expandHome(dir);
  }

  setChunkDurationMs(ms: number): void {
    if (ms > 0) {
      this.config.chunkDurationMs = ms;
    }
  }

  setMaxConcurrentTranscriptions(n: number): void {
    if (n > 0) {
      this.config.maxConcurrentTranscriptions = n;
    }
  }

  /**
   * 取得完整設定（不含敏感資訊的副本）
   */
  getAll(): AppConfig {
    return { ...this.config };
  }

  /**
   * 取得設定檔路徑
   */
  getConfigPath(): string {
    return this.configPath;
  }
}
