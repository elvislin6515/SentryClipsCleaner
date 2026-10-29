# -*- coding: utf-8 -*-
# Encoding: UTF-8 with BOM (Windows PowerShell 5.1 & PowerShell 7 相容)
# 由 SentryClips清理.cmd 呼叫。關閉那個視窗就會停掉本機服務。

[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8
$PSDefaultParameterValues['*:Encoding'] = 'utf8'

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
$Host.UI.RawUI.WindowTitle = "SentryClips 密集事件清理"

$port = 43147
$url = "http://127.0.0.1:$port"

function Stop-AppPort {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
      Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "這台電腦還沒有 Node.js。請先安裝 LTS：https://nodejs.org/"
  Read-Host "按 Enter 關閉"
  exit 1
}

if (-not (Test-Path -LiteralPath "node_modules\.bin\next.cmd")) {
  Write-Host "第一次使用（或套件不完整），正在安裝套件..."
  npm install
  if ($LASTEXITCODE -ne 0) {
    Read-Host "安裝失敗，按 Enter 關閉"
    exit 1
  }
}

$buildStamp = $null
if (Test-Path -LiteralPath ".next\BUILD_ID") {
  $buildStamp = (Get-Item -LiteralPath ".next\BUILD_ID").LastWriteTime
}
$newestSource = Get-ChildItem -Path "src" -Recurse -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
$needsBuild = -not $buildStamp -or ($newestSource -and $newestSource.LastWriteTime -gt $buildStamp)
if ($needsBuild) {
  Write-Host "正在建立正式版執行檔 (next build)..."
  npm run build
  if ($LASTEXITCODE -ne 0) {
    Read-Host "建立失敗，按 Enter 關閉"
    exit 1
  }
}

Write-Host ""
Write-Host "關閉這個視窗，服務就會停止。"
Write-Host "網址：$url"
Write-Host "下面會持續顯示執行 log（啟動、連線、掃描、錯誤）。"
Write-Host ""

Stop-AppPort

$opener = Start-Job -ScriptBlock {
  param($waitPort, $waitUrl)
  for ($i = 0; $i -lt 90; $i++) {
    try {
      $client = New-Object System.Net.Sockets.TcpClient
      $client.Connect("127.0.0.1", $waitPort)
      $client.Close()
      Start-Process $waitUrl
      return
    } catch {
      Start-Sleep -Seconds 1
    }
  }
} -ArgumentList $port, $url

$next = Join-Path $PSScriptRoot "node_modules\.bin\next.cmd"
$exitCode = 0
try {
  # PS 5.1 會把程式印到 stderr 的 log 當成錯誤；啟動後改回 Continue 才看得到 log、也不會被誤殺。
  $ErrorActionPreference = "Continue"
  Write-Host "---------- 執行 log ----------"
  & $next start --port $port --hostname 127.0.0.1
  $exitCode = $LASTEXITCODE
} finally {
  Stop-Job $opener -ErrorAction SilentlyContinue
  Remove-Job $opener -Force -ErrorAction SilentlyContinue
  Stop-AppPort
}

if ($exitCode -ne 0) {
  Write-Host ""
  Read-Host "服務異常結束 (代碼 $exitCode)，按 Enter 關閉"
  exit $exitCode
}
