# Spec: naudiodon 音訊捕捉整合

**版本：** 0.1
**日期：** 2026-03-29
**狀態：** 待實作

---

## 背景與問題

目前系統音訊捕捉使用 FFmpeg + dshow Stereo Mix，存在以下問題：

1. **Stereo Mix 綁定 Realtek 音效卡**，切換到藍芽耳機後 Stereo Mix 收不到聲音
2. **RMS 靜音偵測不精準**，會誤殺正常音訊
3. FFmpeg 錄音與轉譯是分離的，pipeline 較複雜

**驗證結果（2026-03-29）：**
- naudiodon (PortAudio) 在 Windows 上可透過 WDM-KS 直接讀取輸出裝置的 loopback 音訊
- 藍芽耳機連線時自動出現對應的 A2DP loopback 裝置
- 藍芽麥克風透過 WASAPI 正常可讀

---

## 目標

用 **naudiodon** 取代 FFmpeg 的錄音部分，讓系統音訊捕捉能：
- 自動跟隨當前預設輸出裝置（電腦喇叭 / 藍芽耳機 / HDMI）
- 支援藍芽耳機麥克風
- 無需安裝額外軟體（VB-CABLE 等）

> FFmpeg 仍保留用於 PCM → MP3 轉換（Chunker 內部）

---

## 裝置偵測邏輯

### 系統音訊（Loopback）

偵測優先順序：
1. 找出 `WDM-KS` 輸出裝置中 `maxInputChannels > 0` 的裝置
2. 比對關鍵字判斷是否為當前預設輸出：
   - 藍芽：名稱含 `btha2dp`（A2DP loopback）
   - 喇叭：名稱含 `Realtek HD Audio output`、`Speakers`
3. 若無法判斷，fallback 到第一個可用的 WDM-KS loopback 裝置

**已驗證裝置對應：**

| 情境 | Device ID | 名稱 | Sample Rate |
|------|-----------|------|------------|
| 電腦喇叭 | 22 | 電腦喇叭 (Realtek HD Audio 2nd output) | 48000 |
| 藍芽耳機 | 34 | Input (btha2dp, Redmi Buds 6) | 48000 |

### 麥克風

偵測優先順序：
1. **藍芽耳機麥克風（WASAPI）**：名稱含藍芽裝置名稱且為 WASAPI input
2. **內建麥克風（WASAPI）**：`Microphone Array` WASAPI
3. **Fallback**：第一個可用的 WASAPI input 裝置

**已驗證裝置對應：**

| 情境 | Device ID | 名稱 | Sample Rate |
|------|-----------|------|------------|
| 藍芽耳機麥克風 | 19 | 耳機 (Redmi Buds 6) WASAPI | 16000 |
| 內建麥克風 | 15 | Microphone Array (Intel) WASAPI | 48000 |

---

## 實作範圍

### 1. `src/audio/naudiodon-recorder.ts`（新增）

取代 `FFmpegRecorder`，實作相同的 `AudioRecorder` 介面。

```typescript
interface AudioRecorder {
  startSystemAudio(): Promise<NodeJS.ReadableStream>
  startMicrophone(): Promise<NodeJS.ReadableStream>
  startMixed(): Promise<NodeJS.ReadableStream>   // 系統音訊 + 麥克風混音
  stop(): Promise<void>
  getStatus(): RecorderStatus
}
```

**內部實作：**
- 使用 naudiodon `AudioIO` 開啟 loopback 裝置
- 兩路音訊（系統 + 麥克風）以 PCM 格式讀取
- 若 sample rate 不同（如系統 48000、藍芽麥克風 16000），需先 resample 再混音
- 混音方式：逐 sample 相加並除以 2（simple mix），或交給 FFmpeg `-filter_complex amix`
- 輸出統一為 `16000Hz, 16-bit, mono` 的 PCM stream（與現有 Chunker 相容）

### 2. `src/audio/naudiodon-device-detector.ts`（新增）

取代 `DeviceDetector`，使用 naudiodon API 偵測裝置。

