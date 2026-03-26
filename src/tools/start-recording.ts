import { SessionManager } from '../session/session-manager.js';
import { Settings } from '../config/settings.js';
import { DeviceDetector } from '../audio/device-detector.js';
import { FFmpegRecorder } from '../audio/ffmpeg-recorder.js';
import { Chunker } from '../audio/chunker.js';
import { TranscriptionQueue } from '../stt/transcription-queue.js';
import type { McpToolResponse, SupportedLanguage } from '../types.js';
import { SUPPORTED_LANGUAGES, INVALID_FILENAME_CHARS } from '../types.js';

interface StartRecordingArgs {
  meeting_name?: string;
  participants?: string[];
  language?: SupportedLanguage;
}

interface ToolContext {
  sessionManager: SessionManager;
  settings: Settings;
  transcriptionQueue: TranscriptionQueue;
  usageTracker: { getUsagePercent(): number; isWarning(): boolean };
}

export const startRecordingTool = {
  name: 'start_recording',
  description: '開始錄製系統音訊與麥克風，即時轉譯為逐字稿',
  inputSchema: {
    type: 'object' as const,
    properties: {
      meeting_name: {
        type: 'string',
        description: '會議名稱（必填，1-100 字元，不含特殊字元 \\ / : * ? " < > |）',
      },
      participants: {
        type: 'array',
        items: { type: 'string' },
        description: '參與者名單（選填）',
      },
      language: {
        type: 'string',
        enum: ['zh-TW', 'zh-CN', 'en', 'ja', 'ko'],
        description: '會議語言（選填，預設 zh-TW）',
      },
    },
    required: ['meeting_name'],
  },

  handler: async (args: StartRecordingArgs, context: ToolContext): Promise<McpToolResponse> => {
    const { sessionManager, settings, transcriptionQueue } = context;

    // 1. 驗證 meeting_name
    const meetingName = args.meeting_name;
    if (!meetingName || typeof meetingName !== 'string' || meetingName.trim().length === 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'VALIDATION_ERROR', message: '會議名稱為必填欄位' }) }],
        isError: true,
      };
    }
    if (meetingName.length > 100) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'VALIDATION_ERROR', message: '會議名稱長度不可超過 100 字元' }) }],
        isError: true,
      };
    }
    if (INVALID_FILENAME_CHARS.test(meetingName)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'VALIDATION_ERROR', message: '會議名稱不可包含特殊字元 \\ / : * ? " < > |' }) }],
        isError: true,
      };
    }

    // 驗證 participants
    if (args.participants !== undefined) {
      if (!Array.isArray(args.participants) || args.participants.length === 0) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'VALIDATION_ERROR', message: '參與者須為非空陣列' }) }],
          isError: true,
        };
      }
      for (const p of args.participants) {
        if (typeof p !== 'string' || p.trim().length === 0) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'VALIDATION_ERROR', message: '參與者名稱不可為空字串' }) }],
            isError: true,
          };
        }
      }
    }

    // 驗證 language
    const language: SupportedLanguage = args.language ?? settings.language;
    if (!SUPPORTED_LANGUAGES.includes(language)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'VALIDATION_ERROR', message: `不支援的語言：${args.language}，支援的語言：${SUPPORTED_LANGUAGES.join(', ')}` }) }],
        isError: true,
      };
    }

    // 2. 檢查 active session
    const activeSession = sessionManager.getActiveSession();
    if (activeSession) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'ALREADY_RECORDING', message: `已有進行中的錄音 session：${activeSession.sessionId}，請先呼叫 stop_recording 結束錄音` }) }],
        isError: true,
      };
    }

    // 3. 檢查 Groq API Key
    const groqApiKey = settings.groqApiKey;
    if (!groqApiKey) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'GROQ_API_KEY_MISSING', message: '未設定 Groq API Key。請設定環境變數 GROQ_API_KEY 或在 ~/.meeting-notes-mcp/config.json 中設定' }) }],
        isError: true,
      };
    }

    // 4. 產生 session_id 並建立 Session
    const participants = args.participants ?? [];

    // 5. 建立 Session
    const session = sessionManager.createSession(meetingName.trim(), participants, language);

    try {
      // 6. 偵測音訊裝置
      const devices = await DeviceDetector.detectDevices();
      const systemDevice = devices.find((d) => d.type === 'system');
      const micDevice = devices.find((d) => d.type === 'microphone');

      if (!systemDevice && !micDevice) {
        sessionManager.updateStatus(session.sessionId, 'ERROR');
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'AUDIO_DEVICE_NOT_FOUND', message: '偵測不到任何音訊裝置，請檢查系統音訊設定' }) }],
          isError: true,
        };
      }

      // 7. 啟動 FFmpegRecorder（降級模式）
      const recorder = new FFmpegRecorder({
        platform: process.platform,
        systemDevice: systemDevice?.name,
        microphoneDevice: micDevice?.name,
      });

      let pcmStream: NodeJS.ReadableStream;
      let warning: string | undefined;

      if (systemDevice && micDevice) {
        // 混合錄音
        pcmStream = await recorder.startMixed();
      } else if (systemDevice) {
        // 僅系統音訊
        pcmStream = await recorder.startSystemAudio();
        warning = '未偵測到麥克風裝置，僅錄製系統音訊';
      } else {
        // 僅麥克風
        pcmStream = await recorder.startMicrophone();
        warning = '未偵測到系統音訊裝置，僅錄製麥克風';
      }

      // 保存 recorder 引用至 session
      session.recorder = recorder;

      // 8. 啟動 Chunker
      const chunker = new Chunker({
        chunkDurationMs: settings.chunkDurationMs,
        overlapMs: 1000,
        maxChunkSizeBytes: 25 * 1024 * 1024,
        outputFormat: 'mp3',
      });
      chunker.start(pcmStream);

      // 保存 chunker 引用至 session
      session.chunker = chunker;

      // 9. 註冊 chunk 回呼 → TranscriptionQueue.enqueue
      chunker.onChunk((chunk) => {
        sessionManager.addChunk(session.sessionId, {
          index: chunk.index,
          startTimeMs: chunk.startTimeMs,
          endTimeMs: chunk.endTimeMs,
          status: 'pending',
        });
        transcriptionQueue.enqueue(session.sessionId, chunk, language);
      });

      // 10. 回傳 McpToolResponse
      const result: Record<string, unknown> = {
        session_id: session.sessionId,
        status: 'recording',
        meeting_name: meetingName.trim(),
        language,
        started_at: session.startedAt.toISOString(),
      };

      if (warning) {
        result.warning = warning;
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    } catch (err) {
      sessionManager.updateStatus(session.sessionId, 'ERROR');
      const message = err instanceof Error ? err.message : String(err);

      // 判斷平台不支援
      if (message.includes('Unsupported platform')) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'UNSUPPORTED_PLATFORM', message: `不支援的作業系統：${process.platform}` }) }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'AUDIO_DEVICE_NOT_FOUND', message: `啟動錄音失敗：${message}` }) }],
        isError: true,
      };
    }
  },
};
