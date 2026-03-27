# Meeting Notes MCP — 待開發清單

## 進行中 / 已完成

- [x] 替換 Groq Whisper → Deepgram Nova-2（消除幻覺問題）
- [x] 語言代碼修正：zh-TW 直接傳給 Deepgram，輸出繁體中文
- [x] 靜音偵測閾值調整（Deepgram 不需嚴格過濾）
- [x] MCP server 改從本地 dist 執行（不再走 npx 舊版）

---

## 待開發

### [HIGH] Windows WASAPI Loopback 支援（藍芽耳機相容）

**問題：**
目前系統音訊捕捉使用 Stereo Mix（dshow），只能捕捉 Realtek 音效卡的輸出。
當使用藍芽耳機時，音訊輸出走藍芽裝置，Stereo Mix 收不到任何聲音。

**目標：**
加入 `meeting-notes-mcp --setup` 指令，自動下載支援 WASAPI Loopback 的 FFmpeg binary，
讓系統音訊捕捉能跟隨當前預設輸出裝置（不管是 Realtek、藍芽、HDMI）。

**安裝流程（目標）：**
```bash
npm install -g meeting-notes-mcp   # 現有
meeting-notes-mcp --setup          # 新增：一次性下載 WASAPI FFmpeg
```

**實作範圍：**
1. `src/audio/ffmpeg-resolver.ts`（新增）
   - 優先使用 `~/.meeting-notes-mcp/ffmpeg.exe`（WASAPI 版）
   - Fallback 到 ffmpeg-static（現有）
   - 提供 `downloadWasapiFfmpeg()` 方法（從 BtbN GitHub Releases 下載）

2. `src/audio/device-detector.ts`（修改）
   - Windows 改用 WASAPI 列出裝置
   - 支援 WASAPI Loopback 裝置偵測

3. `src/audio/ffmpeg-recorder.ts`（修改）
   - Windows 系統音訊改用 `-f wasapi -loopback 1` 取代 `-f dshow Stereo Mix`
   - 自動 fallback：WASAPI 失敗 → dshow Stereo Mix

4. `src/index.ts`（修改）
   - 加入 `--setup` CLI 指令
   - 顯示下載進度條

**FFmpeg 來源：**
- BtbN 官方 GitHub Releases：`ffmpeg-master-latest-win64-gpl.zip`
- 只需解壓 `ffmpeg.exe`（約 80MB）
- 存放路徑：`~/.meeting-notes-mcp/bin/ffmpeg.exe`

**非 Windows：**
- macOS / Linux 不需要此步驟，繼續使用 ffmpeg-static

---

### [MEDIUM] 參與者空陣列驗證問題

**問題：**
`start_recording` 傳入 `participants: []` 會回傳錯誤「參與者須為非空陣列」，
但空陣列應該等同於「未填寫」，應允許通過。

**修正：**
`start-recording.ts` 驗證邏輯調整：`participants` 若為空陣列視為未填，不報錯。

---

### [LOW] 首次使用引導（onboarding）

**目標：**
`meeting-notes-mcp --setup` 同時完成：
1. 設定 Deepgram API Key
2. 下載 WASAPI FFmpeg（Windows）
3. 驗證設定是否正確
