param(
    [int]$Port = 15021,
    [string]$Exe = (Join-Path $PSScriptRoot '..\target\debug\cdu-sim.exe')
)

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$http = "http://127.0.0.1:$($Port + 1000)"

$server = Start-Process -FilePath $Exe -ArgumentList '--bind', "127.0.0.1:$Port", '--http', "127.0.0.1:$($Port + 1000)", '--no-noise', '--no-overrides', '--cold', '--valve-stroke', '2' `
    -WorkingDirectory $root -PassThru -WindowStyle Hidden

$script:failed = 0
$script:pointMeta = @{}

function U16([byte[]]$b, [int]$i) {
    ([int]$b[$i] -shl 8) -bor [int]$b[$i + 1]
}

function Send-Pdu([byte[]]$pdu) {
    $script:txn = ($script:txn + 1) -band 0xFFFF
    $len = $pdu.Length + 1
    $frame = [byte[]]::new(7 + $pdu.Length)
    $frame[0] = ($script:txn -shr 8) -band 0xFF
    $frame[1] = $script:txn -band 0xFF
    $frame[2] = 0
    $frame[3] = 0
    $frame[4] = ($len -shr 8) -band 0xFF
    $frame[5] = $len -band 0xFF
    $frame[6] = 1
    [Array]::Copy($pdu, 0, $frame, 7, $pdu.Length)
    $script:stream.Write($frame, 0, $frame.Length)
    $script:stream.Flush()

    $head = [byte[]]::new(7)
    $read = 0
    while ($read -lt 7) {
        $n = $script:stream.Read($head, $read, 7 - $read)
        if ($n -le 0) { throw 'connection closed' }
        $read += $n
    }
    $rlen = (($head[4] -shl 8) -bor $head[5]) - 1
    $resp = [byte[]]::new($rlen)
    $read = 0
    while ($read -lt $rlen) {
        $n = $script:stream.Read($resp, $read, $rlen - $read)
        if ($n -le 0) { throw 'connection closed' }
        $read += $n
    }
    return ,$resp
}

function Check([string]$name, $actual, $expected, [double]$tol = 0.5) {
    if ([math]::Abs([double]$actual - [double]$expected) -le $tol) {
        Write-Host ("  PASS  {0,-30} = {1}" -f $name, $actual)
    } else {
        $script:failed++
        Write-Host ("  FAIL  {0,-30} = {1} (expected {2})" -f $name, $actual, $expected)
    }
}

# Decode using the point's own range/signal range, so the test does not
# depend on the configured engineering units (bar or PSI).
function RawToEng([string]$id, [double]$raw) {
    $p = $script:pointMeta[$id]
    $sigSpan = $p.signal_range[1] - $p.signal_range[0]
    $engSpan = $p.range[1] - $p.range[0]
    $p.range[0] + (($raw - $p.signal_range[0]) / $sigSpan) * $engSpan
}

$exitCode = 1
try {
    $client = $null
    for ($i = 0; $i -lt 50; $i++) {
        try {
            $client = New-Object System.Net.Sockets.TcpClient('127.0.0.1', $Port)
            break
        } catch {
            Start-Sleep -Milliseconds 200
        }
    }
    if (-not $client) { throw "cannot connect to 127.0.0.1:$Port" }

    $script:stream = $client.GetStream()
    $script:stream.ReadTimeout = 5000
    $script:txn = 0

    $meta = (Invoke-WebRequest -Uri "$http/api/points" -UseBasicParsing).Content | ConvertFrom-Json
    foreach ($x in $meta.points) { $script:pointMeta[$x.id] = $x }

    Write-Host '== 1. raw signal registers (FC3, 100..107) =='
    $r = Send-Pdu ([byte[]](0x03, 0, 100, 0, 8))
    if ($r[0] -ne 0x03 -or $r[1] -ne 16) { throw 'bad FC3 response' }
    Check 'P10 (eng)' (RawToEng 'P10' (U16 $r 2)) 4.5 0.05
    Check 'P11 (eng)' (RawToEng 'P11' (U16 $r 4)) 4.5 0.05
    Check 'Q1 (eng)' (RawToEng 'Q1' (U16 $r 6)) 0 0.05
    Check 'T11 (eng)' (RawToEng 'T11' (U16 $r 8)) 30 0.05
    Check 'T12 (eng)' (RawToEng 'T12' (U16 $r 10)) 30 0.05
    Check 'P12 (eng)' (RawToEng 'P12' (U16 $r 12)) 4.5 0.05
    Check 'P13 (eng)' (RawToEng 'P13' (U16 $r 14)) 4.5 0.05
    Check 'P20 (eng)' (RawToEng 'P20' (U16 $r 16)) 3.5 0.05

    Write-Host '== 2. write valve 50% (12000 uA, FC6) =='
    $r = Send-Pdu ([byte[]](0x06, 0, 200, 0x2E, 0xE0))
    Check 'echo fc' $r[0] 6
    Check 'echo addr' (U16 $r 1) 200
    Check 'echo value' (U16 $r 3) 12000
    $r = Send-Pdu ([byte[]](0x03, 0, 200, 0, 1))
    Check 'VALVE_CMD raw' (U16 $r 2) 12000

    Write-Host '== 3. valve travel (wait 2 s) =='
    Start-Sleep -Seconds 2
    $r = Send-Pdu ([byte[]](0x03, 0, 116, 0, 1))
    Check 'VALVE_POS (%)' (RawToEng 'VALVE_POS' (U16 $r 2)) 50 1

    Write-Host '== 4. start pump 1 (FC5) =='
    [void](Send-Pdu ([byte[]](0x05, 0, 16, 0xFF, 0x00)))
    Start-Sleep -Seconds 2
    $r = Send-Pdu ([byte[]](0x01, 0, 0, 0, 8))
    Check 'PUMP1_RUN' ([int](($r[2] -band 0x01) -ne 0)) 1
    Check 'PUMP2_RUN' ([int](($r[2] -band 0x02) -ne 0)) 0

    Write-Host '== 5. ramp pump 1 to 80% =='
    [void](Send-Pdu ([byte[]](0x06, 0, 201, 0x41, 0xA0)))
    Start-Sleep -Seconds 2
    $r = Send-Pdu ([byte[]](0x03, 0, 109, 0, 1))
    Check 'Q2 (eng) @80%' (RawToEng 'Q2' (U16 $r 2)) 20 0.5
    $r = Send-Pdu ([byte[]](0x03, 0, 112, 0, 1))
    Check 'P22 (eng) @80%' (RawToEng 'P22' (U16 $r 2)) 3.74 0.02

    Write-Host '== 6. write to read-only point must fail =='
    $r = Send-Pdu ([byte[]](0x06, 0, 101, 0, 1))
    Check 'exception fc' $r[0] 0x86
    Check 'exception code' $r[1] 0x02

    Write-Host '== 7. undefined address reads as zero =='
    $r = Send-Pdu ([byte[]](0x03, 0x23, 0x28, 0, 2))
    Check 'addr 9000' (U16 $r 2) 0
    Check 'addr 9001' (U16 $r 4) 0

    if ($script:failed -eq 0) {
        Write-Host "`nALL PASSED"
        $exitCode = 0
    } else {
        Write-Host "`n$($script:failed) FAILED"
    }
} finally {
    if ($server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    }
}

exit $exitCode
