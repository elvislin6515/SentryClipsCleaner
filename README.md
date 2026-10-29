# SentryClips 密集事件清理

Tesla USB / teslausb 的哨兵資料夾名稱是時間戳，例如 `2026-08-20_22-14-02`。行人、樹影或風常會在幾分鐘內連續觸發，把 `SentryClips` 塞滿幾乎一樣的片段。

這個工具會在瀏覽器裡讀取資料夾名稱，把間隔太近的事件收成群組，預設每個密集群組只留第一筆，其餘勾選後可刪除，或匯出 PowerShell 腳本在 Windows 上清理。

影片不會上傳。分析都在你這台電腦進行。

## 在 Windows 本機建立同一份專案

這個專案是在雲端做的，無法直接寫進你的 `C:\Users\...`。請用下面其中一種方式，在本機做出一樣的資料夾。

### 方式 A：解壓縮後執行（最快）

1. 把 `sentryclips-cleaner.zip` 解到例如  
   `C:\Users\elvis\OneDrive\SentryClipsCleaner`
2. 先安裝 [Node.js LTS](https://nodejs.org/)
3. 在該資料夾開啟 PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1
```

瀏覽器開 `http://127.0.0.1:43147`，再選  
`C:\Users\elvis\OneDrive\TeslausbCamModelX\SentryClips`。

### 方式 B：先建立正式倉庫再 clone

1. 在這個雲端對話點 **Create repo**
2. 複製 clone 網址後，在 PowerShell：

```powershell
cd $env:USERPROFILE\OneDrive
git clone <貼上 Create repo 後的網址> SentryClipsCleaner
cd SentryClipsCleaner
powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1
```

之後用 Cursor **File → Open Folder** 打開 `SentryClipsCleaner`，才算真正的本機 workspace。

## 本機執行

```bash
npm install
npm run dev -- --port 43147 --hostname 127.0.0.1
```

瀏覽器開啟提示的網址後：

1. 按「選擇 SentryClips 資料夾」
2. 選 `C:\Users\elvis\OneDrive\TeslausbCamModelX\SentryClips`，或上一層 `TeslausbCamModelX`
3. 調整「視為接近的間隔」（預設 3 分鐘）與保留策略
4. 核對紅色勾選項目
5. 若瀏覽器允許寫入，可直接刪除；否則下載 `.ps1` 腳本再執行

`SavedClips` 預設不會列入，避免誤刪手動保存的片段。

## 沒有資料夾選擇器時

- 用「瀏覽資料夾」選整個 `SentryClips`
- 或把 `dir` 的結果貼進去
- 這種方式只能分析與匯出腳本，不能由網頁直接刪檔

## 示範資料

「先用示範資料看看」會載入一週 Model X 哨兵紀錄，包含夜間行人、凌晨樹影與賣場停車的連續觸發。示範模式的刪除只改畫面清單。
