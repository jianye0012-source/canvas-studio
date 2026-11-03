const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const unzipper = require('unzipper');
const { contained, verifyManifest, writableDirectory, requireFreeSpace, atomicJson } = require('./files.cjs');

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
  const bytes = archive.files.reduce((sum, entry) => sum + (entry.type === 'Directory' ? 0 : entry.uncompressedSize), 0);
  if (bytes > 5 * 1024 ** 3) throw new Error('发行包解压后体积异常');
  await requireFreeSpace(dataDir, bytes);
  const staging = path.join(dataDir, 'updates', crypto.randomUUID());
  await fs.mkdir(staging, { recursive: true });
  try {
    let total = 0; const seen = new Set();
    for (const entry of archive.files) {
      if (entry.type === 'Directory') continue;
      if (!entry.path.startsWith(prefix)) throw new Error('发行包包含异常路径');
      const relative = entry.path.slice(prefix.length);
      const normalized = relative.toLowerCase();
      if (seen.has(normalized)) throw new Error('发行包包含重复文件'); seen.add(normalized);
      if (!expected.has(relative) && relative !== 'package-manifest.json') continue;
      if (/^(?:data|work|outputs|\.versions)(?:\/|$)|^(?:portable\.json|managed-version\.json|launch-ready|next-active\.json)$/i.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..' || /[:. ]$|[:<>|?*]/.test(part))) throw new Error('发行包包含保留目录或无效文件路径');
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

const versionDirectory = /^[a-f0-9-]{36}$/;
const executableName = '画布工作台启动器.exe';
const psLiteral = value => "'" + String(value).replaceAll("'", "''") + "'";

function installationPaths(program) {
  const container = path.dirname(program);
  const root = path.basename(container) === '.versions' && versionDirectory.test(path.basename(program))
    ? path.dirname(container) : program;
  return { root, program, pointer: path.join(root, '.versions', 'active.json') };
}

async function prepareInstallation(staging, root, dataDir) {
  const manifest = JSON.parse(await fs.readFile(path.join(staging, 'package-manifest.json'), 'utf8'));
  const id = crypto.randomUUID();
  const directory = path.join(root, '.versions', id);
  await requireFreeSpace(root, manifest.files.reduce((sum, entry) => sum + entry.size, 0));
  try {
    await fs.mkdir(path.dirname(directory), { recursive: true });
    await fs.cp(staging, directory, { recursive: true, errorOnExist: true, force: false });
    await verifyManifest(directory, { filename: 'package-manifest.json' });
    // Historical launchers read a locator beside their own executable.
    await atomicJson(path.join(directory, 'portable.json'), { dataDir });
    await atomicJson(path.join(directory, 'managed-version.json'), { id });
    return { id, directory, version: manifest.version };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function installationScript({ id, directory, version }, root, parentPid, dataDir, staging, previousProgram) {
  return `$ErrorActionPreference = 'Stop'
$target = ${psLiteral(path.join(directory, executableName))}
$ack = ${psLiteral(path.join(directory, 'launch-ready'))}
$active = ${psLiteral(path.join(root, '.versions', 'active.json'))}
$next = ${psLiteral(path.join(directory, 'next-active.json'))}
$log = ${psLiteral(path.join(dataDir, 'logs', 'update.log'))}
$stage = ${psLiteral(staging)}
$child = $null
$committed = $false
try {
  Wait-Process -Id ${Number(parentPid)} -ErrorAction SilentlyContinue
  $env:CANVAS_STUDIO_TRIAL = ${psLiteral(id)}
  $child = Start-Process -FilePath $target -PassThru
  Remove-Item Env:CANVAS_STUDIO_TRIAL
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  while (!(Test-Path -LiteralPath $ack)) {
    $child.Refresh()
    if ($child.HasExited) { throw 'The new launcher exited during startup.' }
    if (${psLiteral(version)} -in @('1.2.0','1.3.2','1.3.3')) {
      if ($child.MainWindowHandle -ne 0) {
        Start-Sleep -Milliseconds 1200
        $child.Refresh()
        if ($child.HasExited) { throw 'The historical launcher exited during startup.' }
        break
      }
    }
    if ([DateTime]::UtcNow -gt $deadline) { throw 'The new launcher did not become ready.' }
    Start-Sleep -Milliseconds 250
  }
  [IO.File]::WriteAllText($next, ${psLiteral(JSON.stringify({ id }))})
  if ([IO.File]::Exists($active)) { [IO.File]::Replace($next, $active, [NullString]::Value) }
  else { [IO.File]::Move($next, $active) }
  $committed = $true
  $pendingFile = ${psLiteral(path.join(dataDir, 'updates', 'pending.json'))}
  if (Test-Path -LiteralPath $pendingFile) {
    $pending = Get-Content -LiteralPath $pendingFile -Raw | ConvertFrom-Json
    if ($pending.id -eq (Split-Path -Leaf $stage)) { Remove-Item -LiteralPath $pendingFile -Force }
  }
  Remove-Item -LiteralPath $stage -Recurse -Force
} catch {
  $_ | Out-File -LiteralPath $log -Encoding UTF8
  if (!$committed) {
    Remove-Item Env:CANVAS_STUDIO_TRIAL -ErrorAction SilentlyContinue
    if ($child -and !$child.HasExited) { Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue; Wait-Process -Id $child.Id -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath ${psLiteral(directory)} -Recurse -Force -ErrorAction SilentlyContinue
    Start-Process -FilePath ${psLiteral(path.join(previousProgram, executableName))}
  }
}
`;
}

async function applyUpdate(staging, destination, parentPid, dataDir, previousProgram = destination) {
  if (process.platform !== 'win32') throw new Error('自动应用更新需要在 Windows 整合包内执行');
  const prepared = await prepareInstallation(staging, destination, dataDir);
  const script = installationScript(prepared, destination, parentPid, dataDir, staging, previousProgram);
  const child = spawn('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { detached: true, windowsHide: true, stdio: 'ignore' });
  try { await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref(); }
  catch (error) { await fs.rm(prepared.directory, { recursive: true, force: true }); throw error; }
}

async function clearInactiveVersions(root, program) {
  const versions = path.join(root, '.versions');
  const active = await fs.readFile(path.join(versions, 'active.json'), 'utf8').then(JSON.parse, error => { if (error.code !== 'ENOENT') throw error; return {}; });
  const entries = await fs.readdir(versions, { withFileTypes: true }).catch(error => { if (error.code !== 'ENOENT') throw error; return []; });
  let removed = 0;
  for (const entry of entries) {
    const directory = path.join(versions, entry.name);
    if (!entry.isDirectory() || !versionDirectory.test(entry.name) || entry.name === active.id || directory === program) continue;
    const marker = await fs.readFile(path.join(directory, 'managed-version.json'), 'utf8').then(JSON.parse).catch(() => null);
    if (marker?.id !== entry.name) continue;
    await fs.rm(directory, { recursive: true, force: true }); removed++;
  }
  return removed;
}

module.exports = { stageUpdate, applyUpdate, installationPaths, installationScript, prepareInstallation, clearInactiveVersions, executableName, versionDirectory };
