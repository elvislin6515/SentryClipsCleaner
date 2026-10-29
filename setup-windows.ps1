# -*- coding: utf-8 -*-
# Encoding: UTF-8 with BOM. Windows PowerShell 5.1 and PowerShell 7.
# Run from the project root:
# powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1

$zh = ([System.Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName -eq "zh")
function L([string]$en, [string]$zhText) { if ($zh) { $zhText } else { $en } }

[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8
$PSDefaultParameterValues['*:Encoding'] = 'utf8'

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

Write-Host (L "Checking Node.js..." "檢查 Node.js...")
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host (L "Node.js is not installed. Install the LTS build: https://nodejs.org/" "這台電腦還沒有 Node.js。請先安裝 LTS：https://nodejs.org/")
  exit 1
}

Write-Host "Node $($node.Source) / $(node -v)"
Write-Host (L "Installing packages..." "安裝套件...")
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host (L "Starting http://127.0.0.1:43147" "啟動本機網站 http://127.0.0.1:43147")
Write-Host (L "After the browser opens, choose your TeslaCam\SentryClips folder." "瀏覽器開啟後，選 TeslaCam\SentryClips 即可分析。")
npm run dev
