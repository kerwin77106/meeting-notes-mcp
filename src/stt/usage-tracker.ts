import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { UsageData } from '../types.js';

const DEFAULT_USAGE: UsageData = {
  dailyUsedSeconds: 0,
  dailyLimitSeconds: 86400, // Deepgram：無嚴格每日限制，設為 24 小時
  warningThresholdPercent: 80,
  lastResetDate: '',
  totalUsedSeconds: 0,
  totalSessions: 0,
};

export class UsageTracker {
  private configDir: string;
  private filePath: string;
  private data: UsageData = { ...DEFAULT_USAGE };
  private loaded = false;

  constructor(configDir: string) {
    this.configDir = configDir;
    this.filePath = join(configDir, 'usage.json');
  }

  /**
   * 載入 usage.json，不存在則初始化預設值。
   */
  async load(): Promise<void> {
    try {
      const content = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(content) as Partial<UsageData>;

      this.data = {
        ...DEFAULT_USAGE,
        ...parsed,
      };
    } catch {
      // 檔案不存在或格式錯誤，使用預設值
      this.data = {
        ...DEFAULT_USAGE,
        lastResetDate: this.getTodayUTC(),
      };
    }

    this.checkDateReset();
    this.loaded = true;
  }

  /**
   * 累加用量，自動儲存。
   */
  async addUsage(durationSeconds: number): Promise<void> {
    await this.ensureLoaded();
    this.checkDateReset();

    this.data.dailyUsedSeconds += durationSeconds;
    this.data.totalUsedSeconds += durationSeconds;

    await this.save();
  }

  /**
   * 增加 session 計數。
   */
  async addSession(): Promise<void> {
    await this.ensureLoaded();
    this.data.totalSessions++;
    await this.save();
  }

  /**
   * 取得今日用量百分比（自動檢查日期重置）。
   */
  getUsagePercent(): number {
    this.checkDateReset();

    if (this.data.dailyLimitSeconds <= 0) return 0;
    return (this.data.dailyUsedSeconds / this.data.dailyLimitSeconds) * 100;
  }

  /**
   * 是否達到警告門檻（>= 80%）。
   */
  isWarning(): boolean {
    return this.getUsagePercent() >= this.data.warningThresholdPercent;
  }

  /**
   * 是否已超出額度（>= 100%）。
   */
  isExceeded(): boolean {
    return this.getUsagePercent() >= 100;
  }

  /**
   * 取得今日剩餘秒數。
   */
  getRemainingSeconds(): number {
    this.checkDateReset();
    const remaining = this.data.dailyLimitSeconds - this.data.dailyUsedSeconds;
    return Math.max(0, remaining);
  }

  /**
   * 取得完整用量資料。
   */
  getData(): UsageData {
    this.checkDateReset();
    return { ...this.data };
  }

  /**
   * 儲存 usage.json。
   */
  async save(): Promise<void> {
    try {
      // 確保目錄存在
      await mkdir(this.configDir, { recursive: true });
      await writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[UsageTracker] Failed to save usage data:', err);
    }
  }

  // ---- 內部方法 ----

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
  }

  /**
   * 日期重置邏輯：比對 lastResetDate 與今天 UTC 日期，不同則重置 dailyUsedSeconds。
   */
  private checkDateReset(): void {
    const today = this.getTodayUTC();

    if (this.data.lastResetDate !== today) {
      this.data.dailyUsedSeconds = 0;
      this.data.lastResetDate = today;
    }
  }

  /**
   * 取得今天的 UTC 日期字串（YYYY-MM-DD）。
   */
  private getTodayUTC(): string {
    const now = new Date();
    return now.toISOString().split('T')[0];
  }
}
