$ErrorActionPreference = "Stop"

$nodeRedDir = $PSScriptRoot
$runtimeDir = Join-Path $nodeRedDir "runtime"
$mosquittoExe = "C:\Program Files\mosquitto\mosquitto.exe"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$nodeRedScript = Join-Path $env:APPDATA "npm\node_modules\node-red\red.js"
$mosquittoConfig = Join-Path $env:TEMP "aqua-iot-mosquitto.conf"
$localConfig = Join-Path $nodeRedDir "config.local.ps1"

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

if (Test-Path -LiteralPath $localConfig) {
    . $localConfig
}

# Mosquitto for Windows cannot reliably open a config whose path contains
# Vietnamese characters. Keep the source in the project and copy it to a
# simple temporary path each time the stack starts.
Copy-Item -LiteralPath (Join-Path $nodeRedDir "mosquitto.conf") -Destination $mosquittoConfig -Force

$mosquittoOut = Join-Path $runtimeDir "mosquitto.log"
$mosquittoErr = Join-Path $runtimeDir "mosquitto-error.log"
$nodeRedOut = Join-Path $runtimeDir "node-red.log"
$nodeRedErr = Join-Path $runtimeDir "node-red-error.log"

$existingMosquitto = Get-NetTCPConnection -LocalPort 1884 -State Listen -ErrorAction SilentlyContinue
if (-not $existingMosquitto) {
    $mosquitto = Start-Process `
        -FilePath $mosquittoExe `
        -ArgumentList @("-c", "`"$mosquittoConfig`"", "-v") `
        -WindowStyle Hidden `
        -RedirectStandardOutput $mosquittoOut `
        -RedirectStandardError $mosquittoErr `
        -PassThru

    Set-Content -LiteralPath (Join-Path $runtimeDir "mosquitto.pid") -Value $mosquitto.Id
}

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
    $mqttReady = Get-NetTCPConnection -LocalPort 1884 -State Listen -ErrorAction SilentlyContinue
    $nodeRedReady = Get-NetTCPConnection -LocalPort 1880 -State Listen -ErrorAction SilentlyContinue
} until (($mqttReady -and $nodeRedReady) -or ((Get-Date) -ge $deadline))

if (-not $mqttReady) {
    $detail = Get-Content -LiteralPath $mosquittoErr -Raw -ErrorAction SilentlyContinue
    throw "Mosquitto khong khoi dong duoc. $detail"
}

if (-not $nodeRedReady) {
    $detail = Get-Content -LiteralPath $nodeRedErr -Raw -ErrorAction SilentlyContinue
    throw "Node-RED khong khoi dong duoc. $detail"
}

Write-Host "Aqua IoT da khoi dong."
Write-Host "Aqua Web        : http://localhost:1880/"
Write-Host "Node-RED Editor : http://localhost:1880/red"
Write-Host "Dashboard ky thuat: http://localhost:1880/dashboard/aquarium"
Write-Host "MQTT Broker     : 192.168.1.8:1884"
Write-Host "Log             : $runtimeDir"
