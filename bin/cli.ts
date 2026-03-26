#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);

async function main(): Promise<void> {
  if (args.includes('--install-skill')) {
    await installSkill();
    return;
  }

  if (args.includes('--version')) {
    await showVersion();
    return;
  }

  if (args.includes('--help')) {
    showHelp();
    return;
  }

  // 無參數：啟動 MCP Server
  await import('../src/index.js');
}

/**
 * 複製 skills/meeting.md 到 ~/.claude/commands/meeting.md
 */
async function installSkill(): Promise<void> {
  const skillSource = path.resolve(__dirname, '..', 'skills', 'meeting.md');
  const targetDir = path.join(os.homedir(), '.claude', 'commands');
  const targetPath = path.join(targetDir, 'meeting.md');

  // 確認來源檔案存在
  if (!fs.existsSync(skillSource)) {
    console.error(`錯誤：找不到 Skill 定義檔 ${skillSource}`);
    process.exit(1);
  }

  // 確保目標目錄存在
  if (!fs.existsSync(targetDir)) {
    await fs.promises.mkdir(targetDir, { recursive: true });
  }

  // 複製檔案
  await fs.promises.copyFile(skillSource, targetPath);
  console.log(`✓ 已安裝 Skill 定義至 ${targetPath}`);
  console.log('  你現在可以在 Claude Code 中使用 /meeting 指令了。');
}

/**
 * 顯示版本號
 */
async function showVersion(): Promise<void> {
  try {
    const pkgPath = path.resolve(__dirname, '..', 'package.json');
    const raw = await fs.promises.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as { version: string };
    console.log(`meeting-notes-mcp v${pkg.version}`);
  } catch {
    console.log('meeting-notes-mcp v0.1.0');
  }
}

/**
 * 顯示使用說明
 */
function showHelp(): void {
  console.log(`
meeting-notes-mcp - 會議錄音與紀錄生成 MCP Server

用法：
  meeting-notes-mcp                 啟動 MCP Server（透過 stdio 傳輸）
  meeting-notes-mcp --install-skill 安裝 /meeting Skill 到 Claude Code
  meeting-notes-mcp --version       顯示版本號
  meeting-notes-mcp --help          顯示此說明

環境變數：
  GROQ_API_KEY    Groq API Key（必要，用於語音轉文字）

設定檔：
  ~/.meeting-notes-mcp/config.json  應用程式設定
  ~/.meeting-notes-mcp/usage.json   API 使用量記錄

MCP 設定範例（claude_desktop_config.json）：
  {
    "mcpServers": {
      "meeting-notes": {
        "command": "npx",
        "args": ["-y", "meeting-notes-mcp"],
        "env": {
          "GROQ_API_KEY": "your-api-key"
        }
      }
    }
  }

更多資訊：https://github.com/user/meeting-notes-mcp
`.trim());
}

main().catch((err) => {
  console.error('[meeting-notes-mcp] Error:', err);
  process.exit(1);
});
