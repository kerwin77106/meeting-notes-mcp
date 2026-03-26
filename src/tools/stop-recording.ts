import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionManager } from '../session/session-manager.js';
import { TranscriptionQueue } from '../stt/transcription-queue.js';
import { UsageTracker } from '../stt/usage-tracker.js';
import type { McpToolResponse, FailedChunk } from '../types.js';
import { SESSION_ID_PATTERN } from '../types.js';

interface StopRecordingArgs {
  session_id?: string;
}

interface ToolContext {
  sessionManager: SessionManager;
  settings: { outputDir: string };
  transcriptionQueue: TranscriptionQueue;
  usageTracker: UsageTracker;
}

export const stopRecordingTool = {
  name: 'stop_recording',
  description: '停止錄音並取得完整逐字稿',
  inputSchema: {
    type: 'object' as const,
    properties: {
      session_id: {
        type: 'string',
        description: 'Session ID（格式：mtg-YYYYMMDDHHmmss-xxxx）',
      },
    },
    required: ['session_id'],
  },

  handler: async (args: StopRecordingArgs, context: ToolContext): Promise<McpToolResponse> => {
    const { sessionManager, transcriptionQueue, usageTracker } = context;

    // 1. 驗證 session_id 格式
    const sessionId = args.session_id;
    if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'VALIDATION_ERROR', message: 'session_id 格式不正確，應為 mtg-YYYYMMDDHHmmss-xxxx' }) }],
        isError: true,
      };
    }

    // 2. 查找 session
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'SESSION_NOT_FOUND', message: `找不到 session：${sessionId}` }) }],
        isError: true,
      };
    }

    // 3. 檢查狀態
    if (session.status !== 'RECORDING') {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'SESSION_NOT_RECORDING', message: `Session 目前狀態為 ${session.status}，無法停止錄音` }) }],
        isError: true,
      };
    }

    // 4. 更新狀態 STOPPING
    sessionManager.updateStatus(sessionId, 'STOPPING');

    try {
      // 5. recorder.stop()
      if (session.recorder) {
        await session.recorder.stop();
      }

      // 6. chunker.flush()
      if (session.chunker) {
        await session.chunker.flush();
      }

      // 7. transcriptionQueue.waitForAll
      try {
        await transcriptionQueue.waitForAll(sessionId, 300000);
      } catch (err) {
        // 超時但繼續處理已完成的部分
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('timeout') || message.includes('Timeout')) {
          // 繼續處理，下方會檢查失敗 chunks
        } else {
          throw err;
        }
      }

      // 8. 合併逐字稿
      const transcript = sessionManager.getTranscript(sessionId);

      // 9. 計算時長
      let durationSeconds = 0;
      if (transcript.length > 0) {
        const firstStart = transcript[0]!.start;
        const lastEnd = transcript[transcript.length - 1]!.end;
        durationSeconds = Math.round(lastEnd - firstStart);
      } else if (session.startedAt) {
        durationSeconds = Math.round((Date.now() - session.startedAt.getTime()) / 1000);
      }

      // 取得 chunk 統計
      const chunkStats = sessionManager.getChunkStats(sessionId);

      // 收集失敗 chunks
      const failedChunks: FailedChunk[] = session.chunks
        .filter((c) => c.status === 'failed')
        .map((c) => ({
          chunk_index: c.index,
          start_time: c.startTimeMs / 1000,
          end_time: c.endTimeMs / 1000,
          error: c.error ?? '未知錯誤',
        }));

      // 10. 更新狀態 COMPLETED
      sessionManager.updateStatus(sessionId, failedChunks.length > 0 && transcript.length === 0 ? 'ERROR' : 'COMPLETED');

      // 清理暫存檔案
      try {
        const tmpDir = path.join(os.homedir(), '.meeting-notes-mcp', 'tmp', sessionId);
        if (fs.existsSync(tmpDir)) {
          await fs.promises.rm(tmpDir, { recursive: true, force: true });
        }
      } catch {
        // 清理失敗不影響主流程
      }

      // 11. 檢查 usage warning
      const usagePercent = usageTracker.getUsagePercent();

      const result: Record<string, unknown> = {
        session_id: sessionId,
        status: 'completed',
        duration_seconds: durationSeconds,
        total_chunks: chunkStats.total,
        transcript,
      };

      if (usagePercent >= 100) {
        result.usage_warning = `Groq API 免費額度已達 ${Math.round(usagePercent)}%，可能無法繼續使用轉譯功能`;
      }

      if (failedChunks.length > 0) {
        result.failed_chunks = failedChunks;
      }

      // 12. 回傳完整逐字稿
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    } catch (err) {
      sessionManager.updateStatus(sessionId, 'ERROR');
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'TRANSCRIPTION_TIMEOUT', message: `停止錄音過程中發生錯誤：${message}` }) }],
        isError: true,
      };
    }
  },
};
