$runtimeDir = Join-Path $PSScriptRoot "runtime"
$expectedProcesses = @{
    "node-red" = "node"
    "mosquitto" = "mosquitto"
}

foreach ($name in @("node-red", "mosquitto")) {
    $pidFile = Join-Path $runtimeDir "$name.pid"

    if (Test-Path -LiteralPath $pidFile) {
        $processId = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue

        if ($processId) {
            $process = Get-Process -Id ([int]$processId) -ErrorAction SilentlyContinue

            # PID can be reused after a crash/reboot. Only stop the process type
            # that this project actually started.
            if ($process -and $process.ProcessName -eq $expectedProcesses[$name]) {
                Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
            }
        }

        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "Da dung cac tien trinh Aqua IoT do script khoi dong."
