import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionManager } from '../session/session-manager.js';
import { Settings } from '../config/settings.js';
import { MarkdownExporter } from '../export/markdown.js';
import { TextExporter } from '../export/text.js';
import type { McpToolResponse } from '../types.js';
import { SESSION_ID_PATTERN } from '../types.js';

interface SaveNotesArgs {
  session_id?: string;
  content?: string;
  format?: 'md' | 'txt' | 'docx';
  output_path?: string;
}

interface ToolContext {
  sessionManager: SessionManager;
  settings: Settings;
  transcriptionQueue: Record<string, unknown>;
  usageTracker: Record<string, unknown>;
}

const SUPPORTED_FORMATS = ['md', 'txt', 'docx'];

export const saveNotesTool = {
  name: 'save_notes',
  description: '將會議紀錄儲存為指定格式的檔案',
  inputSchema: {
    type: 'object' as const,
    properties: {
      session_id: {
        type: 'string',
        description: 'Session ID（格式：mtg-YYYYMMDDHHmmss-xxxx）',
      },
      content: {
        type: 'string',
        description: '會議紀錄內容（Markdown 格式）',
      },
      format: {
        type: 'string',
        enum: ['md', 'txt', 'docx'],
        description: '輸出格式（預設 md）',
      },
      output_path: {
        type: 'string',
        description: '自訂輸出路徑（選填）',
      },
    },
    required: ['session_id', 'content'],
  },

  handler: async (args: SaveNotesArgs, context: ToolContext): Promise<McpToolResponse> => {
    const { sessionManager, settings } = context;

    // 1. 驗證 session_id
    const sessionId = args.session_id;
    if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'VALIDATION_ERROR', message: 'session_id 格式不正確，應為 mtg-YYYYMMDDHHmmss-xxxx' }) }],
        isError: true,
      };
    }

    // 驗證 content 非空
    const content = args.content;
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'VALIDATION_ERROR', message: '會議紀錄內容不可為空' }) }],
        isError: true,
      };
    }

    // 驗證 format
    const format = args.format ?? 'md';
    if (!SUPPORTED_FORMATS.includes(format)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'VALIDATION_ERROR', message: `不支援的格式：${args.format}，支援的格式：${SUPPORTED_FORMATS.join(', ')}` }) }],
        isError: true,
      };
    }

    // 2. 取得 session metadata
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'SESSION_NOT_FOUND', message: `找不到 session：${sessionId}` }) }],
        isError: true,
      };
    }

    // 3. 決定輸出路徑
    let outputPath: string;
    if (args.output_path) {
      // 展開 ~
      outputPath = args.output_path.startsWith('~')
        ? path.join(os.homedir(), args.output_path.slice(1))
        : args.output_path;
    } else {
      const outputDir = settings.outputDir;
      const date = session.startedAt.toISOString().slice(0, 10);
      const safeName = session.meetingName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
      const filename = `${date}-${safeName}.${format}`;
      outputPath = path.join(outputDir, filename);
    }

    // 3.5 路徑穿越防護
    const resolved = path.resolve(outputPath);
    const allowedBase = path.resolve(settings.outputDir);
    const homeDir = path.resolve(os.homedir());
    if (!resolved.startsWith(allowedBase) && !resolved.startsWith(homeDir)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'VALIDATION_ERROR', message: '輸出路徑必須位於允許的目錄內' }) }],
        isError: true,
      };
    }

    // 4. 確保目錄存在
    const dir = path.dirname(outputPath);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('EACCES') || message.includes('permission')) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'WRITE_PERMISSION_DENIED', message: `無法建立目錄 ${dir}，請檢查目錄權限` }) }],
          isError: true,
        };
      }
      throw err;
    }

    try {
      // 5. 根據 format 呼叫對應 Exporter
      if (format === 'md') {
        await fs.promises.writeFile(outputPath, content, { encoding: 'utf-8' });
      } else if (format === 'txt') {
        const textExporter = new TextExporter();
        const textContent = textExporter.convertToText(content);
        await fs.promises.writeFile(outputPath, textContent, { encoding: 'utf-8' });
      } else if (format === 'docx') {
        try {
          // 動態載入 DocxExporter 以避免在未安裝 docx 套件時報錯
          const { DocxExporter } = await import('../export/docx.js');
          const date = session.startedAt.toISOString().slice(0, 10);
          const durationMs = session.completedAt
            ? session.completedAt.getTime() - session.startedAt.getTime()
            : Date.now() - session.startedAt.getTime();
          const durationMinutes = Math.round(durationMs / 60000);
          const metadata = {
            meetingName: session.meetingName,
            participants: session.participants,
            duration: `${durationMinutes} 分鐘`,
            language: session.language,
            date,
          };
          const exporter = new DocxExporter();
          await exporter.export({
            metadata,
            transcript: session.transcript,
            outputDir: path.dirname(outputPath),
            filename: path.basename(outputPath),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'DOCX_GENERATION_FAILED', message: `Word 文件生成失敗：${message}。建議改用 .md 格式` }) }],
            isError: true,
          };
        }
      }

      // 6. 取得 file size
      const stat = await fs.promises.stat(outputPath);

      // 7. 回傳
      return {
        content: [{ type: 'text', text: JSON.stringify({
          saved: true,
          path: outputPath,
          size_bytes: stat.size,
          format,
        }) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (message.includes('EACCES') || message.includes('permission')) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'WRITE_PERMISSION_DENIED', message: `無法寫入檔案 ${outputPath}，請檢查目錄權限` }) }],
          isError: true,
        };
      }

      if (message.includes('ENOSPC') || message.includes('no space')) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'DISK_FULL', message: '磁碟空間不足，無法儲存檔案' }) }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'WRITE_PERMISSION_DENIED', message: `儲存失敗：${message}` }) }],
        isError: true,
      };
    }
  },
};
