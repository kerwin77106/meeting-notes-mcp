/**
 * PCM 音訊工具：Resample 與聲道轉換。
 * 使用線性插值，適合語音品質需求。
 */
export class Resampler {
  /**
   * 將 stereo（左右聲道交錯）轉換為 mono（平均左右聲道）。
   * 輸入：每個 sample 4 bytes（L int16 + R int16）
   * 輸出：每個 sample 2 bytes（mono int16）
   */
  static stereoToMono(pcm: Buffer): Buffer {
    const samples = Math.floor(pcm.length / 4);
    const out = Buffer.allocUnsafe(samples * 2);
    for (let i = 0; i < samples; i++) {
      const left = pcm.readInt16LE(i * 4);
      const right = pcm.readInt16LE(i * 4 + 2);
      const mono = Math.round((left + right) / 2);
      out.writeInt16LE(mono, i * 2);
    }
    return out;
  }

  /**
   * 線性插值 Resample（mono, 16-bit signed LE）。
   * @param pcm 輸入 PCM buffer
   * @param srcRate 來源 sample rate（Hz）
   * @param dstRate 目標 sample rate（Hz）
   */
  static resample(pcm: Buffer, srcRate: number, dstRate: number): Buffer {
    if (srcRate === dstRate) return pcm;

    const srcSamples = Math.floor(pcm.length / 2);
    if (srcSamples === 0) return Buffer.alloc(0);

    const ratio = srcRate / dstRate;
    const dstSamples = Math.floor(srcSamples / ratio);
    const out = Buffer.allocUnsafe(dstSamples * 2);

    for (let i = 0; i < dstSamples; i++) {
      const srcPos = i * ratio;
      const srcIdx = Math.floor(srcPos);
      const frac = srcPos - srcIdx;

      const s0 = srcIdx < srcSamples ? pcm.readInt16LE(srcIdx * 2) : 0;
      const s1 = (srcIdx + 1) < srcSamples ? pcm.readInt16LE((srcIdx + 1) * 2) : s0;

      const val = Math.round(s0 + (s1 - s0) * frac);
      out.writeInt16LE(Math.max(-32768, Math.min(32767, val)), i * 2);
    }

    return out;
  }

  /**
   * 混音兩段相同長度的 mono 16-bit PCM（簡單平均）。
   */
  static mix(a: Buffer, b: Buffer): Buffer {
    const samples = Math.floor(Math.min(a.length, b.length) / 2);
    const out = Buffer.allocUnsafe(samples * 2);
    for (let i = 0; i < samples; i++) {
      const sa = a.readInt16LE(i * 2);
      const sb = b.readInt16LE(i * 2);
      const mixed = Math.max(-32768, Math.min(32767, Math.round((sa + sb) / 2)));
      out.writeInt16LE(mixed, i * 2);
    }
    return out;
  }
}
