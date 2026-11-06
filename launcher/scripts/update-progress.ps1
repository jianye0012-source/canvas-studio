param([string]$JobFile, [int]$UpdaterPid)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$job = Get-Content -LiteralPath $JobFile -Raw -Encoding UTF8 | ConvertFrom-Json
$directory = Split-Path $JobFile -Parent
$form = New-Object System.Windows.Forms.Form
$form.Text = '画布工作台 · 正在更新'
$form.Width = 520; $form.Height = 185; $form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'; $form.ControlBox = $false
$label = New-Object System.Windows.Forms.Label
$label.SetBounds(24, 22, 460, 52)
$label.Text = '正在更新启动器。完成后会自动打开新版，请稍候。'
$bar = New-Object System.Windows.Forms.ProgressBar
$bar.SetBounds(24, 86, 460, 20); $bar.Style = 'Marquee'
$form.Controls.AddRange(@($label, $bar))
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 500
$timer.Add_Tick({
  try {
    $state = Get-Content -LiteralPath (Join-Path $directory 'state.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($state.phase -eq 'complete' -or $state.phase -eq 'restored') { $form.Close(); return }
    if ($state.message) { $label.Text = $state.message }
    if ($null -ne $state.progress) { $bar.Style = 'Continuous'; $bar.Value = [Math]::Min(100, [Math]::Max(0, [int]$state.progress)) }
  } catch {}
  if (!(Get-Process -Id $UpdaterPid -ErrorAction SilentlyContinue)) {
    try {
      $last = Get-Content -LiteralPath (Join-Path $job.dataDir 'updates\last-install.json') -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($last.id -eq $job.id) { $form.Close(); return }
    } catch {}
    $timer.Stop(); $bar.Style = 'Continuous'; $form.ControlBox = $true
    $label.Text = '更新没有完成。请运行原程序目录中的「恢复未完成更新.cmd」。项目和素材仍保存在原数据目录。'
  }
})
$timer.Start()
$null = $form.ShowDialog()
$timer.Dispose(); $form.Dispose()
