import * as fs from 'node:fs';
import * as path from 'node:path';
import { Settings } from '../config/settings.js';
import type { McpToolResponse, RecordingEntry } from '../types.js';

interface ToolContext {
  sessionManager: Record<string, unknown>;
  settings: Settings;
  transcriptionQueue: Record<string, unknown>;
  usageTracker: Record<string, unknown>;
}

const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt', '.docx']);

export const listRecordingsTool = {
  name: 'list_recordings',
  description: '列出所有已儲存的會議紀錄',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },

  handler: async (_args: Record<string, never>, context: ToolContext): Promise<McpToolResponse> => {
    const { settings } = context;

    // 1. 取得 outputDir
    const outputDir = settings.outputDir;

    // 2. 目錄不存在回傳空列表
    if (!fs.existsSync(outputDir)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ recordings: [], total: 0 }) }],
      };
    }

    try {
      // 3. 讀取目錄、篩選 .md/.txt/.docx
      const files = await fs.promises.readdir(outputDir);
      const recordings: RecordingEntry[] = [];

      for (const filename of files) {
        const ext = path.extname(filename).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

        const filePath = path.join(outputDir, filename);

        try {
          // 4. stat 每個檔案
          const stat = await fs.promises.stat(filePath);
          if (!stat.isFile()) continue;

          const format = ext.slice(1) as 'md' | 'txt' | 'docx';

          recordings.push({
            filename,
            path: filePath,
            size_bytes: stat.size,
            created_at: stat.birthtime.toISOString(),
            format,
          });
        } catch {
          // 單一檔案 stat 失敗，跳過
          continue;
        }
      }

      // 5. 按日期降冪排序
      recordings.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      // 6. 回傳列表
      return {
        content: [{ type: 'text', text: JSON.stringify({ recordings, total: recordings.length }) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (message.includes('EACCES') || message.includes('permission')) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'READ_PERMISSION_DENIED', message: `無法讀取目錄 ${outputDir}，請檢查目錄權限` }) }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'READ_PERMISSION_DENIED', message: `讀取目錄失敗：${message}` }) }],
        isError: true,
      };
    }
  },
};
