const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const unzipper = require('unzipper');
const { contained, verifyManifest, writableDirectory } = require('./files.cjs');

async function stageUpdate(zipFile, dataDir) {
  await writableDirectory(dataDir);
  const archive = await unzipper.Open.file(zipFile);
  const manifests = archive.files.filter(entry => /(^|\/)package-manifest\.json$/.test(entry.path));
  if (manifests.length !== 1) throw new Error('这不是完整的画布工作台发行包');
  const prefix = manifests[0].path.slice(0, -'package-manifest.json'.length);
  const manifest = JSON.parse((await manifests[0].buffer()).toString('utf8'));
  if (manifest.application !== 'canvas-studio' || manifest.platform !== 'win32-x64' || manifest.format !== 1 || !Array.isArray(manifest.files)) throw new Error('发行包类型或平台不匹配');
  const expected = new Set(manifest.files.map(entry => entry.path));
  if (!expected.has('画布工作台启动器.exe') || !expected.has('resources/bundle/runtime/node.exe')) throw new Error('发行包缺少启动器或运行环境');
  const staging = path.join(dataDir, 'updates', crypto.randomUUID());
  await fs.mkdir(staging, { recursive: true });
  try {
    let total = 0; const seen = new Set();
    for (const entry of archive.files) {
      if (entry.type === 'Directory') continue;
      if (!entry.path.startsWith(prefix)) throw new Error('发行包包含异常路径');
      const relative = entry.path.slice(prefix.length);
      if (seen.has(relative)) throw new Error('发行包包含重复文件'); seen.add(relative);
      if (!expected.has(relative) && relative !== 'package-manifest.json') continue;
      if (/^(data|work|outputs)\//.test(relative) || relative === 'portable.json') throw new Error('发行包不能覆盖用户数据');
      if ((entry.externalFileAttributes >>> 16 & 0xf000) === 0xa000) throw new Error('发行包包含符号链接');
      total += entry.uncompressedSize; if (total > 5 * 1024 ** 3) throw new Error('发行包解压后体积异常');
      const target = contained(staging, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await require('node:stream/promises').pipeline(entry.stream(), require('node:fs').createWriteStream(target, { flags: 'wx' }));
    }
    await verifyManifest(staging, { filename: 'package-manifest.json' });
    return staging;
  } catch (error) { await fs.rm(staging, { recursive: true, force: true }); throw error; }
}

const psLiteral = value => "'" + String(value).replaceAll("'", "''") + "'";
async function applyUpdate(staging, destination, parentPid, dataDir) {
  if (process.platform !== 'win32') throw new Error('自动应用更新需要在 Windows 整合包内执行');
  const helper = path.join(dataDir, 'updates', 'apply-update.ps1');
  const script = `\uFEFF$ErrorActionPreference = 'Stop'\n$taskStage = ${psLiteral(staging)}\n$taskRoot = ${psLiteral(destination)}\n$taskLog = ${psLiteral(path.join(dataDir, 'logs', 'update.log'))}\ntry {\n  Wait-Process -Id ${Number(parentPid)} -ErrorAction SilentlyContinue\n  Start-Sleep -Milliseconds 800\n  $taskManifest = Get-Content -LiteralPath (Join-Path $taskStage 'package-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json\n  foreach ($taskEntry in $taskManifest.files) {\n    $taskTarget = Join-Path $taskRoot $taskEntry.path\n    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $taskTarget) | Out-Null\n    Copy-Item -LiteralPath (Join-Path $taskStage $taskEntry.path) -Destination $taskTarget -Force\n  }\n  Copy-Item -LiteralPath (Join-Path $taskStage 'package-manifest.json') -Destination $taskRoot -Force\n  Remove-Item -LiteralPath $taskStage -Recurse -Force\n  Start-Process -FilePath (Join-Path $taskRoot '画布工作台启动器.exe')\n} catch { $_ | Out-File -LiteralPath $taskLog -Encoding UTF8; Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('更新未完成，请重新解压完整整合包。原数据目录仍保留。详见：' + $taskLog) | Out-Null }\n`;
  await fs.writeFile(helper, script, 'utf8');
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper], { detached: true, windowsHide: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
}
module.exports = { stageUpdate, applyUpdate };
