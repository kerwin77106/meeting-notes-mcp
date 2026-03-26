# meeting-notes-mcp

MCP Server for recording meetings and generating notes in Claude Code.

在 Claude Code 中錄製會議音訊，即時轉譯為逐字稿，並自動生成結構化會議紀錄。

## Features

- **一鍵錄音** -- 在 Claude Code 中直接開始錄製會議音訊（系統音訊 + 麥克風）
- **即時轉譯** -- 每 30 秒自動切片，透過 Groq Whisper API 即時語音轉文字
- **AI 會議紀錄** -- Claude 自動生成重點摘要、決議事項、行動方案
- **多格式輸出** -- 支援 `.md`、`.txt`、`.docx` 三種輸出格式
- **跨平台支援** -- Windows 10+（WASAPI）、macOS 13+（ScreenCaptureKit）
- **靜音偵測** -- 自動跳過靜音片段，避免 Whisper 幻覺

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Claude Code](https://claude.ai/code)（已安裝並登入）
- [Groq API Key](https://console.groq.com)（免費申請）
- FFmpeg（透過 `ffmpeg-static` 自動內建，無需另外安裝）

## Installation

### Step 1：取得 Groq API Key

1. 前往 [https://console.groq.com](https://console.groq.com) 免費註冊
2. 建立 API Key，複製備用（格式像 `gsk_xxxxxxxxxxxx`）

### Step 2：一鍵安裝

將下方指令中的 `gsk_xxxxxxxxxxxx` 替換為你的 Groq API Key，貼上執行：

```bash
claude mcp add meeting-notes -s user -e GROQ_API_KEY=gsk_xxxxxxxxxxxx -- npx meeting-notes-mcp
```

> **⚠️ 注意**：直接把你的 Key 貼上去取代 `gsk_xxxxxxxxxxxx`。不要保留範例的 `gsk_`，否則會變成 `gsk_gsk_...` 導致 Key 無效。

這行指令做了三件事：
1. 從 npm 下載 `meeting-notes-mcp`
2. 註冊為**全域** MCP Server（`-s user`，所有專案都能用）
3. 將 Groq API Key 注入 MCP Server 環境變數（`-e`）

### Step 3：重啟 Claude Code

安裝後需要**重啟 Claude Code** 才會載入新的 MCP Server。

### Step 4（Windows 必要）：啟用 Stereo Mix

要錄製**線上會議中其他人的聲音**（Zoom/Teams/Meet），需要啟用 Windows 的 Stereo Mix：

1. 右鍵點工作列的 🔊 喇叭圖示 → **音效設定**
2. 往下找到 **更多音效設定**（或搜尋「音效」）
3. 切到 **「錄製」** 分頁
4. 在空白處 **右鍵** → 勾選 ✅ **顯示已停用的裝置**
5. 找到 **Stereo Mix**（或「立體聲混音」）→ 右鍵 → **啟用**

> 如果找不到 Stereo Mix，代表你的音效驅動不支援。可安裝免費的 [VB-CABLE](https://vb-audio.com/Cable/) 虛擬音訊裝置作為替代。

> **不啟用 Stereo Mix 也可以用**，只是只能錄到麥克風（你自己的聲音），錄不到電腦播放的聲音（別人的聲音）。

### （可選）安裝 Skill 快捷指令

```bash
npx meeting-notes-mcp --install-skill
```

### 從 GitHub 原始碼安裝

```bash
# 1. Clone 並編譯
git clone https://github.com/kerwin77106/meeting-notes-mcp.git
cd meeting-notes-mcp
npm install
npm run build

# 2. 註冊到 Claude Code（替換 gsk_xxxxxxxxxxxx 為你的 Key）
claude mcp add meeting-notes -s user -e GROQ_API_KEY=gsk_xxxxxxxxxxxx -- node /你的路徑/meeting-notes-mcp/dist/index.js
```

## Usage

### 使用方式

在 Claude Code 中直接用自然語言操作即可：

| 你輸入 | Claude 會做什麼 |
|--------|----------------|
| `幫我開始錄音，會議名稱是「週會」` | 呼叫 `start_recording`，開始錄音 |
| `目前錄音狀態如何？` | 呼叫 `get_transcript`，顯示即時逐字稿 |
| `停止錄音並生成會議紀錄` | 呼叫 `stop_recording` → Claude 生成紀錄 → 呼叫 `save_notes` 存檔 |
| `列出之前的會議紀錄` | 呼叫 `list_recordings`，顯示歷史紀錄 |

### 使用 Skill 快捷指令

如果你安裝了 Skill（`npx meeting-notes-mcp --install-skill`），也可以用：

| 指令 | 說明 |
|------|------|
| `/meeting` | 開始會議錄音（互動式輸入會議名稱、參與者、語言） |

> **注意**：`/meeting stop`、`/meeting status`、`/meeting list` 需要手動輸入完整指令，Claude Code 的自動完成只會顯示 `/meeting`。

### 基本流程

1. 輸入 `/meeting` 或告訴 Claude「開始錄音」
2. 依照提示輸入會議名稱與參與者
3. 開始開會，系統自動錄音並即時轉譯
4. 會議結束後輸入 `/meeting stop` 或告訴 Claude「停止錄音」
5. Claude 自動根據逐字稿生成結構化會議紀錄
6. 確認內容後自動存檔至 `~/meetings/`

### 會議紀錄格式

```
# 會議名稱 -- YYYY-MM-DD
> 參與者 / 時長 / 語言

## 重點摘要
## 決議事項
## 行動方案（含負責人、任務、截止日）
## 逐字稿（含時間戳）
```

## MCP Tools API

本 MCP Server 提供以下 5 個工具，可由 Claude Code 直接呼叫：

| Tool | 說明 |
|------|------|
| `start_recording` | 開始錄音。參數：`meeting_name`（必填）、`participants`（選填）、`language`（選填，預設 `zh-TW`） |
| `stop_recording` | 停止錄音並回傳完整逐字稿 |
| `get_transcript` | 取得目前即時逐字稿與錄音狀態 |
| `save_notes` | 儲存會議紀錄。參數：`content`、`format`（`md` / `txt` / `docx`） |
| `list_recordings` | 列出所有歷史會議紀錄 |

## Configuration

設定檔位置：`~/.meeting-notes-mcp/config.json`

| 欄位 | 預設值 | 說明 |
|------|--------|------|
| `groqApiKey` | `null` | Groq API Key（環境變數 `GROQ_API_KEY` 優先） |
| `language` | `zh-TW` | 預設轉譯語言 |
| `outputDir` | `~/meetings` | 會議紀錄輸出目錄 |
| `chunkDurationMs` | `30000` | 音訊切片時長（毫秒） |
| `maxConcurrentTranscriptions` | `3` | 最大並行轉譯數量 |

## Platform Compatibility

| 平台 | 最低版本 | 音訊擷取方式 | 備注 |
|------|----------|-------------|------|
| Windows | 10+ | WASAPI（dshow） | 需啟用 Stereo Mix 才能錄系統音訊 |
| macOS | 13+ (Ventura) | ScreenCaptureKit | 需授予「螢幕錄製」與「麥克風」權限 |

> **Linux**：PulseAudio 次要支援，不列入 MVP 驗收範圍。

## Troubleshooting

### 錄音時出現「AUDIO_DEVICE_NOT_FOUND」

確認 Windows 音效設定中有啟用的錄音裝置。請參考上方「啟用 Stereo Mix」步驟。

### 轉譯結果出現奇怪的中文字幕內容

這是 Whisper 模型對靜音的「幻覺」。v0.1.2+ 已加入靜音偵測，會自動跳過靜音片段。請確認你使用的是最新版本。

### 出現「GROQ_API_KEY_MISSING」或「Invalid API Key」

確認安裝時正確設定了 API Key。檢查方法：

```bash
# 查看目前設定
claude mcp list
```

如果需要重新設定：

```bash
claude mcp remove meeting-notes -s user
claude mcp add meeting-notes -s user -e GROQ_API_KEY=你的完整Key -- npx meeting-notes-mcp
```

> **常見錯誤**：Key 被存成 `gsk_gsk_...`（重複前綴）。請確認只貼上一次完整的 Key。

### MCP 連線中斷（Connection closed）

重啟 Claude Code 通常可以解決。如果持續發生，嘗試重新安裝 MCP Server。

## FAQ

### Q: 需要自己安裝 FFmpeg 嗎？

不需要。透過 `ffmpeg-static` 自動內建。

### Q: Groq API 免費嗎？

是的，免費額度每天約 8 小時的轉譯時間，一般會議使用綽綽有餘。

### Q: 支援哪些語言？

`zh-TW`（繁中）、`zh-CN`（簡中）、`en`（英文）、`ja`（日文）、`ko`（韓文）。預設繁體中文。

### Q: 可以同時錄製多場會議嗎？

目前僅支援單一 Session，需先停止當前錄音才能開始新的。

### Q: 不啟用 Stereo Mix 可以用嗎？

可以，但只能錄到麥克風（你自己的聲音）。要錄線上會議中別人的聲音，必須啟用 Stereo Mix。

## Tech Stack

- **Runtime:** Node.js 20+
- **Language:** TypeScript
- **Protocol:** [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) SDK
- **Audio:** FFmpeg (via ffmpeg-static + fluent-ffmpeg)
- **STT:** Groq Whisper API (whisper-large-v3-turbo)
- **Export:** docx

## License

[MIT](LICENSE)
