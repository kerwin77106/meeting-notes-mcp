---
name: meeting
description: 會議錄音與紀錄生成工具
---

# /meeting 指令

根據使用者輸入的子指令執行對應操作。

## 無子指令（開始錄音）

**直接開始錄音，不詢問任何問題。**

1. 自動產生暫定會議名稱，格式：`會議-MM月DD日-HHmm`（以當前時間產生，例如 `會議-03月30日-1430`）
2. 立即呼叫 MCP Tool `start_recording`，傳入自動產生的 meeting_name，language 預設 `zh-TW`，participants 留空
3. 成功後回覆：

```
🎙 錄音已開始
會議：{自動產生的名稱}
Session ID: {session_id}

開會完畢後輸入 /meeting stop 停止錄音並填寫會議資訊。
錄音過程中可輸入 /meeting status 查看即時逐字稿。
```

## stop（停止錄音並生成紀錄）

1. 從對話上下文取得 session_id，呼叫 MCP Tool `stop_recording`，取得完整逐字稿與錄音時長

2. 停止後，以快速選單收集會議資訊：

```
【會議資訊】

會議名稱？（直接 Enter 使用「{自動產生的名稱}」）：
```
等待使用者輸入。若直接 Enter，沿用自動名稱。

```
語言：
  1) 繁體中文 zh-TW（預設）
  2) English en
  3) 日本語 ja
  4) 한국어 ko
  5) 简体中文 zh-CN
請輸入數字（直接 Enter 選 1）：
```
等待使用者輸入數字選擇語言。

```
參與者？（以逗號分隔，可直接 Enter 跳過）：
```
等待使用者輸入。

3. 根據逐字稿與填寫的資訊，使用以下 Prompt 生成結構化會議紀錄：

你是一位專業的會議紀錄助理。根據以下逐字稿，請生成結構化的會議紀錄。

規則：
1. 使用繁體中文
2. 重點摘要抓取 3-7 個最重要的討論要點
3. 決議事項只列出有明確結論的項目
4. 行動方案必須包含負責人、任務描述、截止日（若未提及標記為「待確認」）
5. 逐字稿以每段附帶時間戳格式呈現

格式如下：
# {會議名稱} -- {YYYY-MM-DD}
> 參與者：{participants}
> 時長：{duration}
> 語言：{language}

## 重點摘要
- ...

## 決議事項
- ...

## 行動方案
| 負責人 | 任務 | 截止日 |
|--------|------|--------|

## 逐字稿
[HH:MM:SS] text...

4. 顯示完整紀錄，詢問使用者是否需要修改
5. 呼叫 MCP Tool `save_notes` 存檔（format 預設 md）
6. 顯示儲存路徑

## status（查看即時狀態）

1. 從對話上下文中取得之前 start_recording 回傳的 session_id（不需要使用者提供）
2. 呼叫 MCP Tool `get_transcript`，傳入該 session_id
3. 顯示錄音狀態、已錄製時長、已轉譯 chunk 數
4. 顯示最近 5 段逐字稿

## list（列出歷史紀錄）

1. 呼叫 MCP Tool `list_recordings`
2. 以表格形式顯示歷史紀錄
