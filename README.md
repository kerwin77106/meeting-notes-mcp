# meeting-notes-mcp

MCP Server for recording meetings and generating notes in Claude Code.

在 Claude Code 中錄製會議音訊，即時轉譯為逐字稿，並自動生成結構化會議紀錄。

## Features

- **一鍵錄音** -- 在 Claude Code 中直接開始錄製會議音訊（系統音訊 + 麥克風）
- **即時轉譯** -- 每 30 秒自動切片，透過 Groq Whisper API 即時語音轉文字
- **AI 會議紀錄** -- Claude 自動生成重點摘要、決議事項、行動方案
- **多格式輸出** -- 支援 `.md`、`.txt`、`.docx` 三種輸出格式
- **跨平台支援** -- Windows 10+（WASAPI）、macOS 13+（ScreenCaptureKit）

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Claude Code](https://claude.ai/code)（已安裝並登入）
- [Groq API Key](https://console.groq.com)（免費申請）
- FFmpeg（透過 `ffmpeg-static` 自動內建，無需另外安裝）

## Installation

### 一鍵安裝（推薦）

只需一行指令，將 Groq API Key 替換為你自己的：

```bash
claude mcp add meeting-notes -s user -e GROQ_API_KEY=gsk_你的Key -- npx meeting-notes-mcp
```

> **Groq API Key 免費申請**：前往 [https://console.groq.com](https://console.groq.com) 註冊即可取得。

這行指令做了三件事：
1. 從 npm 下載 `meeting-notes-mcp`
2. 註冊為全域 MCP Server（`-s user`，所有專案都能用）
3. 將 Groq API Key 注入 MCP Server 環境變數（`-e`）

安裝完成後，**重啟 Claude Code** 即可使用。

### （可選）安裝 Skill 快捷指令

```bash
npx meeting-notes-mcp --install-skill
```

安裝後可在 Claude Code 中使用 `/meeting` 快捷指令。

### 從 GitHub 原始碼安裝

如果你想自行修改或貢獻程式碼：

```bash
# 1. Clone 並編譯
git clone https://github.com/kerwin77106/meeting-notes-mcp.git
cd meeting-notes-mcp
npm install
npm run build

# 2. 註冊到 Claude Code（將 Groq API Key 替換為你自己的）
claude mcp add meeting-notes -s user -e GROQ_API_KEY=gsk_你的Key -- node /你的路徑/meeting-notes-mcp/dist/index.js
```

## Usage

### Skill 指令（推薦）

安裝 Skill 後，可在 Claude Code 中使用以下快捷指令：

| 指令 | 說明 |
|------|------|
| `/meeting` | 開始會議錄音（互動式輸入會議名稱、參與者、語言） |
| `/meeting stop` | 停止錄音並自動生成結構化會議紀錄 |
| `/meeting status` | 查看即時錄音狀態與最近逐字稿 |
| `/meeting list` | 列出歷史會議紀錄 |

### 基本流程

1. 輸入 `/meeting`，依照提示輸入會議名稱與參與者
2. 開始開會，系統自動錄音並即時轉譯
3. 會議結束後輸入 `/meeting stop`
4. Claude 自動根據逐字稿生成結構化會議紀錄
5. 確認內容後自動存檔

### 會議紀錄格式

生成的會議紀錄包含以下結構：

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

設定檔範例：

```json
{
  "groqApiKey": "gsk_xxxxxxxxxxxx",
  "language": "zh-TW",
  "outputDir": "~/meetings",
  "chunkDurationMs": 30000,
  "maxConcurrentTranscriptions": 3
}
```

## Platform Compatibility

| 平台 | 最低版本 | 音訊擷取方式 |
|------|----------|-------------|
| Windows | 10+ | WASAPI（Windows Audio Session API） |
| macOS | 13+ (Ventura) | ScreenCaptureKit |

> **Note:** Linux 目前尚未支援。

## FAQ

### Q: 需要自己安裝 FFmpeg 嗎？

不需要。本專案透過 `ffmpeg-static` 套件自動內建 FFmpeg，無需額外安裝。

### Q: Groq API Key 如何取得？

前往 [Groq Console](https://console.groq.com) 免費註冊即可取得 API Key。

### Q: 支援哪些語言的語音轉譯？

支援 Whisper 模型所支援的所有語言，包括中文（`zh-TW`）、英文（`en`）、日文（`ja`）等。預設為繁體中文。

### Q: 會議紀錄儲存在哪裡？

預設儲存於 `~/meetings` 目錄，可透過設定檔的 `outputDir` 欄位自訂路徑。

### Q: 錄音時只能錄系統音訊嗎？

系統音訊與麥克風音訊會同時錄製，確保線上與現場的發言都能被完整記錄。

### Q: 每 30 秒切片會影響轉譯品質嗎？

切片間會保留些許重疊以避免斷句問題。若有需要，可調整 `chunkDurationMs` 設定值。

### Q: 可以同時錄製多場會議嗎？

目前僅支援單一 Session 錄製，需先停止當前錄音才能開始新的會議。

## Tech Stack

- **Runtime:** Node.js 20+
- **Language:** TypeScript
- **Protocol:** [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) SDK
- **Audio Processing:** FFmpeg (via ffmpeg-static + fluent-ffmpeg)
- **Speech-to-Text:** Groq Whisper API
- **Document Export:** docx

## License

[MIT](LICENSE)
