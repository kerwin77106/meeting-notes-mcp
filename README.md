# meeting-notes-mcp

MCP Server for recording meetings and generating notes in Claude Code.

在 Claude Code 中錄製會議音訊，即時轉譯為逐字稿，並自動生成結構化會議紀錄。

## Features

- **一鍵錄音** — 在 Claude Code 中直接開始錄製會議音訊（系統音訊 + 麥克風）
- **藍芽耳機相容** — 支援藍芽耳機的系統音訊捕捉與麥克風錄音（Windows）
- **即時轉譯** — 每 30 秒自動切片，透過 Deepgram Nova-2 API 即時語音轉文字
- **繁體中文優先** — 原生支援 zh-TW，輸出正體中文而非簡體
- **AI 會議紀錄** — Claude 自動生成重點摘要、決議事項、行動方案
- **多格式輸出** — 支援 `.md`、`.txt`、`.docx` 三種輸出格式
- **跨平台支援** — Windows 10+（PortAudio WDM-KS loopback）、macOS 13+

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Claude Code](https://claude.ai/code)（已安裝並登入）
- [Deepgram API Key](https://console.deepgram.com)（免費申請，送 $200 credit）
- **Windows 使用者額外需要：** Python 3.x + `soundcard`、`numpy` 套件（用於藍芽系統音訊捕捉）

## Installation

### Step 1：取得 Deepgram API Key

1. 前往 [https://console.deepgram.com](https://console.deepgram.com) 免費註冊
2. 建立 API Key，複製備用（格式像 `1de40672c160484c...`）
3. 新帳號自動獲得 **$200 美金免費額度**（約可錄音 775+ 小時）

### Step 2（Windows）：安裝 Python 音訊套件

Windows 上的系統音訊捕捉（含藍芽耳機）需要 Python 套件：

```bash
# 確認已安裝 Python 3.x
python --version

# 安裝音訊套件（注意：numpy 需 < 2.0）
pip install soundcard "numpy<2.0"
```

> 若尚未安裝 Python，請至 [https://www.python.org/downloads/](https://www.python.org/downloads/) 下載安裝。

### Step 3：從 GitHub 原始碼安裝（目前版本）

```bash
# 1. Clone 並編譯
git clone https://github.com/kerwin77106/meeting-notes-mcp.git
cd meeting-notes-mcp
npm install
npm run build

# 2. 註冊到 Claude Code（將路徑替換為你的實際路徑）
claude mcp add meeting-notes -s user -e DEEPGRAM_API_KEY=你的_DEEPGRAM_API_KEY -- node /你的路徑/meeting-notes-mcp/dist/index.js
```

### Step 4：重啟 Claude Code

安裝後需要**重啟 Claude Code** 才會載入新的 MCP Server。

### Step 5（選用）：安裝 Skill 快捷指令

```bash
node dist/index.js --install-skill
```

安裝後可使用 `/meeting` 指令快速操作。

---

### 透過 npm 安裝（穩定版）

```bash
claude mcp add meeting-notes -s user -e DEEPGRAM_API_KEY=你的_DEEPGRAM_API_KEY -- npx meeting-notes-mcp
```

## Usage

### 使用方式

在 Claude Code 中直接用自然語言操作即可：

| 你輸入 | Claude 會做什麼 |
|--------|----------------|
| `幫我開始錄音，會議名稱是「週會」` | 呼叫 `start_recording`，開始錄音 |
| `目前錄音狀態如何？` | 呼叫 `get_transcript`，顯示即時逐字稿 |
| `停止錄音並生成會議紀錄` | 呼叫 `stop_recording` → Claude 生成紀錄 → `save_notes` 存檔 |
| `列出之前的會議紀錄` | 呼叫 `list_recordings`，顯示歷史紀錄 |

### 使用 Skill 快捷指令

如果你安裝了 Skill（`npx meeting-notes-mcp --install-skill`），可以使用：

| 指令 | 說明 |
|------|------|
| `/meeting` | 開始會議錄音（互動式輸入會議名稱、參與者、語言） |
| `/meeting stop` | 停止錄音並生成會議紀錄 |
| `/meeting status` | 查看即時逐字稿 |
| `/meeting list` | 列出歷史紀錄 |

### 基本流程

1. 輸入 `/meeting` 或告訴 Claude「開始錄音」
2. 依照提示輸入會議名稱與參與者
3. 開始開會，系統自動錄音並即時轉譯
4. 會議結束後輸入 `/meeting stop` 或告訴 Claude「停止錄音」
5. Claude 自動根據逐字稿生成結構化會議紀錄
6. 確認內容後自動存檔至 `~/meeting-notes/`

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
| `deepgramApiKey` | `null` | Deepgram API Key（環境變數 `DEEPGRAM_API_KEY` 優先） |
| `language` | `zh-TW` | 預設轉譯語言 |
| `outputDir` | `~/meeting-notes` | 會議紀錄輸出目錄 |
| `chunkDurationMs` | `30000` | 音訊切片時長（毫秒） |
| `maxConcurrentTranscriptions` | `3` | 最大並行轉譯數量 |

## Platform Compatibility

| 平台 | 最低版本 | 系統音訊擷取方式 | 藍芽耳機相容 |
|------|----------|----------------|------------|
| Windows | 10+ | Python WASAPI Loopback + naudiodon | ✅ 完整支援 |
| macOS | 13+ | ScreenCaptureKit（FFmpeg） | 需安裝 BlackHole |

> **Linux**：次要支援，使用 PulseAudio。

### Windows 音訊擷取原理

v0.4.0 起 Windows 改用 **Python WASAPI Loopback** 錄製系統音訊：

- **完整藍芽支援**：透過 Windows Core Audio API `AUDCLNT_STREAMFLAGS_LOOPBACK`，可鏡像捕捉任何輸出裝置（喇叭、藍芽耳機、HDMI）的音訊
- **不影響播放**：WASAPI shared loopback 模式，捕捉音訊的同時正常播放不受影響
- **自動跟隨**：自動偵測當前預設輸出裝置，切換耳機後重新開始錄音即可
- **麥克風**：藍芽耳機麥克風透過 naudiodon（WASAPI input）自動偵測

#### 為什麼需要 Python？

PortAudio（naudiodon）使用 WDM-KS exclusive 模式，當系統正在播放音訊給藍芽耳機時，裝置已被佔用，PortAudio 無法進入。Windows 的 WASAPI Loopback 使用 shared 模式解決了這個問題，Python 的 `soundcard` 套件直接封裝了這個 Windows API。

## Troubleshooting

### 錄音時出現「AUDIO_DEVICE_NOT_FOUND」

Windows：請確認系統中有可用的音訊裝置（喇叭或麥克風）。
macOS：請確認已授予「麥克風」和「螢幕錄製」權限。

### 轉譯結果為空或無內容

確認 Deepgram API Key 正確設定，且錄音時有音訊輸入（對著麥克風說話或播放聲音）。

### 出現「DEEPGRAM_API_KEY_MISSING」

確認安裝時正確設定了 API Key：

```bash
# 查看目前設定
claude mcp list

# 重新設定
claude mcp remove meeting-notes -s user
claude mcp add meeting-notes -s user -e DEEPGRAM_API_KEY=你的完整Key -- npx meeting-notes-mcp
```

### MCP 連線中斷（Connection closed）

重啟 Claude Code 通常可以解決。如果持續發生，嘗試重新安裝 MCP Server。

### 藍芽耳機切換後沒有收到音訊

重新開始一次錄音（`/meeting` 重新呼叫），系統會在 `start_recording` 時重新偵測當前輸出裝置。

### Windows：系統音訊錄不到（Python 相關錯誤）

確認已安裝 Python 套件：

```bash
pip install soundcard "numpy<2.0"
```

注意：`numpy 2.x` 與 `soundcard 0.4.5` 不相容，必須使用 `numpy<2.0`。

## FAQ

### Q: 需要自己安裝 FFmpeg 嗎？

Windows 上的錄音已改用 PortAudio（naudiodon），不再依賴 FFmpeg 錄音。FFmpeg 仍用於音訊格式轉換（自動內建）。

### Q: Deepgram 免費嗎？

是的，新帳號送 **$200 美金免費額度**，以 Nova-2 費率計算約可錄音 **775 小時以上**，一般公司會議使用可以用很久。用完後有永久免費層級（每月數千分鐘）。

### Q: 為什麼從 Groq Whisper 換到 Deepgram？

Whisper 在靜音時有「幻覺」問題（會憑空產生文字），Deepgram Nova-2 架構不會幻覺，且原生支援 zh-TW 繁體中文輸出。

### Q: 支援哪些語言？

`zh-TW`（繁中）、`zh-CN`（簡中）、`en`（英文）、`ja`（日文）、`ko`（韓文）。預設繁體中文。

### Q: 可以同時錄製多場會議嗎？

目前僅支援單一 Session，需先停止當前錄音才能開始新的。

## Tech Stack

- **Runtime:** Node.js 20+
- **Language:** TypeScript
- **Protocol:** [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) SDK
- **Audio (Windows):** Python [soundcard](https://github.com/bastibe/SoundCard)（WASAPI loopback）+ [naudiodon](https://github.com/Streampunk/naudiodon)（mic）
- **Audio (macOS/Linux):** FFmpeg via ffmpeg-static
- **STT:** [Deepgram Nova-2](https://deepgram.com) API
- **Export:** docx

## License

[MIT](LICENSE)
