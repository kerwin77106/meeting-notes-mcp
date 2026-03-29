# Meeting Notes MCP — 待開發清單

## 進行中 / 已完成

- [x] 替換 Groq Whisper → Deepgram Nova-2（消除幻覺問題）
- [x] 語言代碼修正：zh-TW 直接傳給 Deepgram，輸出繁體中文
- [x] 靜音偵測閾值調整（Deepgram 不需嚴格過濾）
- [x] MCP server 改從本地 dist 執行（不再走 npx 舊版）
- [x] Windows 藍芽耳機相容：改用 naudiodon (PortAudio WDM-KS loopback) 取代 Stereo Mix/FFmpeg
  - `src/audio/naudiodon-recorder.ts`：PortAudio 錄音器，支援混音
  - `src/audio/naudiodon-device-detector.ts`：自動偵測藍芽 A2DP loopback / 喇叭 loopback / 麥克風
  - `src/audio/resampler.ts`：PCM 重採樣（48kHz→16kHz）、立體聲轉單聲道、混音

---

## 待開發

### [OBSOLETE - 已由 naudiodon 取代] Windows WASAPI Loopback 支援

~~原計畫使用 FFmpeg WASAPI Loopback 支援藍芽耳機。~~
~~已確認 ffmpeg-static 和 BtbN 官方 build 均不支援 wasapi（Unknown input format: 'wasapi'）。~~
~~已改用 naudiodon (PortAudio WDM-KS loopback) 實作，無需額外安裝 FFmpeg。~~

---

### [MEDIUM] 錄音中自動切換音訊裝置（Polling 方案）

**問題：**
錄音裝置在 `start_recording` 時固定，途中切換藍芽耳機不會重新偵測，導致系統音訊錄不到。

**實作方式：Polling（每 5 秒輪詢）**
- 錄音開始時啟動 `setInterval`，每 5 秒重掃 `naudiodon.getDevices()`
- 比對當前 loopback 裝置與新偵測結果
- 若 `btha2dp` 出現 → 停舊 loopback，啟動藍芽 loopback
- 若 `btha2dp` 消失 → 停藍芽 loopback，改回喇叭 loopback
- 錄音停止時 `clearInterval`

**關鍵實作：**
- `NaudiodonRecorder.switchLoopback(newDevice)` - 停舊 AudioIO，接回同一個 output PassThrough
- 切換期間 ~100ms 音訊斷點可忽略

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
