export const DEFAULT_SENTRY_ROOT =
  "C:\\Users\\elvis\\OneDrive\\TeslausbCamModelX\\SentryClips";

export function buildPowerShellScript(
  names: string[],
  rootPath = DEFAULT_SENTRY_ROOT,
): string {
  const list = names
    .map((name) => `  "${name.replace(/"/g, '`"')}"`)
    .join("\n");
  const safeRoot = rootPath.replace(/"/g, '`"');

  return `# -*- coding: utf-8 -*-
# UTF-8 with BOM. Windows PowerShell 5.1 and PowerShell 7 both read that encoding.
# SentryClips 密集事件清理
# 先確認路徑與清單，再執行。
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8
$PSDefaultParameterValues['*:Encoding'] = 'utf8'
$ErrorActionPreference = "Stop"
# 0x522A,0x9664 is 刪除. Built from code points so this check does not depend on the ANSI code page.
$encodingProbe = "刪除"
$encodingExpected = -join (0x522A, 0x9664 | ForEach-Object { [char]$_ })
if ($encodingProbe -ne $encodingExpected) {
  Write-Error "Encoding check failed. Nothing was deleted. Download the .ps1 again and run the command from the page."
  exit 1
}
$root = "${safeRoot}"
$folders = @(
${list}
)

Write-Host "刪除根目錄：$root"
if (-not (Test-Path -LiteralPath $root)) {
  Write-Error "找不到資料夾：$root"
  exit 1
}

$deleted = 0
$missing = 0
foreach ($name in $folders) {
  $path = Join-Path $root $name
  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Recurse -Force
    $deleted += 1
    Write-Host "已刪除 $name"
  } else {
    $missing += 1
    Write-Host "略過（不存在） $name"
  }
}

if ($deleted -eq 0) {
  Write-Error "這 $($folders.Count) 個資料夾都不在 $root。路徑指錯了，沒有刪除任何東西。請回網頁重新掃描正確的 SentryClips 後再下載腳本。"
  exit 1
}

Write-Host "完成。刪除 $deleted 個，略過 $missing 個。"
`;
}

export function buildFolderList(names: string[]): string {
  return names.join("\n") + (names.length ? "\n" : "");
}

export const CLEAN_SCRIPT_NAME = "clean-sentryclips.ps1";

export function buildScriptFileName(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
  return `clean-sentryclips-${stamp}.ps1`;
}

export function buildRunCommand(filename = CLEAN_SCRIPT_NAME): string {
  return `powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\\Downloads\\${filename}"`;
}

const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

// Windows PowerShell 5.1 treats a BOM-less script as the system ANSI code page
// (CP950, CP936, Windows-1252, ...). PowerShell 7 defaults to UTF-8. A UTF-8 BOM
// is the encoding both accept, including paths outside the active ANSI page.
export function encodeTextDownload(filename: string, content: string): Uint8Array<ArrayBuffer> {
  const text = /\.ps1$/i.test(filename) ? content.replace(/^\uFEFF/, "") : content;
  const body = new TextEncoder().encode(text);
  if (!/\.ps1$/i.test(filename)) return body;
  const bytes = new Uint8Array(UTF8_BOM.length + body.length);
  bytes.set(UTF8_BOM, 0);
  bytes.set(body, UTF8_BOM.length);
  return bytes;
}

export function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([encodeTextDownload(filename, content)], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
