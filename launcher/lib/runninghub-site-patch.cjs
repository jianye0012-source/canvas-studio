const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const files = ['lib/runninghub-standard.cjs', 'lib/config.cjs', 'lib/gateway.cjs', 'main.cjs', 'ui/app.js', 'ui/index.html'];
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function replaceFile(file, bytes) {
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx' });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}

async function applyRunningHubPatch(directory, patchDirectory = __dirname) {
  const manifestFile = path.join(directory, 'package-manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  const patch = JSON.parse(await fs.readFile(path.join(patchDirectory, 'patch.json'), 'utf8'));
  const entries = patch.versions?.[manifest.version];
  if (manifest.application !== 'canvas-studio' || manifest.platform !== 'win32-x64' || !Array.isArray(entries) || entries.length !== files.length) {
    throw new Error('此补丁仅适用于官方 Windows x64 的 1.3.8、1.3.10 和 1.3.11');
  }
  const changes = [];
  for (const relative of files) {
    const entry = entries.find(item => item.path === relative);
    const file = path.join(directory, 'resources', 'app', relative);
    if (!entry || await fs.realpath(path.dirname(file)) !== path.dirname(file) || !(await fs.lstat(file)).isFile()) throw new Error('启动器文件路径无效：' + relative);
    const before = await fs.readFile(file);
    const after = await fs.readFile(path.join(patchDirectory, 'payload', manifest.version, relative));
    const current = sha256(before);
    if (sha256(after) !== entry.after || (!entry.before.includes(current) && current !== entry.after)) throw new Error('文件与官方版本或本补丁不符：' + relative);
    const record = manifest.files.find(item => item.path === 'resources/app/' + relative);
    if (!record || record.sha256 !== current || record.size !== before.length) throw new Error('程序清单与文件不符：' + relative);
    Object.assign(record, { sha256: entry.after, size: after.length });
    if (current !== entry.after) changes.push({ file, before, after });
  }
  const applied = [];
  try {
    for (const change of changes) {
      await replaceFile(change.file, change.after);
      applied.push(change);
    }
    await replaceFile(manifestFile, JSON.stringify(manifest));
  } catch (error) {
    for (const change of applied.reverse()) await replaceFile(change.file, change.before);
    throw error;
  }
  return manifest.version;
}

module.exports = { applyRunningHubPatch };

if (require.main === module) {
  (async () => {
    const root = await fs.realpath(path.resolve(process.argv[2]));
    await fs.access(path.join(root, '画布工作台启动器.exe'));
    if (process.platform === 'win32') {
      const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$r=$env:CANVAS_SITE_PATCH_ROOT.TrimEnd("\\")+"\\"; Get-CimInstance Win32_Process -Filter "Name = \'画布工作台启动器.exe\'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($r,[StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $_.ProcessId }'], { env: { ...process.env, CANVAS_SITE_PATCH_ROOT: root }, windowsHide: true, timeout: 20000 });
      if (stdout.trim()) throw new Error('请先关闭此整合包的画布工作台启动器，再运行补丁');
    }
    let directory = root;
    try {
      const { id } = JSON.parse(await fs.readFile(path.join(root, '.versions', 'active.json'), 'utf8'));
      if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('当前版本记录无效');
      directory = path.join(root, '.versions', id);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (await fs.realpath(directory) !== directory) throw new Error('当前版本目录必须位于整合包内');
    const version = await applyRunningHubPatch(directory);
    console.log(`RunningHub 国内站补丁已应用到 ${version}。请打开启动器，在模型配置中选择国内站 .cn，检测渠道并保存。`);
  })().catch(error => { console.error('补丁应用失败：' + error.message); process.exitCode = 1; });
}
