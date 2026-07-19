param(
  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath,
  [string]$ExtensionId = "*"
)

$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$hostDirectory = Join-Path $env:LOCALAPPDATA "JobTrack\native-host"
$manifestPath = Join-Path $hostDirectory "com.vineet.jobtrack.json"
New-Item -ItemType Directory -Force -Path $hostDirectory | Out-Null

$manifest = [ordered]@{
  name = "com.vineet.jobtrack"
  description = "Local JobTrack default application profile provider"
  path = $resolvedExecutable
  type = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/")
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding UTF8

$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.vineet.jobtrack"
New-Item -Path $registryPath -Force | Out-Null
Set-ItemProperty -Path $registryPath -Name "(Default)" -Value $manifestPath
Write-Output "Registered com.vineet.jobtrack for $ExtensionId"
