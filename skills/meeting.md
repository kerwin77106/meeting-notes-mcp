---
name: meeting
description: 會議錄音與紀錄生成工具
---

# /meeting 指令

根據使用者輸入的子指令執行對應操作。

## 無子指令（開始錄音）

請互動式詢問使用者以下資訊：
1. 「請輸入會議名稱：」（必填）
2. 「請輸入參與者（以逗號分隔，可跳過）：」（選填）
3. 「會議語言？（預設 zh-TW）：」（選填）

收集完畢後，呼叫 MCP Tool `start_recording`，傳入 meeting_name、participants（以逗號 split 為陣列）、language。

成功後回覆：
已開始錄製「{meeting_name}」
Session ID: {session_id}

開會完畢後，請輸入 /meeting stop 結束錄音並生成會議紀錄。
錄音過程中，你可以輸入 /meeting status 查看即時逐字稿。

## stop（停止錄音並生成紀錄）

1. 呼叫 MCP Tool `stop_recording`，取得完整逐字稿
2. 根據逐字稿，使用以下 Prompt 生成結構化會議紀錄：

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

3. 顯示完整紀錄，詢問使用者是否需要修改
4. 呼叫 MCP Tool `save_notes` 存檔（format 預設 md）
5. 顯示儲存路徑

## status（查看即時狀態）

1. 呼叫 MCP Tool `get_transcript`
2. 顯示錄音狀態、已錄製時長、已轉譯 chunk 數
3. 顯示最近 5 段逐字稿

## list（列出歷史紀錄）

1. 呼叫 MCP Tool `list_recordings`
2. 以表格形式顯示歷史紀錄
