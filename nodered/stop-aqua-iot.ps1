$runtimeDir = Join-Path $PSScriptRoot "runtime"
$pidFile = Join-Path $runtimeDir "node-red.pid"

if (Test-Path -LiteralPath $pidFile) {
    $processId = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue

    if ($processId) {
        $process = Get-Process -Id ([int]$processId) -ErrorAction SilentlyContinue

        # PID can be reused after a crash/reboot. Only stop Node.js started by this project.
        if ($process -and $process.ProcessName -eq "node") {
            Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
        }
    }

    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

Write-Host "Da dung Node-RED cua Aqua IoT. EMQX la broker public, khong chay tren may nay."
