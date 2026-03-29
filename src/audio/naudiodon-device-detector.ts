import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const naudiodon = require('naudiodon') as NaudiodonModule;

interface NaudiodonDevice {
  id: number;
  name: string;
  hostAPIName: string;
  maxInputChannels: number;
  maxOutputChannels: number;
  defaultSampleRate: number;
}

interface NaudiodonModule {
  getDevices(): NaudiodonDevice[];
}

export interface LoopbackDevice {
  id: number;
  name: string;
  sampleRate: number;
  channels: number;
}

export interface MicDevice {
  id: number;
  name: string;
  sampleRate: number;
  channels: number;
}

export interface DetectedAudioDevices {
  /** 主要 loopback 裝置（第一候選） */
  loopback: LoopbackDevice | null;
  /** 所有 loopback 候選（依優先順序），Recorder 可逐一嘗試開啟 */
  loopbackCandidates: LoopbackDevice[];
  mic: MicDevice | null;
  warning?: string;
}

/**
 * 使用 naudiodon (PortAudio) 偵測 Windows 音訊裝置。
 * 僅支援 Windows，其他平台請使用 DeviceDetector。
 */
export class NaudiodonDeviceDetector {
  static detect(): DetectedAudioDevices {
    const all = naudiodon.getDevices() as NaudiodonDevice[];

    const loopbackCandidates = NaudiodonDeviceDetector.findLoopbackCandidates(all);
    const loopback = loopbackCandidates[0] ?? null;
    const mic = NaudiodonDeviceDetector.findMic(all);

    let warning: string | undefined;
    if (loopbackCandidates.length === 0 && !mic) {
      warning = '偵測不到任何音訊裝置';
    } else if (loopbackCandidates.length === 0) {
      warning = '未偵測到系統音訊裝置，僅錄製麥克風';
    } else if (!mic) {
      warning = '未偵測到麥克風裝置，僅錄製系統音訊';
    }

    return { loopback, loopbackCandidates, mic, warning };
  }

  // ---- 內部方法 ----

  /**
   * 找出所有系統音訊 Loopback 候選裝置（依優先順序排列）。
   * Recorder 會依序嘗試開啟，遇到 "Invalid device" 或其他錯誤時自動換下一個。
   *
   * 優先順序：
   *   1. 藍芽 A2DP WDM-KS loopback（btha2dp）
   *   2. WDM-KS 立體聲混音（藍芽模式下 WASAPI 被鎖定時有效）
   *   3. WASAPI Stereo Mix（非藍芽最可靠）
   *   4. MME Stereo Mix
   *   5. WDM-KS 電腦喇叭 loopback（部分系統有效）
   */
  private static findLoopbackCandidates(devices: NaudiodonDevice[]): LoopbackDevice[] {
    const result: LoopbackDevice[] = [];
    const seen = new Set<number>();

    const add = (d: NaudiodonDevice) => {
      if (!seen.has(d.id)) {
        seen.add(d.id);
        result.push({ id: d.id, name: d.name, sampleRate: d.defaultSampleRate, channels: d.maxInputChannels });
      }
    };

    const stereoMixKeywords = ['stereo mix', '立體聲混音'];
    const micKeywords = ['microphone', 'mic', '麥克風', '麥克風排列'];

    // 1. 藍芽 A2DP WDM-KS loopback
    devices.filter(
      (d) => d.hostAPIName === 'Windows WDM-KS' && d.maxInputChannels > 0 && d.name.toLowerCase().includes('btha2dp'),
    ).forEach(add);

    // 2. WASAPI Stereo Mix（非藍芽最可靠，WDM-KS 立體聲混音雖可開啟但通常不產生資料）
    devices.filter(
      (d) => d.hostAPIName === 'Windows WASAPI' && d.maxInputChannels > 0 &&
        stereoMixKeywords.some((kw) => d.name.toLowerCase().includes(kw)),
    ).forEach(add);

    // 3. MME Stereo Mix
    devices.filter(
      (d) => d.hostAPIName === 'MME' && d.maxInputChannels > 0 &&
        stereoMixKeywords.some((kw) => d.name.toLowerCase().includes(kw)),
    ).forEach(add);

    // 4. WDM-KS 立體聲混音（藍芽或特殊狀態下有效，但開啟後不一定有資料）
    devices.filter(
      (d) => d.hostAPIName === 'Windows WDM-KS' && d.maxInputChannels > 0 &&
        stereoMixKeywords.some((kw) => d.name.toLowerCase().includes(kw)),
    ).forEach(add);

    // 5. WDM-KS 電腦喇叭 loopback（部分系統有效）
    const wdmLoopbacks = devices.filter(
      (d) => d.hostAPIName === 'Windows WDM-KS' && d.maxInputChannels > 0 &&
        !micKeywords.some((kw) => d.name.toLowerCase().includes(kw)) &&
        d.name.toLowerCase().includes('realtek') &&
        (d.name.toLowerCase().includes('output') || d.name.includes('喇叭') || d.name.includes('電腦喇叭')),
    );
    // 主輸出優先（不含 "2nd"）
    [...wdmLoopbacks.filter((d) => !d.name.toLowerCase().includes('2nd')),
      ...wdmLoopbacks.filter((d) => d.name.toLowerCase().includes('2nd'))].forEach(add);

    return result;
  }

  /**
   * 找出麥克風裝置。
   * 優先順序：藍芽耳機麥克風 → 內建 Microphone Array → 任意 WASAPI 輸入
   */
  private static findMic(devices: NaudiodonDevice[]): MicDevice | null {
    const wasapiInputs = devices.filter(
      (d) => d.hostAPIName === 'Windows WASAPI' && d.maxInputChannels > 0,
    );

    // 排除非麥克風裝置
    const excluded = ['stereo mix', 'todesk', '立體聲混音'];
    const realMics = wasapiInputs.filter(
      (d) => !excluded.some((kw) => d.name.toLowerCase().includes(kw)),
    );

    // 1. 藍芽耳機麥克風：非 Microphone Array 且非系統虛擬裝置
    const btMic = realMics.find(
      (d) =>
        !d.name.toLowerCase().includes('microphone array') &&
        !d.name.toLowerCase().includes('intel'),
    );
    if (btMic) {
      return {
        id: btMic.id,
        name: btMic.name,
        sampleRate: btMic.defaultSampleRate,
        channels: 1,
      };
    }

    // 2. 內建麥克風 Array（Intel 智慧音效）
    const builtIn = realMics.find((d) =>
      d.name.toLowerCase().includes('microphone array'),
    );
    if (builtIn) {
      return {
        id: builtIn.id,
        name: builtIn.name,
        sampleRate: builtIn.defaultSampleRate,
        channels: 1,
      };
    }

    // 3. 任意 WASAPI 輸入
    if (realMics.length > 0) {
      const d = realMics[0];
      return { id: d.id, name: d.name, sampleRate: d.defaultSampleRate, channels: 1 };
    }

    return null;
  }
}
