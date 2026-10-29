# -*- coding: utf-8 -*-
# Encoding: UTF-8 with BOM (Windows PowerShell 5.1 & PowerShell 7 相容)
# 在專案根目錄執行：
# powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1

[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8
$PSDefaultParameterValues['*:Encoding'] = 'utf8'

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

Write-Host "檢查 Node.js..."
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "這台電腦還沒有 Node.js。請先安裝 LTS：https://nodejs.org/"
  exit 1
}

Write-Host "Node $($node.Source) / $(node -v)"
Write-Host "安裝套件..."
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "啟動本機網站 http://127.0.0.1:43147"
Write-Host "瀏覽器開啟後，選 TeslausbCamModelX\SentryClips 即可分析。"
npm run dev
