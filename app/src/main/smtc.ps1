param([string]$Mode = 'poll', [string]$Cmd = '', [string]$ArtFile = '')
# Reads and controls the Windows "now playing" session (Spotify first, otherwise any other player) through
# the system media controls. No account or login needed.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, $type) {
  $t = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  $null = $t.Wait(-1)
  $t.Result
}
function AwaitBool($op) { Await $op ([bool]) }

$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$ours = 'JJMP3|Z0|electron'

function Pick-Session {
  $all = @($mgr.GetSessions())
  $spot = $all | Where-Object { $_.SourceAppUserModelId -match 'Spotify' } | Select-Object -First 1
  if ($spot) { return $spot }
  $others = @($all | Where-Object { $_.SourceAppUserModelId -notmatch $ours })
  $cur = $mgr.GetCurrentSession()
  if ($cur -and $cur.SourceAppUserModelId -notmatch $ours) { return $cur }
  return ($others | Select-Object -First 1)
}

if ($Mode -eq 'cmd') {
  $s = Pick-Session
  if (-not $s) { Write-Output '{"ok":false}'; exit 0 }
  switch -wildcard ($Cmd) {
    'toggle' { $null = AwaitBool ($s.TryTogglePlayPauseAsync()) }
    'play'   { $null = AwaitBool ($s.TryPlayAsync()) }
    'pause'  { $null = AwaitBool ($s.TryPauseAsync()) }
    'next'   { $null = AwaitBool ($s.TrySkipNextAsync()) }
    'prev'   { $null = AwaitBool ($s.TrySkipPreviousAsync()) }
    'seek:*' { $secs = [double]$Cmd.Substring(5); $null = AwaitBool ($s.TryChangePlaybackPositionAsync([long]($secs * 10000000))) }
  }
  Write-Output '{"ok":true}'
  exit 0
}

# poll: one JSON line every 500 ms; the cover is written to $ArtFile when the song changes
$lastKey = ''
$artVersion = 0
while ($true) {
  try {
    $s = Pick-Session
    if (-not $s) {
      Write-Output '{"available":false}'
    } else {
      $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $tl = $s.GetTimelineProperties()
      $pb = $s.GetPlaybackInfo()
      $key = "$($props.Title)|$($props.Artist)|$($props.AlbumTitle)"
      if ($key -ne $lastKey) {
        $lastKey = $key
        $artVersion++
        if ($ArtFile) {
          if (Test-Path $ArtFile) { Remove-Item $ArtFile -Force }
          if ($props.Thumbnail) {
            try {
              $stream = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
              $asRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [type[]]@([Windows.Storage.Streams.IInputStream]))
              $net = $asRead.Invoke($null, @($stream))
              $ms = New-Object System.IO.MemoryStream
              $net.CopyTo($ms)
              [System.IO.File]::WriteAllBytes($ArtFile, $ms.ToArray())
              $net.Dispose(); $stream.Dispose()
            } catch { }
          }
        }
      }
      $obj = [ordered]@{
        available = $true
        app = $s.SourceAppUserModelId
        title = [string]$props.Title
        artist = [string]$props.Artist
        album = [string]$props.AlbumTitle
        playing = ($pb.PlaybackStatus -eq 4)
        pos = [math]::Round($tl.Position.TotalSeconds, 1)
        dur = [math]::Round($tl.EndTime.TotalSeconds - $tl.StartTime.TotalSeconds, 1)
        art = $artVersion
      }
      Write-Output ($obj | ConvertTo-Json -Compress)
    }
  } catch {
    Write-Output ('{"available":false,"error":' + (ConvertTo-Json ([string]$_.Exception.Message)) + '}')
  }
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 500
}
