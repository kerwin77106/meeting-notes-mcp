# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build       # TypeScript 編譯（tsc → dist/）
npm run dev         # 開發模式，tsx watch 即時重載
npm test            # 執行 Vitest 測試
npm test -- --run   # 單次執行（不 watch）
```

編譯輸出在 `dist/`，MCP Server 入口為 `dist/index.js`。

### 發布新版本到 npm

```powershell
npm version patch   # 或 minor / major，自動更新 package.json 並建立 git tag
git push origin main --tags   # push 後 GitHub Actions 自動發布到 npm
```

觸發條件：push `v*` 格式的 tag（`.github/workflows/publish.yml`）。

## Architecture

### 整體資料流

```
音訊裝置 → Recorder → PCM Stream → Chunker → MP3 chunks → TranscriptionQueue → DeepgramClient
                                                                ↓
                                                         SessionManager（存逐字稿）
```

### 核心模組

**`src/index.ts`** — MCP Server 入口。初始化所有共享模組（Settings、UsageTracker、SessionManager、DeepgramClient、TranscriptionQueue），組成 `context` 物件傳給每個 tool handler。

**`src/session/session-manager.ts`** — 純記憶體的 Session 狀態機。管理 Session 生命週期（RECORDING → STOPPING → COMPLETED/ERROR），以及 ChunkRecord 的狀態追蹤與逐字稿去重合併（`deduplicateSegments`）。

**`src/audio/chunker.ts`** — 接收 PCM 串流，每 30 秒切一個 chunk（含 1 秒頭尾重疊），靜音偵測（RMS < 1 跳過），再用內建 ffmpeg-static 轉為 MP3 後觸發回呼。音訊規格固定：16kHz / 16-bit / mono。

**`src/stt/transcription-queue.ts`** — 最多 3 路並行的 STT 佇列，支援指數退避重試（retryable 錯誤）。完成後透過 callback 通知 SessionManager，並支援 `waitForAll` 等待整個 Session 的 chunks 都完成。

**`src/stt/deepgram-client.ts`** — 呼叫 Deepgram Nova-2 REST API，以 word-level 時間戳組裝 segments，支援 zh-TW / zh-CN / en / ja / ko。

### 平台分支（錄音器）

`start_recording` tool 依平台選擇錄音器：

- **Windows** (`process.platform === 'win32'`)：`NaudiodonRecorder`
  - 系統音訊：優先嘗試 `tools/wasapi-loopback.py`（Python + soundcard，WASAPI Loopback，支援藍芽耳機），失敗則 fallback 到 naudiodon PortAudio WDM-KS loopback
  - 麥克風：naudiodon（WASAPI input）
  - 混音：`Resampler.mix()`，緩衝區對齊後逐 sample 平均

- **macOS / Linux**：`FFmpegRecorder`（`src/audio/ffmpeg-recorder.ts`），透過 ffmpeg-static 錄製

兩者輸出均為 16kHz mono int16 PCM stream，接回同一個 Chunker。

### Tool Handler 結構

每個 tool 是獨立的 `export const xxxTool` 物件，包含 `name`、`description`、`inputSchema`、`handler(args, context)`。`context` 型別包含 `sessionManager`、`settings`、`transcriptionQueue`、`usageTracker`。

### 設定優先順序

環境變數 `DEEPGRAM_API_KEY` > `~/.meeting-notes-mcp/config.json` > 預設值。設定檔寫入時權限為 `0o600`。

### 輸出格式

會議紀錄存至 `~/meeting-notes/`，支援 `.md`（`src/export/markdown.ts`）、`.txt`（`src/export/text.ts`）、`.docx`（`src/export/docx.ts`）。

## 重要細節

- `naudiodon` 為 `optionalDependencies`，Linux CI 用 `--ignore-optional` 跳過編譯
- `tools/wasapi-loopback.py` 輸出已是 16kHz mono int16，不需 Resampler 處理
- Session ID 格式：`mtg-YYYYMMDDHHmmss-xxxx`（hex）
- 逐字稿去重以句子為單位比對（`splitSentences` + `isSimilar`），時間重疊才觸發比對
- Chunker RMS 閾值刻意設很低（< 1），Deepgram 本身不幻覺，不需嚴格過濾靜音
- `skills/meeting.md` 可透過 `node dist/index.js --install-skill` 安裝到 `~/.claude/commands/`
- 待辦事項見 `BACKLOG.md`
