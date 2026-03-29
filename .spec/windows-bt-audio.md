# Windows 藍芽耳機系統音訊捕捉：問題排查與解決紀錄

**版本：** 0.4.0
**日期：** 2026-03-29
**狀態：** 已解決

---

## 問題描述

使用藍芽耳機（Redmi Buds 6）作為預設輸出裝置時，`start_recording` 只能錄到麥克風，系統音訊（YouTube 等）完全捕捉不到。

---

## 嘗試過的方案與失敗原因

### 方案一：naudiodon WDM-KS btha2dp loopback（失敗）

**預期做法：** Windows 藍芽 A2DP 驅動會在裝置清單中出現 `btha2dp` WDM-KS 裝置，應可透過 PortAudio 以 loopback 模式捕捉。

**實際結果：** `Could not open stream: Invalid device`

**根本原因：** WDM-KS 是 exclusive（排他）模式 API。當 Windows 音訊引擎正在使用 btha2dp 輸出音訊給藍芽耳機時，裝置已被佔用，PortAudio 無法以第二個 exclusive client 身份進入。

```
[test-audio.mjs 結果]
[ID:34] WDM-KS  btha2dp (Redmi Buds 6) → Could not open stream: Invalid device
```

---

### 方案二：WASAPI Stereo Mix（失敗）

**預期做法：** WASAPI Stereo Mix 可以捕捉所有輸出音訊，包含藍芽。

**實際結果：** Stereo Mix 開啟成功（RMS=0），但有資料流動卻完全靜音。

**根本原因：** Windows WASAPI Stereo Mix 綁定 **Realtek 音效卡**輸出，不捕捉藍芽 A2DP 輸出。切換到藍芽後，Realtek 輸出靜音，Stereo Mix 也跟著靜音。

```
[test-audio.mjs 結果]
[ID:18] WASAPI  Stereo Mix (Realtek)  RMS=0  2272KB（有資料但無訊號）
```

---

### 方案三：MME 耳機裝置當 loopback（誤判，已撤回）

**誤以為：** `[ID:4] MME 耳機 (Redmi Buds 6)` 在播放音樂時 RMS=1051，以為是 A2DP loopback。

**實際結果：** 錄音後逐字稿只有麥克風內容，系統音訊完全沒有。

**根本原因：** `MME 耳機 (Redmi Buds 6)` 是藍芽 **HFP 麥克風模式**的 MME 介面，不是系統音訊 loopback。RMS 顯示有訊號是因為它在捕捉使用者講話的聲音。

進一步測試確認：靜音播放音樂時 RMS=0，僅講話時 RMS > 0 → 確定是麥克風。

---

## 根本原因分析

| 方法 | 為何無效 |
|------|---------|
| PortAudio WDM-KS btha2dp | WDM-KS exclusive 模式，BT 輸出時裝置被佔用 |
| WASAPI Stereo Mix | 僅捕捉 Realtek 音效卡，不含 BT A2DP |
| MME 耳機裝置 | 是 HFP 麥克風，非系統音訊 loopback |

**結論：** Windows A2DP 是純輸出協定，**PortAudio 所有 API（WDM-KS / WASAPI / MME）均無法捕捉 BT A2DP 系統音訊**。

---

## 最終解決方案：Python soundcard WASAPI Loopback

**原理：** Windows Core Audio API 的 `IAudioClient` 支援 `AUDCLNT_STREAMFLAGS_LOOPBACK` flag，可以鏡像捕捉任何輸出裝置（包含藍芽 A2DP）的音訊，且不影響正常播放（shared 模式，非 exclusive）。

Python 的 `soundcard` 套件透過 `cffi` 直接呼叫此 Windows API：

```python
import soundcard as sc
speaker = sc.default_speaker()
loopback = sc.get_microphone(speaker.id, include_loopback=True)
# 自動跟隨當前預設輸出裝置（喇叭 or 藍芽）
```

**架構：**

```
Windows 音訊引擎
  ├─→ A2DP 輸出 → 藍芽耳機 🎧（正常播放）
  └─→ WASAPI Loopback tap（鏡像副本）
           ↓
  tools/wasapi-loopback.py（Python）
           ↓ stdout（raw PCM 16kHz mono int16）
  NaudiodonRecorder（Node.js child_process）
           ↓
  現有 Chunker → Deepgram → 逐字稿
```

---

## 實作細節

### `tools/wasapi-loopback.py`

- 使用 `soundcard` + `numpy`（`pip install soundcard numpy`）
- 自動讀取當前預設輸出裝置（不需手動指定）
- 輸出格式：16000Hz，mono，int16 little-endian，raw PCM → stdout
- 錯誤時寫 stderr 並 exit 1

### `src/audio/naudiodon-recorder.ts` 修改

- `startLoopbackStream()` 優先嘗試 `tryOpenPythonLoopback()`
- 若 `tools/wasapi-loopback.py` 不存在或 Python 啟動失敗，自動 fallback 到 naudiodon 候選
- Python 輸出已是目標規格（16kHz mono），不需 Resampler 處理

---

## 驗證結果

| 情境 | 系統音訊 | 麥克風 | 結果 |
|------|---------|--------|------|
| 電腦喇叭輸出 | ✅ | ✅ | 兩路皆錄到 |
| 藍芽耳機輸出 | ✅ | ✅ | 兩路皆錄到 |

---

## 相依套件

使用者需安裝（一次性）：

```bash
pip install soundcard numpy
```

> `soundcard 0.4.5` + `numpy<2.0`（numpy 2.x 有相容性問題，需降版）

---

## 已知限制

- 需要 Python 3.x 且已安裝 `soundcard`、`numpy<2.0`
- 僅適用 Windows（macOS / Linux 繼續使用 FFmpegRecorder）
- 錄音中切換輸出裝置不會自動重新偵測（需重啟錄音）
