const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron } = require('playwright-core');
const { stageUpdate, prepareInstallation, applyUpdate, executableName } = require('../lib/update.cjs');
const { atomicJson } = require('../lib/files.cjs');
const unzipper = require('unzipper');
const run = promisify(execFile);
const powerShell = script => ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
const quote = value => "'" + value.replaceAll("'", "''") + "'";

(async () => {
  assert.equal(process.platform, 'win32');
  const version = require('../package.json').version;
  const historicalZip = path.resolve(process.argv[2]);
  const currentZip = path.resolve('outputs', `CanvasStudio-Windows-x64-${version}.zip`);
  const testDir = await fs.mkdtemp(path.resolve('work/tmp/win-'));
  const data = path.join(testDir, '数据 空格');
  const root = path.join(testDir, '程序 中文');
  const pointer = path.join(root, '.versions', 'active.json');
  const sentinel = path.join(data, '项目.txt');
  const active = () => fs.readFile(pointer, 'utf8').then(JSON.parse, error => { if (error.code !== 'ENOENT') throw error; return null; });
  const programs = new Set([root]);
  const find = directory => `Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ${quote(path.join(directory, executableName))} }`;
  const kill = directory => run('powershell.exe', powerShell(find(directory) + ' | Stop-Process -Force -ErrorAction SilentlyContinue'));
  const opened = async directory => {
    const child = spawn(path.join(root, executableName), [], { stdio: 'ignore' });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const { stdout } = await run('powershell.exe', powerShell(find(directory) + ' | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -ExpandProperty Id'));
      if (stdout.trim()) return;
      await delay(500);
    }
    throw new Error('重新打开启动器后没有进入所选版本');
  };
  let app;
  try {
    await fs.mkdir(data, { recursive: true });
    await fs.writeFile(sentinel, '应保留的项目');
    const staged = await stageUpdate(historicalZip, data);
    await fs.cp(staged, root, { recursive: true });
    await fs.rm(staged, { recursive: true, force: true });
    await atomicJson(path.join(root, 'portable.json'), { dataDir: data });
    await atomicJson(path.join(data, 'settings.json'), { autoCheckUpdates: false, channels: [] });
    await fs.writeFile(path.join(root, '用户文件.txt'), '保留额外文件');

    app = await _electron.launch({ executablePath: path.join(root, executableName) });
    await app.firstWindow();
    const tool = path.join(testDir, '升级工具 中文');
    await (await unzipper.Open.file(path.resolve('outputs', `CanvasStudio-Launcher-Upgrade-${version}.zip`))).extract({ path: tool });
    const release = {
      tag_name: 'v' + version,
      assets: await Promise.all([currentZip, currentZip + '.sha256'].map(async file => ({ name: path.basename(file), size: (await fs.stat(file)).size, browser_download_url: `https://github.com/jianye0012-source/canvas-studio/releases/download/v${version}/${path.basename(file)}` }))),
    };
    const hook = path.join(testDir, 'mock-download.cjs');
    await fs.writeFile(hook, `if (process.argv.some(value => value.endsWith('upgrade-launcher.cjs'))) {
      const fs = require('node:fs'); const { Readable } = require('node:stream');
      globalThis.fetch = async url => url.includes('/releases?') ? Response.json(${JSON.stringify([release])}) : url.endsWith('.sha256') ? new Response(${JSON.stringify(await fs.readFile(currentZip + '.sha256', 'utf8'))}) : new Response(Readable.toWeb(fs.createReadStream(${JSON.stringify(currentZip)})));
    }`);
    const upgraded = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(tool, 'upgrade-launcher.ps1')], { env: { ...process.env, NODE_OPTIONS: '--require=' + JSON.stringify(hook.replaceAll('\\', '/')) }, timeout: 240000, maxBuffer: 4 * 1024 ** 2 });
    assert.match(upgraded.stdout, /更新助手已接管/);
    app = null;
    const bootstrapDeadline = Date.now() + 240000;
    let bootstrapReceipt;
    while (Date.now() < bootstrapDeadline) {
      bootstrapReceipt = await fs.readFile(path.join(data, 'updates/last-install.json'), 'utf8').then(JSON.parse, () => null);
      if (bootstrapReceipt?.success && bootstrapReceipt.version === version) break;
      await delay(500);
    }
    assert.ok(bootstrapReceipt?.success, '首次升级工具必须从历史正式包完成替换并打开新版界面');
    await kill(root);
    await fs.rm(path.join(data, 'updates/last-install.json'));
    app = await _electron.launch({ executablePath: path.join(root, executableName) });
    const page = await app.firstWindow();
    await page.locator('[data-page="repair"]').click();
    await app.evaluate((_electron, input) => {
      const require = process.getBuiltinModule('module').createRequire(input.appPackage);
      const { ReleaseUpdater } = require('./lib/release-update.cjs');
      const { createReadStream } = require('node:fs');
      const { Readable } = require('node:stream');
      const original = ReleaseUpdater.prototype.checkInner;
      ReleaseUpdater.prototype.checkInner = function () {
        this.fetchImpl = async url => {
          if (url.includes('/releases?')) return Response.json([input.release]);
          if (url.endsWith('.sha256')) return new Response(input.checksum);
          return new Response(Readable.toWeb(createReadStream(input.zip)));
        };
        return original.call(this);
      };
    }, {
      appPackage: path.join(root, 'resources', 'app', 'package.json'),
      zip: currentZip,
      checksum: await fs.readFile(currentZip + '.sha256', 'utf8'),
      release: {
        tag_name: 'v' + version,
        assets: await Promise.all([currentZip, currentZip + '.sha256'].map(async file => ({
          name: path.basename(file), size: (await fs.stat(file)).size,
          browser_download_url: `https://github.com/jianye0012-source/canvas-studio/releases/download/v${version}/${path.basename(file)}`,
        }))),
      },
    });
    await page.locator('#check-update').click();
    await page.locator('#release-versions').selectOption(version);
    await page.locator('#install-update').click();
    const deadline = Date.now() + 240000;
    let receipt;
    while (Date.now() < deadline) {
      receipt = await fs.readFile(path.join(data, 'updates/last-install.json'), 'utf8').then(JSON.parse, () => null);
      if (receipt?.success && receipt.version === version) break;
      await delay(500);
    }
    assert.ok(receipt?.success, '新版必须完成实际界面初始化并提交成功回执');
    const next = await active();
    assert.equal(next, null, '更新后直接使用原目录的新启动器');
    const installed = root;
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'package-manifest.json'))).version, version);
    assert.equal(await fs.readFile(sentinel, 'utf8'), '应保留的项目');
    await assert.rejects(fs.access(path.join(installed, '对应源码.zip')), { code: 'ENOENT' });
    assert.match(await fs.readFile(path.join(installed, 'resources', 'bundle', 'SOURCE-NOTICE.txt'), 'utf8'), new RegExp('/releases/tag/v' + version.replaceAll('.', '\\.')));
    assert.equal(await fs.readFile(path.join(root, '用户文件.txt'), 'utf8'), '保留额外文件');
    app = null;
    await opened(installed);
    await kill(installed);

    const priorStage = await stageUpdate(historicalZip, data);
    const prepared = await prepareInstallation(priorStage, root, data);
    assert.notEqual(prepared.version, version);
    assert.deepEqual(await active(), next);
    const prior = await applyUpdate(priorStage, root, data);
    programs.add(prior.directory);
    assert.equal((await active()).id, prior.id);
    await opened(prior.directory);
    await kill(prior.directory);
    await fs.writeFile(path.join(priorStage, executableName), 'invalid file');
    await assert.rejects(() => applyUpdate(priorStage, root, data));
    assert.equal((await active()).id, prior.id);
    const restore = await applyUpdate(await stageUpdate(currentZip, data), root, data);
    programs.add(restore.directory);
    assert.equal((await active()).version, version);
    assert.equal(await fs.readFile(sentinel, 'utf8'), '应保留的项目');
    console.log('PASS Windows self-replacement closes old launcher, starts original entry with verified renderer, preserves projects, supports official rollback and rejects corrupt packages');
  } finally {
    await app?.close().catch(() => {});
    for (const directory of programs) await kill(directory).catch(() => {});
    await fs.rm(testDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
