param(
    [int]$Port = 15023,
    [string]$Exe = (Join-Path $PSScriptRoot '..\target\debug\cdu-sim.exe')
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$http = "http://127.0.0.1:$($Port + 1000)"

$server = Start-Process -FilePath $Exe -ArgumentList '--bind', "127.0.0.1:$Port", '--http', "127.0.0.1:$($Port + 1000)", '--no-noise', '--no-overrides', '--cold' `
    -WorkingDirectory $root -PassThru -WindowStyle Hidden

$exitCode = 1
try {
    for ($i = 0; $i -lt 50; $i++) {
        try {
            Invoke-WebRequest -Uri "$http/api/points" -UseBasicParsing -TimeoutSec 2 | Out-Null
            break
        } catch {
            Start-Sleep -Milliseconds 200
        }
    }

    function Put($path, $body) {
        Invoke-WebRequest -Uri "$http$path" -Method Put -ContentType 'application/json' -Body $body -UseBasicParsing | Out-Null
    }

    Put '/api/points/PUMP1_RUN_CMD' '{"on":true}'
    Start-Sleep -Seconds 2
    Put '/api/points/PUMP1_SPEED_CMD' '{"value":80}'
    Put '/api/points/VALVE_CMD' '{"value":100}'
    Put '/api/plant' '{"facility_c":20,"return_c":50}'
    Start-Sleep -Seconds 4

    $p = (Invoke-WebRequest -Uri "$http/api/points" -UseBasicParsing).Content | ConvertFrom-Json
    $m = @{}
    foreach ($x in $p.points) { $m[$x.id] = $x }

    $q1 = [double]$m['Q1'].v
    $q2 = [double]$m['Q2'].v
    $t11 = [double]$m['T11'].v
    $t12 = [double]$m['T12'].v
    $t21 = [double]$m['T21'].v
    $t22 = [double]$m['T22'].v

    # 1 m3/h 水的热容流率 = 1.161 kW/K
    $primary = $q1 * 1.161 * ($t12 - $t11)
    $secondary = $q2 * 1.161 * ($t21 - $t22)

    Write-Host ("Q1={0:N2} Q2={1:N2} m3/h  T11={2:N2} T12={3:N2} T21={4:N2} T22={5:N2}" -f $q1, $q2, $t11, $t12, $t21, $t22)
    Write-Host ("primary={0:N2} kW  secondary={1:N2} kW" -f $primary, $secondary)

    $err = [math]::Abs($primary - $secondary) / [math]::Max([math]::Abs($primary), 0.001)
    if ($err -lt 0.01) {
        Write-Host ("PASS energy balance, error = {0:P3}" -f $err)
        $exitCode = 0
    } else {
        Write-Host ("FAIL energy balance, error = {0:P2}" -f $err)
    }
} finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}

exit $exitCode
