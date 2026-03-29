// eslint-disable-next-line @typescript-eslint/no-require-imports
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
  loopback: LoopbackDevice | null;
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

    const loopback = NaudiodonDeviceDetector.findLoopback(all);
    const mic = NaudiodonDeviceDetector.findMic(all);

    let warning: string | undefined;
    if (!loopback && !mic) {
      warning = '偵測不到任何音訊裝置';
    } else if (!loopback) {
      warning = '未偵測到系統音訊裝置，僅錄製麥克風';
    } else if (!mic) {
      warning = '未偵測到麥克風裝置，僅錄製系統音訊';
    }

    return { loopback, mic, warning };
  }

  // ---- 內部方法 ----

  /**
   * 找出系統音訊 Loopback 裝置。
   * 優先順序：藍芽 A2DP loopback → Realtek 喇叭 loopback → 任意 WDM-KS loopback
   */
  private static findLoopback(devices: NaudiodonDevice[]): LoopbackDevice | null {
    // WDM-KS 且有輸入聲道（表示支援 loopback 捕捉）
    const candidates = devices.filter(
      (d) => d.hostAPIName === 'Windows WDM-KS' && d.maxInputChannels > 0,
    );

    // 1. 藍芽 A2DP loopback（btha2dp 是 Windows 藍芽 A2DP 驅動）
    const btLoopback = candidates.find((d) =>
      d.name.toLowerCase().includes('btha2dp'),
    );
    if (btLoopback) {
      return {
        id: btLoopback.id,
        name: btLoopback.name,
        sampleRate: btLoopback.defaultSampleRate,
        channels: btLoopback.maxInputChannels,
      };
    }

    // 2. Realtek 喇叭 loopback（有 output 字樣的 WDM-KS 輸入裝置）
    const realtekLoopback = candidates.find(
      (d) =>
        d.name.toLowerCase().includes('realtek') &&
        (d.name.toLowerCase().includes('output') || d.name.includes('喇叭') || d.name.includes('電腦喇叭')),
    );
    if (realtekLoopback) {
      return {
        id: realtekLoopback.id,
        name: realtekLoopback.name,
        sampleRate: realtekLoopback.defaultSampleRate,
        channels: realtekLoopback.maxInputChannels,
      };
    }

    // 3. Fallback：任何有 output/speakers 關鍵字的 WDM-KS 輸入
    const fallback = candidates.find(
      (d) =>
        d.name.toLowerCase().includes('output') ||
        d.name.toLowerCase().includes('speakers') ||
        d.name.includes('喇叭'),
    );
    if (fallback) {
      return {
        id: fallback.id,
        name: fallback.name,
        sampleRate: fallback.defaultSampleRate,
        channels: fallback.maxInputChannels,
      };
    }

    return null;
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
