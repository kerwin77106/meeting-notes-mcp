#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { SessionManager } from './session/session-manager.js';
import { Settings } from './config/settings.js';
import { UsageTracker } from './stt/usage-tracker.js';
import { GroqWhisperClient } from './stt/groq-whisper.js';
import { TranscriptionQueue } from './stt/transcription-queue.js';
import { startRecordingTool } from './tools/start-recording.js';
import { stopRecordingTool } from './tools/stop-recording.js';
import { getTranscriptTool } from './tools/get-transcript.js';
import { saveNotesTool } from './tools/save-notes.js';
import { listRecordingsTool } from './tools/list-recordings.js';

// 檢查 CLI 參數
const cliArgs = process.argv.slice(2);
if (cliArgs.includes('--install-skill') || cliArgs.includes('--version') || cliArgs.includes('--help')) {
  // 內嵌處理 CLI 參數
  if (cliArgs.includes('--version')) {
    console.log('meeting-notes-mcp v0.1.0');
  } else if (cliArgs.includes('--help')) {
    console.log('meeting-notes-mcp - MCP Server for meeting recording and notes\n');
    console.log('Usage: meeting-notes-mcp [options]\n');
    console.log('Options:');
    console.log('  --install-skill  Install /meeting skill to ~/.claude/commands/');
    console.log('  --version        Show version');
    console.log('  --help           Show this help');
  } else if (cliArgs.includes('--install-skill')) {
    const skillSrc = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'meeting.md');
    const skillDest = path.join(os.homedir(), '.claude', 'commands', 'meeting.md');
    fs.mkdirSync(path.dirname(skillDest), { recursive: true });
    fs.copyFileSync(skillSrc, skillDest);
    console.log(`Skill installed to ${skillDest}`);
  }
  process.exit(0);
}

// 所有 tool 定義
const tools = [
  startRecordingTool,
  stopRecordingTool,
  getTranscriptTool,
  saveNotesTool,
  listRecordingsTool,
];

// tool handler 對應表
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toolHandlers = new Map<string, (args: any, context: any) => Promise<any>>();
for (const tool of tools) {
  toolHandlers.set(tool.name, tool.handler);
}

async function main(): Promise<void> {
  // 初始化共享模組
  const settings = new Settings();
  await settings.load();

  const configDir = path.join(os.homedir(), '.meeting-notes-mcp');
  const usageTracker = new UsageTracker(configDir);
  await usageTracker.load();

  const sessionManager = new SessionManager();

  // 建立 Groq Whisper Client（API Key 可能為 null，在 start_recording 時才檢查）
  const groqApiKey = settings.groqApiKey ?? '';
  const whisperClient = new GroqWhisperClient(groqApiKey);

  const transcriptionQueue = new TranscriptionQueue(
    {
      maxConcurrent: settings.maxConcurrentTranscriptions,
      retryAttempts: 3,
      retryDelayMs: 1000,
      timeoutMs: 30000,
    },
    whisperClient,
    usageTracker,
  );

  // 註冊轉譯完成回呼
  transcriptionQueue.onTranscriptionComplete((sessionId, chunkIndex, result) => {
    sessionManager.updateChunkResult(sessionId, chunkIndex, result);
  });

  transcriptionQueue.onTranscriptionFailed((sessionId, chunkIndex, error) => {
    sessionManager.markChunkFailed(sessionId, chunkIndex, error.message);
  });

  // 共享 context
  const context = { sessionManager, settings, transcriptionQueue, usageTracker };

  // 建立 MCP Server
  const server = new Server(
    {
      name: 'meeting-notes-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // 註冊 ListToolsRequest handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  });

  // 註冊 CallToolRequest handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const toolArgs = (request.params.arguments ?? {}) as Record<string, unknown>;

    const handler = toolHandlers.get(toolName);
    if (!handler) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'VALIDATION_ERROR', message: `未知的工具：${toolName}` }) }],
        isError: true,
      };
    }

    try {
      return await handler(toolArgs, context);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'INTERNAL_ERROR', message }) }],
        isError: true,
      };
    }
  });

  // 啟動時清理殘留暫存
  try {
    const tmpDir = path.join(os.homedir(), '.meeting-notes-mcp', 'tmp');
    if (fs.existsSync(tmpDir)) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  } catch {
    // 清理失敗不影響啟動
  }

  // 啟動 stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('[meeting-notes-mcp] Fatal error:', err);
  process.exit(1);
});
