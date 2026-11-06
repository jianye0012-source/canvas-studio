$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
try {
  function Get-InstallRoot([string]$Directory) {
    $result = [IO.Path]::GetFullPath($Directory)
    if ((Split-Path (Split-Path $result -Parent) -Leaf) -eq '.versions') { $result = Split-Path (Split-Path $result -Parent) -Parent }
    return $result
  }
  $installRoot = $null
  $runningRoots = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq '画布工作台启动器' -and $_.Path } | ForEach-Object { Get-InstallRoot (Split-Path $_.Path -Parent) } | Select-Object -Unique)
  if ($runningRoots.Count -eq 1) { $installRoot = $runningRoots[0] }
  if (!$installRoot -and $runningRoots.Count -eq 0) {
    foreach ($candidate in @($PSScriptRoot, (Split-Path $PSScriptRoot -Parent))) {
      if (Test-Path -LiteralPath (Join-Path $candidate '画布工作台启动器.exe')) { $installRoot = Get-InstallRoot $candidate; break }
    }
  }
  if (!$installRoot) {
    Add-Type -AssemblyName System.Windows.Forms
    $picker = New-Object System.Windows.Forms.FolderBrowserDialog
    $picker.Description = '选择原画布工作台文件夹（里面有画布工作台启动器.exe）'
    $picker.ShowNewFolderButton = $false
    if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 0 }
    $installRoot = Get-InstallRoot $picker.SelectedPath
  }
  $runtimeNode = Join-Path $installRoot 'resources\bundle\runtime\node.exe'
  if (!(Test-Path -LiteralPath $runtimeNode) -or !(Test-Path -LiteralPath (Join-Path $installRoot 'package-manifest.json'))) { throw '所选目录不是完整的画布工作台整合包。' }
  Write-Host "将更新这个目录：$installRoot"
  $prefix = $installRoot.TrimEnd('\') + '\'
  $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -and $_.ProcessName -eq '画布工作台启动器' })
  foreach ($process in $running) { if ($process.MainWindowHandle -ne 0) { $null = $process.CloseMainWindow() } }
  foreach ($process in $running) {
    if (!$process.WaitForExit(45000)) { throw '启动器尚未退出。请先停止服务、关闭启动器，再运行本工具。' }
  }
  if (!$env:HTTPS_PROXY) {
    $proxy = [Net.WebRequest]::GetSystemWebProxy().GetProxy([Uri]'https://api.github.com/')
    if ($proxy.Host -ne 'api.github.com') { $env:HTTPS_PROXY = $proxy.AbsoluteUri; $env:HTTP_PROXY = $proxy.AbsoluteUri }
  }
  & $runtimeNode --use-env-proxy (Join-Path $PSScriptRoot 'upgrade-launcher.cjs') $installRoot
  exit $LASTEXITCODE
} catch {
  Write-Host ('启动器升级未完成：' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
