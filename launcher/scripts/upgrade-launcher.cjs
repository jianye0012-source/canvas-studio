const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const requireApp = createRequire(path.join(__dirname, 'app/package.json'));
const semver = requireApp('semver');
const { ReleaseUpdater } = requireApp('./lib/release-update.cjs');
const { prepareSelfUpdate, startSelfUpdate } = requireApp('./lib/self-update.cjs');

(async () => {
  const root = await fs.realpath(process.argv[2]);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package-manifest.json'), 'utf8'));
  if (manifest.application !== 'canvas-studio' || manifest.platform !== 'win32-x64') throw new Error('请选择画布工作台整合包目录');
  let dataDir = path.join(root, 'data');
  try { dataDir = path.resolve(root, JSON.parse(await fs.readFile(path.join(root, 'portable.json'), 'utf8')).dataDir); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (dataDir === path.join(root, 'data')) await fs.mkdir(dataDir, { recursive: true });
  const updater = new ReleaseUpdater({ dataDir, currentVersion: manifest.version, source: requireApp('./update-source.json'), index: null });
  let previous = '';
  updater.on('status', state => {
    const message = state.message + (state.phase === 'downloading' ? ` ${state.progress}%` : '');
    if (message !== previous) { console.log(message); previous = message; }
  });
  try {
    await updater.initialize(); await updater.check();
    const latest = updater.status().versions.find(entry => entry.installable);
    if (!latest || !semver.gt(latest.version, manifest.version)) { console.log('当前已经是最新正式版，无需更新。'); return; }
    await updater.selectVersion(latest.version); await updater.download();
    const job = await prepareSelfUpdate(await updater.installation(), root, dataDir);
    await startSelfUpdate(job);
    console.log('更新助手已接管。请等待新版启动器自动打开，无需再运行旧快捷方式。');
  } finally { await updater.close(); }
})().catch(error => { console.error('启动器升级未完成：' + error.message); process.exitCode = 1; });
