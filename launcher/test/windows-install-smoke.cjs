const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron } = require('playwright-core');
const { stageUpdate, prepareInstallation, applyUpdate, executableName } = require('../lib/update.cjs');
const { atomicJson } = require('../lib/files.cjs');
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
  const active = () => fs.readFile(pointer, 'utf8').then(JSON.parse);
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
    const staged = await stageUpdate(currentZip, data);
    await fs.cp(staged, root, { recursive: true });
    await fs.rm(staged, { recursive: true, force: true });
    await atomicJson(path.join(root, 'portable.json'), { dataDir: data });
    await atomicJson(path.join(data, 'settings.json'), { autoCheckUpdates: false, channels: [] });

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
    await page.locator('#update-message').filter({ hasText: `版本 ${version} 已安装` }).waitFor({ timeout: 180000 });
    const next = await active();
    assert.equal(next.version, version);
    const installed = path.join(root, '.versions', next.id);
    programs.add(installed);
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), version);
    assert.equal((await page.evaluate(() => window.launcher.invoke('app:load'))).update.phase, 'installed');
    assert.equal(await fs.readFile(sentinel, 'utf8'), '应保留的项目');
    await assert.rejects(fs.access(path.join(installed, '对应源码.zip')), { code: 'ENOENT' });
    assert.match(await fs.readFile(path.join(installed, 'resources', 'bundle', 'SOURCE-NOTICE.txt'), 'utf8'), new RegExp('/releases/tag/v' + version.replaceAll('.', '\\.')));
    await app.close();
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
    console.log('PASS Windows selected install keeps launcher open, reopen activates installed program, official rollback, failed update and project preservation');
  } finally {
    await app?.close().catch(() => {});
    for (const directory of programs) await kill(directory).catch(() => {});
    await fs.rm(testDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
