param(
    [int]$Port = 15022,
    [string]$Exe = (Join-Path $PSScriptRoot '..\target\debug\cdu-sim.exe')
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$server = Start-Process -FilePath $Exe -ArgumentList '--bind', "127.0.0.1:$Port", '--http', "127.0.0.1:$($Port + 1000)", '--no-noise', '--no-overrides', '--cold', '--valve-stroke', '2' `
    -WorkingDirectory $root -PassThru -WindowStyle Hidden

$exitCode = 1
try {
    $client = $null
    for ($i = 0; $i -lt 50; $i++) {
        try { $client = New-Object System.Net.Sockets.TcpClient('127.0.0.1', $Port); break } catch { Start-Sleep -Milliseconds 200 }
    }
    if (-not $client) { throw 'cannot connect' }
    $script:stream = $client.GetStream()
    $script:stream.ReadTimeout = 5000
    $script:txn = 0

    function U16([byte[]]$b, [int]$i) { ([int]$b[$i] -shl 8) -bor [int]$b[$i + 1] }

    function Send-Pdu([byte[]]$pdu) {
        $script:txn++
        $len = $pdu.Length + 1
        $frame = [byte[]]::new(7 + $pdu.Length)
        $frame[0] = ($script:txn -shr 8) -band 0xFF
        $frame[1] = $script:txn -band 0xFF
        $frame[5] = $len -band 0xFF
        $frame[6] = 1
        [Array]::Copy($pdu, 0, $frame, 7, $pdu.Length)
        $script:stream.Write($frame, 0, $frame.Length)
        $script:stream.Flush()
        $head = [byte[]]::new(7); $read = 0
        while ($read -lt 7) { $n = $script:stream.Read($head, $read, 7 - $read); if ($n -le 0) { throw 'closed' }; $read += $n }
        $rlen = (($head[4] -shl 8) -bor $head[5]) - 1
        $resp = [byte[]]::new($rlen); $read = 0
        while ($read -lt $rlen) { $n = $script:stream.Read($resp, $read, $rlen - $read); if ($n -le 0) { throw 'closed' }; $read += $n }
        return ,$resp
    }

    function RawToEng([int]$raw, [double]$lo, [double]$hi) {
        $lo + (($raw - 4000) / 16000.0) * ($hi - $lo)
    }

    Write-Host 'start pump 1 at 80%, valve 50%, let it settle 35 s ...'
    [void](Send-Pdu ([byte[]](0x05, 0, 16, 0xFF, 0x00)))
    [void](Send-Pdu ([byte[]](0x06, 0, 201, 0x41, 0xA0)))
    [void](Send-Pdu ([byte[]](0x06, 0, 200, 0x2E, 0xE0)))
    Start-Sleep -Seconds 35

    $r = Send-Pdu ([byte[]](0x03, 0, 111, 0, 1))
    $t22a = RawToEng (U16 $r 2) 0 80
    $r = Send-Pdu ([byte[]](0x03, 0, 109, 0, 1))
    $q2 = RawToEng (U16 $r 2) 0 60
    Write-Host ("  settled: T22 = {0:N2} C, Q2 = {1:N2} m3/h" -f $t22a, $q2)

    Write-Host 'close valve to 10%, wait 40 s ...'
    [void](Send-Pdu ([byte[]](0x06, 0, 200, 0x15, 0xE0)))
    Start-Sleep -Seconds 40

    $r = Send-Pdu ([byte[]](0x03, 0, 111, 0, 1))
    $t22b = RawToEng (U16 $r 2) 0 80
    $r = Send-Pdu ([byte[]](0x03, 0, 102, 0, 1))
    $q1 = RawToEng (U16 $r 2) 0 60
    Write-Host ("  after closing: T22 = {0:N2} C, Q1 = {1:N2} m3/h" -f $t22b, $q1)

    $delta = $t22b - $t22a
    if ($delta -gt 0.6) {
        Write-Host ("PASS: closing valve raised supply temp by {0:N2} K" -f $delta)
        $exitCode = 0
    } else {
        Write-Host ("FAIL: expected T22 to rise, delta = {0:N2} K" -f $delta)
    }
} finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}

exit $exitCode
