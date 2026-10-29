# SentryClips 密集事件清理

[English](README.md)

Tesla USB / [teslausb](https://github.com/marcone/teslausb) 的哨兵資料夾名稱是時間戳，例如 `2026-08-20_22-14-02`。行人、樹影或風常會在幾分鐘內連續觸發，把 `SentryClips` 塞滿幾乎一樣的片段。

這個工具會在瀏覽器裡讀取資料夾名稱，把間隔太近的事件收成群組，預設每個密集群組只留第一筆，其餘勾選後可刪除，或匯出 PowerShell 腳本在 Windows 上清理。

影片不會上傳。分析都在你這台電腦進行。

![同一波哨兵裡，多餘的片段已被勾成將刪除](docs/screenshot.png)

別人會用這些字來找：`SentryClips 滿了`、`SentryClips disk full`、`delete duplicate sentry clips`。

## 下載

Windows 請下載[最新版本](https://github.com/elvislin6515/SentryClipsCleaner/releases/latest)，解壓縮，安裝 [Node.js LTS](https://nodejs.org/)，再雙擊 `start.cmd`。瀏覽器會打開 `http://127.0.0.1:43147`。

## 取得原始碼

```powershell
git clone https://github.com/elvislin6515/SentryClipsCleaner.git
cd SentryClipsCleaner
```

先安裝 [Node.js LTS](https://nodejs.org/)。

## 本機執行

```bash
npm install
npm run dev -- --port 43147 --hostname 127.0.0.1
```

Windows 也可以直接雙擊 `start.cmd`（或 `SentryClips清理.cmd`）。它會在需要時安裝套件、建立正式版，並開啟 `http://127.0.0.1:43147`。

1. 按「選擇 SentryClips 資料夾」，或掃描本機路徑，例如 `D:\TeslaCam\SentryClips`
2. 調整「視為接近的間隔」（預設 3 分鐘）與保留策略
3. 核對紅色勾選項目
4. 若瀏覽器允許寫入，可直接刪除；否則下載 `.ps1` 腳本再執行

`SavedClips` 預設不會列入，避免誤刪手動保存的片段。

介面預設是英文。右上角按 **繁中** 可切成繁體中文，選擇會記在這個瀏覽器。若系統語言是中文，而且你還沒手動選過，第一次開啟會直接用繁體中文。

## 沒有資料夾選擇器時

- 用「瀏覽資料夾」選整個 `SentryClips`
- 或把 `dir` 的結果貼進去

這種方式只能分析與匯出腳本，不能由網頁直接刪檔。

## 示範資料

「先用示範資料看看」會載入一週 Model X 哨兵紀錄，包含夜間行人、凌晨樹影與賣場停車的連續觸發。示範模式的刪除只改畫面清單。
