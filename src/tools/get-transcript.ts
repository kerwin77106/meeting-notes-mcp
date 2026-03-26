import { SessionManager } from '../session/session-manager.js';
import { UsageTracker } from '../stt/usage-tracker.js';
import type { McpToolResponse } from '../types.js';
import { SESSION_ID_PATTERN } from '../types.js';

interface GetTranscriptArgs {
  session_id?: string;
}

interface ToolContext {
  sessionManager: SessionManager;
  settings: Record<string, unknown>;
  transcriptionQueue: Record<string, unknown>;
  usageTracker: UsageTracker;
}

export const getTranscriptTool = {
  name: 'get_transcript',
  description: '取得指定 session 的即時逐字稿與統計資訊',
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

  handler: async (args: GetTranscriptArgs, context: ToolContext): Promise<McpToolResponse> => {
    const { sessionManager, usageTracker } = context;

    // 1. 驗證 session_id
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

    // 3. 取得 transcript + chunkStats
    const transcript = sessionManager.getTranscript(sessionId);
    const chunkStats = sessionManager.getChunkStats(sessionId);

    // 4. 計算時長
    let durationSeconds = 0;
    if (session.status === 'RECORDING') {
      durationSeconds = Math.round((Date.now() - session.startedAt.getTime()) / 1000);
    } else if (transcript.length > 0) {
      const lastEnd = transcript[transcript.length - 1]!.end;
      durationSeconds = Math.round(lastEnd);
    }

    // 5. 檢查 usage warning（80%）
    const usagePercent = usageTracker.getUsagePercent();

    const result: Record<string, unknown> = {
      session_id: sessionId,
      status: session.status.toLowerCase(),
      duration_seconds: durationSeconds,
      completed_chunks: chunkStats.completed,
      pending_chunks: chunkStats.pending + chunkStats.processing,
      transcript,
    };

    if (usagePercent >= 80) {
      result.usage_warning = `Groq API 免費額度已使用 ${Math.round(usagePercent)}%，請注意剩餘用量`;
    }

    // 6. 回傳
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  },
};