```typescript
class NaudiodonDeviceDetector {
  static detectLoopbackDevice(): NaudiodonDevice | null
  static detectMicrophoneDevice(): NaudiodonDevice | null
  static getAllDevices(): NaudiodonDevice[]
}

interface NaudiodonDevice {
  id: number
  name: string
  hostAPIName: string
  sampleRate: number
  channels: number
  type: 'loopback' | 'microphone'
}
```

**偵測策略：**
```
getAllDevices()
  ↓
過濾 WDM-KS + maxInputChannels > 0
  ↓
btha2dp 在名稱中？ → 藍芽 loopback
否 → Realtek HD Audio output → 喇叭 loopback
  ↓
WASAPI + maxInputChannels > 0
  ↓
藍芽裝置名稱吻合？ → 藍芽麥克風
否 → Microphone Array → 內建麥克風
```

### 3. `src/audio/resampler.ts`（新增）

處理不同 sample rate 的 PCM 資料 resample。

```typescript
class Resampler {
  // 線性插值 resample，用於混音前統一 sample rate
  static resample(pcm: Buffer, fromRate: number, toRate: number): Buffer
}
```

### 4. `src/tools/start-recording.ts`（修改）

將 `FFmpegRecorder` 替換為 `NaudiodonRecorder`。

### 5. `package.json`（修改）

`naudiodon` 從 devDependencies 移至 dependencies。

---

## PCM 輸出規格

所有音訊統一輸出為：

| 項目 | 規格 |
|------|------|
| Sample Rate | 16000 Hz |
| Channels | 1 (mono) |
| Bit Depth | 16-bit signed little-endian |
| Format | Raw PCM（與現有 Chunker 相容） |

---

## 混音策略

```
系統音訊 PCM (48000Hz, stereo)
    ↓ resample to 16000Hz + 轉 mono（左右聲道平均）
    ↓
麥克風 PCM (16000Hz 或 48000Hz, mono/stereo)
    ↓ resample to 16000Hz + 轉 mono（若需要）
    ↓
逐 sample 混音：output[i] = clamp((sys[i] + mic[i]) / 2)
    ↓
輸出 16000Hz mono PCM stream → Chunker
```

---

## 錯誤處理

| 情境 | 處理方式 |
|------|---------|
| 找不到 loopback 裝置 | 僅錄麥克風，顯示 warning |
| 找不到麥克風 | 僅錄系統音訊，顯示 warning |
| 兩者都找不到 | 回傳 `AUDIO_DEVICE_NOT_FOUND` 錯誤 |
| 裝置開啟失敗 | 嘗試 fallback 裝置，失敗則報錯 |
| 錄音中裝置斷線（藍芽）| 捕捉 error 事件，記錄 log，繼續用剩餘裝置 |

---

## 非 Windows 平台

naudiodon 跨平台支援，但 loopback 偵測邏輯需分平台：

| 平台 | 系統音訊方案 |
|------|------------|
| Windows | WDM-KS loopback（本 spec） |
| macOS | BlackHole / Soundflower 虛擬裝置（後續 spec） |
| Linux | PulseAudio monitor source（後續 spec） |

**本 spec 僅涵蓋 Windows。macOS / Linux 暫時 fallback 到現有 FFmpegRecorder。**

---

## 不在本次範圍內

- macOS / Linux 的 naudiodon 整合
- Chunker 的修改（維持現有邏輯）
- Deepgram 相關邏輯（不變）
- UI / MCP tool 介面（不變）

---

## 驗收條件

1. 不連藍芽耳機時，能錄到電腦喇叭的系統音訊
2. 連上藍芽耳機時，能錄到藍芽耳機的系統音訊
3. 藍芽耳機的麥克風聲音能正常收錄
4. 兩路音訊混音後送 Deepgram 能正確轉譯
5. 切換音訊裝置後重新開始錄音，能自動偵測到新裝置
6. FFmpeg 不再用於錄音（僅保留 PCM→MP3 轉換）
