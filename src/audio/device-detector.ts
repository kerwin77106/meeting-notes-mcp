import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
const ffmpegPath = ffmpegStatic as unknown as string;
import { AudioDevice } from '../types.js';

export class DeviceDetector {
  /**
   * 偵測系統上可用的音訊裝置。
   * 透過 ffmpeg 列出裝置清單，解析 stderr 輸出。
   */
  static async detectDevices(): Promise<AudioDevice[]> {
    const platform = process.platform;
    const binary = DeviceDetector.getFfmpegBinary();

    if (platform === 'win32') {
      return DeviceDetector.detectDshow(binary);
    }

    if (platform === 'darwin') {
      return DeviceDetector.detectAvfoundation(binary);
    }

    if (platform === 'linux') {
      return DeviceDetector.detectPulse(binary);
    }

    throw new Error(`Unsupported platform: ${platform}`);
  }

  /**
   * 取得預設系統音訊裝置。
   */
  static async getDefaultSystemAudio(): Promise<AudioDevice | null> {
    const devices = await DeviceDetector.detectDevices();
    const systemDevices = devices.filter((d) => d.type === 'system');
    return systemDevices.length > 0 ? systemDevices[0] : null;
  }

  /**
   * 取得預設麥克風裝置。
   */
  static async getDefaultMicrophone(): Promise<AudioDevice | null> {
    const devices = await DeviceDetector.detectDevices();
    const micDevices = devices.filter((d) => d.type === 'microphone');
    return micDevices.length > 0 ? micDevices[0] : null;
  }

  // ---- 內部方法 ----

  private static getFfmpegBinary(): string {
    if (!ffmpegPath) {
      throw new Error('ffmpeg-static binary not found');
    }
    return ffmpegPath;
  }

  /**
   * Windows: dshow 裝置列表。
   * 執行 `ffmpeg -list_devices true -f dshow -i dummy`
   */
  private static async detectDshow(binary: string): Promise<AudioDevice[]> {
    const stderr = await DeviceDetector.runFfmpegForDevices(binary, [
      '-list_devices', 'true',
      '-f', 'dshow',
      '-i', 'dummy',
    ]);

    const devices: AudioDevice[] = [];
    const lines = stderr.split('\n');

    for (const line of lines) {
      // 跳過 "Alternative name" 行
      if (line.includes('Alternative name')) continue;

      // 匹配含 (audio) 標記的裝置行，例如:
      // [dshow @ ...] "Microphone Array (適用於...)" (audio)
      // [dshow @ ...] "麥克風 (ToDesk Virtual Audio)" (audio)
      if (!line.includes('(audio)')) continue;

      const nameMatch = line.match(/"\s*(.+?)\s*"/);
      if (nameMatch) {
        const deviceName = nameMatch[1];

        // 判斷是系統音訊（loopback）還是麥克風
        const lowerName = deviceName.toLowerCase();
        const isLoopback =
          lowerName.includes('loopback') ||
          lowerName.includes('stereo mix') ||
          lowerName.includes('wasapi') ||
          lowerName.includes('what u hear') ||
          lowerName.includes('wave out');

        devices.push({
          name: deviceName,
          type: isLoopback ? 'system' : 'microphone',
          platform: 'win32',
        });
      }
    }

    return devices;
  }

  /**
   * macOS: avfoundation 裝置列表。
   * 執行 `ffmpeg -f avfoundation -list_devices true -i ""`
   */
  private static async detectAvfoundation(binary: string): Promise<AudioDevice[]> {
    const stderr = await DeviceDetector.runFfmpegForDevices(binary, [
      '-f', 'avfoundation',
      '-list_devices', 'true',
      '-i', '',
    ]);

    const devices: AudioDevice[] = [];
    const lines = stderr.split('\n');

    let isAudioSection = false;

    for (const line of lines) {
      if (line.includes('AVFoundation audio devices:')) {
        isAudioSection = true;
        continue;
      }

      if (line.includes('AVFoundation video devices:')) {
        isAudioSection = false;
        continue;
      }

      if (!isAudioSection) continue;

      // 匹配 [AVFoundation ...] [index] Device Name
      const deviceMatch = line.match(/\[(\d+)]\s+(.+)/);
      if (deviceMatch) {
        const deviceId = deviceMatch[1];
        const deviceName = deviceMatch[2].trim();

        // macOS 中，index 0 通常是 Built-in Microphone
        // 系統音訊需要 BlackHole/Soundflower 等虛擬裝置
        const isSystemAudio =
          deviceName.toLowerCase().includes('blackhole') ||
          deviceName.toLowerCase().includes('soundflower') ||
          deviceName.toLowerCase().includes('loopback');

        devices.push({
          name: deviceName,
          type: isSystemAudio ? 'system' : 'microphone',
          platform: 'darwin',
          deviceId,
        });
      }
    }

    return devices;
  }

  /**
   * Linux: PulseAudio 裝置列表。
   * 使用 pactl 列出 sources。
   */
  private static async detectPulse(binary: string): Promise<AudioDevice[]> {
    const devices: AudioDevice[] = [];

    try {
      const output = await DeviceDetector.runCommand('pactl', ['list', 'short', 'sources']);
      const lines = output.split('\n');

      for (const line of lines) {
        const parts = line.trim().split('\t');
        if (parts.length < 2) continue;

        const sourceName = parts[1];
        const isMonitor = sourceName.includes('.monitor');

        devices.push({
          name: sourceName,
          type: isMonitor ? 'system' : 'microphone',
          platform: 'linux',
          deviceId: sourceName,
        });
      }
    } catch {
      // pactl 不存在，嘗試使用 ffmpeg
      const stderr = await DeviceDetector.runFfmpegForDevices(binary, [
        '-sources', 'pulse',
      ]);

      const lines = stderr.split('\n');
      for (const line of lines) {
        const match = line.match(/^\s*\*?\s+(\S+)\s+(.+)/);
        if (match) {
          const deviceId = match[1];
          const description = match[2].trim();
          const isMonitor = deviceId.includes('.monitor');

          devices.push({
            name: description || deviceId,
            type: isMonitor ? 'system' : 'microphone',
            platform: 'linux',
            deviceId,
          });
        }
      }
    }

    return devices;
  }

  /**
   * 執行 ffmpeg 並擷取 stderr 輸出（裝置列表輸出至 stderr）。
   */
  private static async runFfmpegForDevices(binary: string, args: string[]): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const proc = spawn(binary, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, LANG: 'en_US.UTF-8' },
      });

      let stderr = '';

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString('utf-8');
      });

      proc.on('error', (err) => {
        reject(err);
      });

      proc.on('exit', () => {
        // ffmpeg -list_devices 通常回傳非零，這是正常的
        resolve(stderr);
      });

      // 超時 10 秒
      setTimeout(() => {
        proc.kill('SIGKILL');
        resolve(stderr);
      }, 10000);
    });
  }

  /**
   * 執行一般指令並取得 stdout。
   */
  private static async runCommand(command: string, args: string[]): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const proc = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString('utf-8');
      });

      proc.on('error', (err) => {
        reject(err);
      });

      proc.on('exit', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Command ${command} exited with code ${code}`));
        }
      });
    });
  }
}
