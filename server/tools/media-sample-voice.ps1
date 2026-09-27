param([Parameter(Mandatory=$true)][string]$Manifest)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$mediaSampleVoice = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $mediaSampleVoice.SelectVoice('Microsoft Huihui Desktop')
  $mediaSampleVoice.Rate = -1
  foreach ($entry in (Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json)) {
    $mediaSampleVoice.SetOutputToWaveFile($entry.path)
    $mediaSampleVoice.Speak($entry.text)
  }
} finally { $mediaSampleVoice.Dispose() }
