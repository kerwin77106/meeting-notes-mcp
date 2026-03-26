import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TranscriptSegment, FailedChunk, SupportedLanguage } from '../types.js';

export interface MarkdownExportOptions {
  meetingName: string;
  participants: string[];
  language: SupportedLanguage;
  duration: string;
  date: string;
  transcript: TranscriptSegment[];
  failedChunks?: FailedChunk[];
  outputDir: string;
  filename?: string;
}

/**
 * MarkdownExporter：將會議紀錄匯出為 Markdown 檔案（UTF-8）。
 */
export class MarkdownExporter {
  /**
   * 匯出 Markdown 檔案，回傳檔案完整路徑。
   */
  async export(options: MarkdownExportOptions): Promise<string> {
    const content = this.generateContent(options);
    const filename = options.filename ?? this.generateFilename(options.meetingName, options.date);
    const filePath = path.join(options.outputDir, filename);

    // 確保輸出目錄存在
    if (!fs.existsSync(options.outputDir)) {
      await fs.promises.mkdir(options.outputDir, { recursive: true });
    }

    await fs.promises.writeFile(filePath, content, { encoding: 'utf-8' });
    return filePath;
  }

  /**
   * 產生 Markdown 內容
   */
  generateContent(options: MarkdownExportOptions): string {
    const lines: string[] = [];

    // 標題
    lines.push(`# ${options.meetingName}`);
    lines.push('');

    // 中繼資料表格
    lines.push('| 項目 | 內容 |');
    lines.push('| --- | --- |');
    lines.push(`| 日期 | ${options.date} |`);
    lines.push(`| 時長 | ${options.duration} |`);
    lines.push(`| 語言 | ${options.language} |`);
    lines.push(`| 參與者 | ${options.participants.join(', ')} |`);
    lines.push('');

    // 逐字稿
    lines.push('## 逐字稿');
    lines.push('');

    if (options.transcript.length === 0) {
      lines.push('> 無逐字稿內容');
    } else {
      for (const segment of options.transcript) {
        const timestamp = this.formatTimestamp(segment.start);
        lines.push(`**[${timestamp}]** ${segment.text}`);
        lines.push('');
      }
    }

    // 失敗區段
    if (options.failedChunks && options.failedChunks.length > 0) {
      lines.push('## 未能轉譯的區段');
      lines.push('');
      for (const chunk of options.failedChunks) {
        const startTs = this.formatTimestamp(chunk.start_time);
        const endTs = this.formatTimestamp(chunk.end_time);
        lines.push(`- **[${startTs} - ${endTs}]** ${chunk.error}`);
      }
      lines.push('');
    }

    return lines.join('\r\n');
  }

  /**
   * 格式化時間戳 [HH:MM:SS]
   */
  private formatTimestamp(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [h, m, s].map((v) => v.toString().padStart(2, '0')).join(':');
  }

  /**
   * 產生檔名
   */
  private generateFilename(meetingName: string, date: string): string {
    const safeName = meetingName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
    const safeDate = date.replace(/[\\/:*?"<>|]/g, '-');
    return `${safeDate}_${safeName}.md`;
  }
}
