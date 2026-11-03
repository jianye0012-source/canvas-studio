const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { stageUpdate, prepareInstallation, installationScript, executableName } = require('../lib/update.cjs');
const { atomicJson } = require('../lib/files.cjs');
const run = promisify(execFile);
const powerShell = script => ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
const quote = value => "'" + value.replaceAll("'", "''") + "'";

(async () => {
  assert.equal(process.platform, 'win32');
  const current = require('../package.json').version;
  const historicalZip = path.resolve(process.argv[2]);
  const currentZip = path.resolve('outputs', `CanvasStudio-Windows-x64-${current}.zip`);
  const testDir = await fs.mkdtemp(path.resolve('work/tmp/win-'));
  const data = path.join(testDir, '数据 空格');
  const root = path.join(testDir, '程序 中文');
  const pointer = path.join(root, '.versions', 'active.json');
  const log = path.join(data, 'logs', 'update.log');
  const sentinel = path.join(data, '项目.txt');
  const active = () => fs.readFile(pointer, 'utf8').then(JSON.parse);
  const installed = new Set([root]);
  const kill = async directory => {
    await run('powershell.exe', powerShell(`Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ${quote(path.join(directory, executableName))} } | Stop-Process -Force -ErrorAction SilentlyContinue`));
  };
  const launchTest = async (candidate, staging, previous) => {
    installed.add(candidate.directory);
    const script = installationScript(candidate, root, 0, data, staging, previous);
    await run('powershell.exe', powerShell(script), { timeout: 120000 });
  };
  try {
    await fs.mkdir(path.join(data, 'logs'), { recursive: true });
    await fs.writeFile(sentinel, '应保留的项目');
    const currentStage = await stageUpdate(currentZip, data);
    await fs.cp(currentStage, root, { recursive: true });
    await atomicJson(path.join(root, 'portable.json'), { dataDir: data });
    const original = await fs.stat(path.join(root, executableName));
    const candidate = await prepareInstallation(currentStage, root, data);
    await launchTest(candidate, currentStage, root);
    assert.equal((await active()).id, candidate.id, await fs.readFile(log, 'utf8').catch(() => '新版未就绪'));
    assert.equal(await fs.readFile(path.join(candidate.directory, 'launch-ready'), 'utf8'), 'ready');
    await kill(candidate.directory);

    const invalidStage = path.join(data, 'updates', 'bad-start');
    const invalid = { id: crypto.randomUUID(), version: current };
    invalid.directory = path.join(root, '.versions', invalid.id);
    await fs.mkdir(invalidStage);
    await fs.mkdir(invalid.directory);
    await fs.writeFile(path.join(invalid.directory, executableName), 'not a Windows executable');
    await launchTest(invalid, invalidStage, candidate.directory);
    assert.equal((await active()).id, candidate.id);
    assert.ok((await fs.stat(log)).size);
    await kill(candidate.directory);

    const priorStage = await stageUpdate(historicalZip, data);
    const prior = await prepareInstallation(priorStage, root, data);
    assert.notEqual(prior.version, current);
    const hold = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    const interrupted = spawn('powershell.exe', powerShell(installationScript(prior, root, hold.pid, data, priorStage, candidate.directory)), { stdio: 'ignore' });
    try {
      await delay(1500);
      interrupted.kill();
      await new Promise(resolve => { if (interrupted.exitCode !== null || interrupted.signalCode !== null) resolve(); else interrupted.once('exit', resolve); });
      assert.equal((await active()).id, candidate.id);
      assert.equal(await fs.readFile(sentinel, 'utf8'), '应保留的项目');
    } finally { hold.kill(); }

    await launchTest(prior, priorStage, candidate.directory);
    assert.equal((await active()).id, prior.id, await fs.readFile(log, 'utf8').catch(() => '历史版未就绪'));
    await kill(prior.directory);
    const upgradeStage = await stageUpdate(currentZip, data);
    const upgrade = await prepareInstallation(upgradeStage, root, data);
    await launchTest(upgrade, upgradeStage, prior.directory);
    assert.equal((await active()).id, upgrade.id);
    assert.equal((await fs.stat(path.join(root, executableName))).size, original.size);
    assert.equal(await fs.readFile(sentinel, 'utf8'), '应保留的项目');
    console.log('PASS Windows packaged launch, staged switch, failed startup fallback, interrupted switch, official historical rollback and original project data');
  } finally {
    for (const directory of installed) await kill(directory).catch(() => {});
    await fs.rm(testDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
