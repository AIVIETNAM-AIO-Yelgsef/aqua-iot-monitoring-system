$ErrorActionPreference = "Stop"

$nodeRedDir = $PSScriptRoot
$runtimeDir = Join-Path $nodeRedDir "runtime"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$nodeRedScript = Join-Path $env:APPDATA "npm\node_modules\node-red\red.js"
$localConfig = Join-Path $nodeRedDir "config.local.ps1"

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

if (Test-Path -LiteralPath $localConfig) {
    . $localConfig
}

if ([string]::IsNullOrWhiteSpace($env:MQTT_BROKER_HOST)) {
    $env:MQTT_BROKER_HOST = "broker.hivemq.com"
}
if ([string]::IsNullOrWhiteSpace($env:MQTT_BROKER_PORT)) {
    $env:MQTT_BROKER_PORT = "1883"
}
if ([string]::IsNullOrWhiteSpace($env:MQTT_CLIENT_ID)) {
    $env:MQTT_CLIENT_ID = "nodered-hcmus-aqua-18"
}

$nodeRedOut = Join-Path $runtimeDir "node-red.log"
$nodeRedErr = Join-Path $runtimeDir "node-red-error.log"

$existingNodeRed = Get-NetTCPConnection -LocalPort 1880 -State Listen -ErrorAction SilentlyContinue
if (-not $existingNodeRed) {
    $nodeRed = Start-Process `
        -FilePath $nodeExe `
        -ArgumentList @("`"$nodeRedScript`"", "--userDir", "`"$nodeRedDir`"") `
        -WindowStyle Hidden `
        -RedirectStandardOutput $nodeRedOut `
        -RedirectStandardError $nodeRedErr `
        -PassThru

    Set-Content -LiteralPath (Join-Path $runtimeDir "node-red.pid") -Value $nodeRed.Id
}

$deadline = (Get-Date).AddSeconds(45)
do {
    Start-Sleep -Milliseconds 500
    $nodeRedReady = Get-NetTCPConnection -LocalPort 1880 -State Listen -ErrorAction SilentlyContinue
} until ($nodeRedReady -or ((Get-Date) -ge $deadline))

if (-not $nodeRedReady) {
    $detail = Get-Content -LiteralPath $nodeRedErr -Raw -ErrorAction SilentlyContinue
    throw "Node-RED khong khoi dong duoc. $detail"
}

Write-Host "Aqua IoT da khoi dong."
Write-Host "Aqua Web        : http://localhost:1880/"
Write-Host "Node-RED Editor : http://localhost:1880/red"
Write-Host "Dashboard ky thuat: http://localhost:1880/dashboard/aquarium"
Write-Host "MQTT Broker     : $($env:MQTT_BROKER_HOST):$($env:MQTT_BROKER_PORT) (public demo broker)"
Write-Host "MQTT Client ID  : $($env:MQTT_CLIENT_ID)"
Write-Host "MQTT Topic root : aqua-iot/nhom18-24127175-24127257/<deviceId>"
Write-Host "Log             : $runtimeDir"
