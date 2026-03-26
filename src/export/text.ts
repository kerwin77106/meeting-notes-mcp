import * as fs from 'node:fs';
import * as path from 'node:path';

export interface TextExportOptions {
  markdownContent: string;
  outputDir: string;
  filename: string;
}

/**
 * TextExporter：將 Markdown 內容轉換為純文字格式。
 *
 * 轉換規則：
 * - # 標題 → 全大寫 + 底線
 * - | 表格 → tab 分隔
 * - 移除 > 引用符號和 ** 粗體標記
 * - - 清單項目 → 數字序號
 */
export class TextExporter {
  /**
   * 匯出純文字檔案，回傳檔案完整路徑。
   */
  async export(options: TextExportOptions): Promise<string> {
    const content = this.convertToText(options.markdownContent);
    const filePath = path.join(options.outputDir, options.filename);

    // 確保輸出目錄存在
    if (!fs.existsSync(options.outputDir)) {
      await fs.promises.mkdir(options.outputDir, { recursive: true });
    }

    await fs.promises.writeFile(filePath, content, { encoding: 'utf-8' });
    return filePath;
  }

  /**
   * 將 Markdown 轉換為純文字
   */
  convertToText(markdown: string): string {
    const lines = markdown.split(/\r?\n/);
    const result: string[] = [];
    let listCounter = 0;
    let inTable = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // 標題：# → 全大寫 + 底線
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const text = this.removeBold(headingMatch[2]!).toUpperCase();
        result.push(text);
        result.push('='.repeat(text.length));
        result.push('');
        listCounter = 0;
        inTable = false;
        continue;
      }

      // 表格行
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        // 跳過分隔線（如 | --- | --- |）
        if (/^\|[\s-|]+\|$/.test(trimmed)) {
          inTable = true;
          continue;
        }
        inTable = true;
        const cells = trimmed
          .split('|')
          .filter((c) => c.trim().length > 0)
          .map((c) => this.removeBold(c.trim()));
        result.push(cells.join('\t'));
        continue;
      }

      if (inTable && trimmed === '') {
        inTable = false;
      }

      // 清單項目：- → 數字序號
      const listMatch = trimmed.match(/^-\s+(.+)$/);
      if (listMatch) {
        listCounter++;
        const text = this.removeBold(listMatch[1]!);
        result.push(`${listCounter}. ${text}`);
        continue;
      }

      // 非清單行，重設計數器
      if (!trimmed.startsWith('-')) {
        listCounter = 0;
      }

      // 引用：移除 > 符號
      const quoteMatch = trimmed.match(/^>\s*(.*)$/);
      if (quoteMatch) {
        result.push(this.removeBold(quoteMatch[1]!));
        continue;
      }

      // 一般行：移除 ** 粗體標記
      result.push(this.removeBold(trimmed));
    }

    return result.join('\r\n');
  }

  /**
   * 移除 ** 粗體標記
   */
  private removeBold(text: string): string {
    return text.replace(/\*\*([^*]*)\*\*/g, '$1');
  }
}
