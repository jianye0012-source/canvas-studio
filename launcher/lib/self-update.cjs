const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { atomicJson, contained, verifyManifest, writableDirectory, requireFreeSpace } = require('./files.cjs');
const { terminateChild } = require('./process-control.cjs');

const executable = '画布工作台启动器.exe';
const optional = file => fs.readFile(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
const quote = value => "'" + value.replaceAll("'", "''") + "'";
function entries(manifest) {
  if (manifest.application !== 'canvas-studio' || manifest.format !== 1 || manifest.platform !== 'win32-x64' || !Array.isArray(manifest.files)) throw new Error('程序文件清单无效');
  const names = ['package-manifest.json', ...manifest.files.map(entry => entry.path)];
  const seen = new Set();
  for (const name of names) {
    if (typeof name !== 'string' || /^(?:data|work|outputs|\.versions|\.updates)(?:\/|$)|^(?:portable\.json|managed-version\.json|launch-ready|next-active\.json)$/i.test(name) || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..' || /[:. ]$|[:<>|?*\0]/.test(part)) || seen.has(name.toLowerCase())) throw new Error('程序清单包含保留目录或异常路径');
    seen.add(name.toLowerCase());
  }
  if (!seen.has(executable.toLowerCase()) || !seen.has('resources/bundle/runtime/node.exe')) throw new Error('程序清单缺少启动器或运行环境');
  return names;
}
async function safeFile(root, name) {
  const file = contained(root, name);
  for (let directory = path.dirname(file); directory !== root; directory = path.dirname(directory)) {
    const stat = await fs.lstat(directory).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error('程序目录包含异常链接：' + name);
  }
  const stat = await fs.lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (stat && !stat.isFile()) throw new Error('程序文件类型异常：' + name);
  return { file, exists: Boolean(stat) };
}
async function copy(source, target) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = target + '.' + crypto.randomUUID() + '.tmp';
  try {
    await fs.copyFile(source, temporary);
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(temporary, target); break; }
      catch (error) { if (attempt >= 20 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error; await delay(250); }
    }
  }
  finally { await fs.rm(temporary, { force: true }); }
}
async function readJob(file) {
  const job = JSON.parse(await fs.readFile(file, 'utf8'));
  const directory = path.dirname(file);
  if (job.format !== 1 || !/^[a-f0-9-]{36}$/.test(job.id) || directory !== path.join(job.root, '.updates', job.id) || await fs.realpath(job.root) !== job.root || await fs.realpath(directory) !== directory || !Number.isSafeInteger(job.pid) || job.pid <= 0) throw new Error('更新任务记录无效');
  if (path.dirname(job.staging) !== path.join(job.dataDir, 'updates') || !/^[a-f0-9-]{36}$/.test(path.basename(job.staging))) throw new Error('更新暂存目录无效');
  entries(job.previous); entries(job.next);
  return job;
}
async function log(job, message) {
  await fs.appendFile(path.join(job.dataDir, 'logs/update.log'), new Date().toISOString() + ' ' + message + '\n');
}
async function waitForExit(pid, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
    await delay(250);
  }
  throw new Error('启动器尚未退出，已停止更新；请关闭启动器后重试');
}
async function launch(job, receipt) {
  const child = spawn(path.join(job.root, executable), [], { cwd: job.root, detached: true, stdio: 'ignore', env: { ...process.env, NODE_OPTIONS: undefined, CANVAS_STUDIO_UPDATE_RECEIPT: receipt ? path.join(job.root, '.updates', job.id, 'job.json') : '', CANVAS_STUDIO_UPDATE_FAILED: receipt ? '' : '1' } });
  child.on('error', error => { child.launchError = error; });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  if (!receipt) { child.unref(); return; }
  try {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (child.launchError || child.exitCode !== null || child.signalCode !== null) throw new Error('新版启动器在完成界面初始化前退出');
      const ready = await optional(path.join(job.root, '.updates', job.id, 'ready.json'));
      if (ready) {
        const value = JSON.parse(ready);
        if (value.id === job.id && value.pid === child.pid && value.version === job.next.version) { child.unref(); return; }
      }
      await delay(250);
    }
    throw new Error('新版界面未在一分钟内就绪，正在恢复原程序');
  } catch (error) { await terminateChild(child, true); throw error; }
}
async function rollback(job, directory) {
  for (const name of entries(job.next)) {
    const target = await safeFile(job.root, name);
    if (target.exists) await fs.rm(target.file);
  }
  for (const name of entries(job.previous)) {
    const saved = await optional(path.join(directory, 'previous', name));
    if (saved) await copy(path.join(directory, 'previous', name), (await safeFile(job.root, name)).file);
  }
  const pointer = path.join(job.root, '.versions/active.json');
  if (job.pointer) await atomicJson(pointer, job.pointer);
  else await fs.rm(pointer, { force: true });
}
async function applySelfUpdate(jobFile, { start = launch, cleanup = true } = {}) {
  const job = await readJob(jobFile), directory = path.dirname(jobFile);
  const stateFile = path.join(directory, 'state.json');
  const state = JSON.parse((await optional(stateFile)) || '{}');
  const previous = entries(job.previous), next = entries(job.next);
  if (state.phase === 'complete' || state.phase === 'restored') return state.phase;
  try {
    await writableDirectory(job.dataDir);
    await fs.mkdir(path.join(job.dataDir, 'logs'), { recursive: true });
    if (state.phase === 'replacing') throw new Error('上次更新中断，先恢复原程序');
    await verifyManifest(path.join(directory, 'next'), { filename: 'package-manifest.json' });
    await atomicJson(stateFile, { phase: 'preparing', progress: 5, message: '正在准备替换程序，项目和素材继续保存在原目录。' });
    for (const name of previous) {
      const source = await safeFile(job.root, name);
      if (source.exists) await copy(source.file, path.join(directory, 'previous', name));
    }
    for (const name of next) {
      const target = await safeFile(job.root, name);
      if (target.exists && !previous.includes(name)) throw new Error('新程序文件与现有额外文件冲突：' + name);
    }
    await atomicJson(stateFile, { phase: 'replacing', progress: 30, message: '正在替换启动器和工作台程序…' });
    await log(job, '开始替换程序 ' + job.previous.version + ' -> ' + job.next.version);
    let copied = 0;
    for (const name of next) {
      await copy(path.join(directory, 'next', name), (await safeFile(job.root, name)).file);
      if (++copied % 200 === 0) await atomicJson(stateFile, { phase: 'replacing', progress: 30 + Math.floor(55 * copied / next.length), message: `正在替换程序文件 ${copied}/${next.length}…` });
    }
    for (const name of previous.filter(name => !next.includes(name))) {
      const target = await safeFile(job.root, name);
      if (target.exists) await fs.rm(target.file);
    }
    await fs.rm(path.join(job.root, '.versions/active.json'), { force: true });
    await atomicJson(stateFile, { phase: 'replacing', progress: 90, message: '正在自动打开新版，等待界面完成初始化…' });
    await start(job, true);
    await atomicJson(stateFile, { phase: 'complete' });
    await atomicJson(path.join(job.dataDir, 'updates/last-install.json'), { id: job.id, version: job.next.version, success: true, message: '已自动更新并重新打开' });
    await log(job, '新版界面已就绪，更新完成 ' + job.next.version);
  } catch (error) {
    const current = JSON.parse((await optional(stateFile)) || '{}');
    if (current.phase === 'replacing') {
      await rollback(job, directory);
      await atomicJson(stateFile, { phase: 'restored' });
      await atomicJson(path.join(job.dataDir, 'updates/last-install.json'), { id: job.id, version: job.previous.version, failedVersion: job.next.version, success: false, message: error.message });
      await log(job, '更新失败，已恢复原程序：' + error.message);
      await start(job, false);
    }
    throw error;
  }
  if (cleanup) {
    const { clearInactiveVersions } = require(path.join(job.root, 'resources/app/lib/update.cjs'));
    await clearInactiveVersions(job.root, job.root, job.dataDir).catch(error => log(job, '旧版本目录稍后清理：' + error.message));
    await fs.rm(job.staging, { recursive: true, force: true }).catch(() => {});
    const pending = JSON.parse((await optional(path.join(job.dataDir, 'updates/pending.json'))) || '{}');
    if (pending.version === job.next.version) await fs.rm(path.join(job.dataDir, 'updates/pending.json'), { force: true });
    const download = path.join(job.dataDir, 'updates/downloads', `CanvasStudio-Windows-x64-${job.next.version}.zip`);
    await fs.rm(download, { force: true }).catch(() => {});
  }
  return 'complete';
}
async function prepareSelfUpdate(staging, root, dataDir, pid = process.pid) {
  root = await fs.realpath(root);
  await writableDirectory(root); await writableDirectory(dataDir);
  const previous = JSON.parse(await fs.readFile(path.join(root, 'package-manifest.json'), 'utf8'));
  const next = JSON.parse(await fs.readFile(path.join(staging, 'package-manifest.json'), 'utf8'));
  entries(previous); entries(next);
  if (next.updateProtocol !== 2) throw new Error('此版本不支持自动替换启动器，请选择支持自动更新的正式版');
  if (dataDir === root || dataDir === path.join(root, '.updates') || dataDir.startsWith(path.join(root, '.updates') + path.sep)) throw new Error('数据目录与更新程序目录冲突，请先在存储设置选择独立数据目录');
  const id = crypto.randomUUID(), directory = path.join(root, '.updates', id);
  await requireFreeSpace(root, [...previous.files, ...next.files].reduce((sum, entry) => sum + entry.size, 0) + 150 * 1024 ** 2);
  await fs.mkdir(directory, { recursive: true });
  try {
    if (await fs.realpath(directory) !== directory) throw new Error('更新目录不能使用链接或重定向目录');
    await fs.cp(staging, path.join(directory, 'next'), { recursive: true });
    await verifyManifest(path.join(directory, 'next'), { filename: 'package-manifest.json' });
    for (const name of ['self-update.cjs', 'files.cjs', 'process-control.cjs']) await fs.copyFile(path.join(__dirname, name), path.join(directory, name));
    await fs.writeFile(path.join(directory, 'progress.ps1'), '\uFEFF' + await fs.readFile(path.join(__dirname, '../scripts/update-progress.ps1'), 'utf8'));
    await fs.copyFile(path.join(root, 'resources/bundle/runtime/node.exe'), path.join(directory, 'node.exe'));
    const pointer = JSON.parse((await optional(path.join(root, '.versions/active.json'))) || 'null');
    const jobFile = path.join(directory, 'job.json');
    await atomicJson(jobFile, { format: 1, id, root, dataDir, pid, staging, previous, next, pointer });
    await fs.writeFile(path.join(root, '恢复未完成更新.cmd'), `@echo off\r\nsetlocal DisableDelayedExpansion\r\nchcp 65001 >nul\r\n"%~dp0.updates\\${id}\\node.exe" "%~dp0.updates\\${id}\\self-update.cjs" "%~dp0.updates\\${id}\\job.json"\r\npause\r\n`);
    return jobFile;
  } catch (error) { await fs.rm(directory, { recursive: true, force: true }); throw error; }
}
async function startSelfUpdate(jobFile) {
  await readJob(jobFile);
  const directory = path.dirname(jobFile);
  const child = spawn(path.join(directory, 'node.exe'), [path.join(directory, 'self-update.cjs'), jobFile], { cwd: directory, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('更新助手未能启动，原程序保持运行')), 15000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('更新助手提前退出，原程序保持运行')); });
    child.once('message', value => { clearTimeout(timeout); value.ready ? resolve() : reject(new Error(value.error)); });
  });
  child.disconnect(); child.unref();
}
async function markUpdateReady(jobFile, root, dataDir, version, pid = process.pid) {
  const job = await readJob(jobFile);
  if (job.root !== root || job.dataDir !== dataDir || job.next.version !== version) throw new Error('更新启动校验不匹配');
  await atomicJson(path.join(path.dirname(jobFile), 'ready.json'), { id: job.id, version, pid });
}
module.exports = { prepareSelfUpdate, startSelfUpdate, applySelfUpdate, markUpdateReady, waitForExit };
if (require.main === module) {
  (async () => {
    const jobFile = path.resolve(process.argv[2]), job = await readJob(jobFile);
    if (process.connected) process.send({ ready: true });
    await waitForExit(job.pid);
    if (process.platform === 'win32') spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', path.join(path.dirname(jobFile), 'progress.ps1'), '-JobFile', jobFile, '-UpdaterPid', String(process.pid)], { cwd: job.root, detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
    try { await applySelfUpdate(jobFile); }
    finally {
      const state = JSON.parse((await optional(path.join(path.dirname(jobFile), 'state.json'))) || '{}');
      if (['complete', 'restored'].includes(state.phase)) {
        const recovery = path.join(job.root, '恢复未完成更新.cmd');
        if ((await optional(recovery))?.includes(Buffer.from(job.id))) await fs.rm(recovery, { force: true });
        if (process.platform === 'win32') {
          const script = `Wait-Process -Id ${process.pid} -ErrorAction SilentlyContinue; Remove-Item -LiteralPath ${quote(path.dirname(jobFile))} -Recurse -Force`;
          spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { cwd: job.root, detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
        } else await fs.rm(path.dirname(jobFile), { recursive: true, force: true });
      }
    }
  })().catch(error => { if (process.connected) process.send({ error: error.message }); console.error(error); process.exitCode = 1; });
}
