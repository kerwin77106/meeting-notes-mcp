/**
 * 音訊錄製即時診斷工具 v2
 * 同時測試所有可能的 loopback 裝置，找出哪個有資料
 * 用法：node test-audio.mjs
 * 按 Ctrl+C 停止
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const naudiodon = require('naudiodon');

const devices = naudiodon.getDevices();

// 測試這些裝置（所有有輸入聲道的裝置）
const candidates = devices.filter(d => d.maxInputChannels > 0);

console.log('\n===== 測試所有輸入裝置 =====');
candidates.forEach(d => {
  const api = d.hostAPIName.replace('Windows ', '').padEnd(10);
  console.log(`[${String(d.id).padStart(2)}] ${api} in:${d.maxInputChannels} SR:${d.defaultSampleRate} | ${d.name}`);
});

function calcRms(buf) {
  let sum = 0;
  const count = Math.floor(buf.length / 2);
  if (count === 0) return 0;
  for (let i = 0; i < buf.length - 1; i += 2) {
    const s = buf.readInt16LE(i);
    sum += s * s;
  }
  return Math.sqrt(sum / count);
}

// 只測試我們關心的 loopback 候選（排除明確的麥克風陣列等）
const skipKeywords = ['麥克風排列', 'microphone array', 'intel'];
const loopbackDevices = candidates.filter(d =>
  !skipKeywords.some(kw => d.name.toLowerCase().includes(kw))
);

const streams = [];
const stats = {};

console.log(`\n開啟 ${loopbackDevices.length} 個裝置串流...\n`);

for (const dev of loopbackDevices) {
  stats[dev.id] = { bytes: 0, rms: 0, error: null };
  const ch = Math.min(dev.maxInputChannels, 2);

  try {
    const io = new naudiodon.AudioIO({
      inOptions: {
        channelCount: ch,
        sampleFormat: naudiodon.SampleFormat16Bit,
        sampleRate: dev.defaultSampleRate,
        deviceId: dev.id,
        closeOnError: true,
      }
    });

    io.on('data', (chunk) => {
      stats[dev.id].bytes += chunk.length;
      stats[dev.id].rms = Math.round(calcRms(chunk));
    });

    io.on('error', (err) => {
      const msg = (err && err.message) ? err.message : String(err);
      if (stats[dev.id]) stats[dev.id].error = msg.substring(0, 40);
    });

    io.start();
    streams.push(io);
    console.log(`  ✅ [ID:${dev.id}] ${dev.name}`);
  } catch (err) {
    stats[dev.id].error = err.message.substring(0, 40);
    console.log(`  ❌ [ID:${dev.id}] ${dev.name} → ${stats[dev.id].error}`);
  }
}

console.log('\n播放系統音訊，觀察哪個裝置的 RMS > 0 且 KB 在增加...\n');
console.log('ID  API        RMS    KB    裝置名稱');
console.log('─'.repeat(80));

const interval = setInterval(() => {
  process.stdout.write('\x1B[' + loopbackDevices.length + 'A'); // 游標上移
  for (const dev of loopbackDevices) {
    const s = stats[dev.id];
    const api = dev.hostAPIName.replace('Windows ', '').substring(0, 8).padEnd(8);
    const rms = String(s.rms).padStart(5);
    const kb = (s.bytes / 1024).toFixed(1).padStart(6);
    const active = s.rms > 10 ? ' ◀ 有訊號' : '';
    const errStr = s.error ? ` ⚠ ${s.error}` : '';
    const name = (dev.name).substring(0, 35);
    console.log(`[${String(dev.id).padStart(2)}] ${api} ${rms} ${kb}KB  ${name}${active}${errStr}`);
  }
}, 500);

process.on('SIGINT', () => {
  clearInterval(interval);
  streams.forEach(s => { try { s.quit(); } catch {} });
  console.log('\n\n===== 結果摘要 =====');
  const active = loopbackDevices.filter(d => stats[d.id].bytes > 0);
  if (active.length === 0) {
    console.log('⚠️  沒有任何裝置捕捉到資料');
  } else {
    console.log('有資料的裝置：');
    active.forEach(d => {
      console.log(`  [ID:${d.id}] ${d.name} → ${(stats[d.id].bytes/1024).toFixed(1)}KB`);
    });
  }
  process.exit(0);
});
