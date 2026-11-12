if (process.env.CANVAS_NATIVE_PICKER === '1') {
  require('./lib/native-picker-host.cjs');
  return;
}
const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, net } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const semver = require('semver');
const { ConfigStore } = require('./lib/config.cjs');
const { Runtime } = require('./lib/runtime.cjs');
const { ReleaseUpdater } = require('./lib/release-update.cjs');
const { createUpdateFetch } = require('./lib/update-network.cjs');
const { MediaExports } = require('./lib/media-files.cjs');
const { NativePicker } = require('./lib/native-picker.cjs');
const { prepareSelfUpdate, startSelfUpdate, markUpdateReady } = require('./lib/self-update.cjs');
const { installationPaths, executableName, versionDirectory, stageUpdate, applyUpdate, clearInactiveVersions } = require('./lib/update.cjs');
const updateSource = require('./update-source.json');

const programRoot = app.isPackaged ? path.dirname(process.execPath) : process.env.CANVAS_DEV_ROOT || path.resolve(__dirname, '..', 'work', 'portable-dev');
const { root: portableRoot, pointer } = installationPaths(programRoot);
const trial = app.isPackaged && programRoot !== portableRoot && process.env.CANVAS_STUDIO_TRIAL === path.basename(programRoot);
const updateFailed = process.env.CANVAS_STUDIO_UPDATE_FAILED === '1';
let updateReceipt = process.env.CANVAS_STUDIO_UPDATE_RECEIPT;
delete process.env.CANVAS_STUDIO_UPDATE_RECEIPT;
delete process.env.CANVAS_STUDIO_TRIAL;
if (app.isPackaged && !trial && !process.argv.includes('--recover')) {
  try {
    const { id } = JSON.parse(fs.readFileSync(pointer, 'utf8'));
    if (!versionDirectory.test(id)) throw new Error('已安装版本记录无效');
    const active = path.join(portableRoot, '.versions', id);
    if (active !== programRoot) {
      const executable = path.join(active, executableName);
      fs.accessSync(executable);
      const child = require('node:child_process').spawn(executable, [], { detached: true, stdio: 'ignore' });
      child.on('error', error => { dialog.showErrorBox('无法打开已安装版本', error.message + '\n可双击“恢复原启动器.cmd”。'); app.exit(1); });
      child.on('spawn', () => { child.unref(); app.exit(0); });
      return;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') dialog.showErrorBox('已安装版本不可用', error.message + '\n将打开原启动器。');
  }
}
delete process.env.CANVAS_STUDIO_UPDATE_FAILED;
let dataDir = path.join(portableRoot, 'data');
try {
  const locator = JSON.parse(fs.readFileSync(path.join(portableRoot, 'portable.json'), 'utf8'));
  dataDir = path.resolve(portableRoot, locator.dataDir);
  if (!fs.statSync(dataDir).isDirectory()) throw new Error('数据目录不可用');
} catch (error) {
  if (error.code !== 'ENOENT' || fs.existsSync(path.join(portableRoot, 'portable.json'))) { dialog.showErrorBox('机械盘数据目录不可用', error.message); app.exit(1); }
}
fs.mkdirSync(dataDir, { recursive: true });
for (const name of ['tmp', 'cache', 'logs', 'launcher-profile']) fs.mkdirSync(path.join(dataDir, name), { recursive: true });
process.env.TMPDIR = process.env.TEMP = process.env.TMP = path.join(dataDir, 'tmp');
app.setPath('userData', path.join(dataDir, 'launcher-profile'));
app.setPath('sessionData', path.join(dataDir, 'launcher-profile'));
app.setPath('crashDumps', path.join(dataDir, 'logs', 'crashes'));
app.setAppLogsPath(path.join(dataDir, 'logs'));
app.commandLine.appendSwitch('disk-cache-dir', path.join(dataDir, 'cache', 'launcher'));
app.disableHardwareAcceleration();

let window, runtime, store, updater, picker, quitting = false, installing = false, queuedVersion = '', checking, updateTimer;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    const encrypt = async secret => {
      if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Windows 密钥加密不可用，请重新登录 Windows 后重试');
      return safeStorage.encryptStringAsync(secret);
    };
    const decrypt = async bytes => (await safeStorage.decryptStringAsync(bytes)).result;
    const systemFetch = createUpdateFetch(net);
    store = await new ConfigStore(portableRoot, encrypt, decrypt, systemFetch, systemFetch).initialize();
    const bundleRoot = process.env.CANVAS_BUNDLE_ROOT || (app.isPackaged ? path.join(programRoot, 'resources', 'bundle') : path.resolve(__dirname, '..', 'work', 'bundle-linux'));
    picker = new NativePicker({ executable: process.execPath, entry: __filename, dataDir: store.dataDir });
    const choose = options => picker.select(options);
    const chooseOutput = async () => (await choose({ title: '选择机械盘上的输出目录', properties: ['openDirectory', 'createDirectory'] }))[0];
    const exports = new MediaExports(store.dataDir);
    const images = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'];
    const videos = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'mpeg', 'mpg'];
    const audios = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'];
    const mediaExtensions = { image: images, video: videos, audio: audios, director: ['png', 'jpg', 'jpeg', 'webp', ...videos], media: [...images, ...videos, ...audios] };
    runtime = new Runtime({
      store, root: bundleRoot, development: !app.isPackaged, chooseOutput, cancelPicker: () => picker.cancel(),
      chooseFolder: async () => (await choose({ title: '选择 FOR 循环的输入文件夹', properties: ['openDirectory'] }))[0],
      chooseMedia: (kind, multiple) => choose({ title: '选择本机素材', properties: ['openFile', ...(multiple ? ['multiSelections'] : [])], filters: [{ name: '支持的媒体文件', extensions: mediaExtensions[kind] }] }),
    });
    updater = await new ReleaseUpdater({ dataDir: store.dataDir, currentVersion: app.getVersion(), source: updateSource, fetchImpl: systemFetch, index: null }).initialize({ skipPending: trial || Boolean(updateReceipt) });
    if (updateReceipt) updater.update({ phase: 'current', message: `已打开新版 ${app.getVersion()}，正在确认界面就绪…` });
    window = new BrowserWindow({ width: 1120, height: 780, minWidth: 960, minHeight: 680, title: '画布工作台启动器', backgroundColor: '#f6f7fb', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    const send = (event, value) => { if (window && !window.isDestroyed()) window.webContents.send(event, value); };
    runtime.on('status', value => {
      send('runtime:status', value);
      if (value.phase === 'stopped' && queuedVersion && !installing && !quitting) setTimeout(() => { if (queuedVersion && !installing && !quitting) void installOnce(() => install(updater.staged.path)).catch(error => runtime.log('自动更新：' + error.message)); }, 100);
    }); runtime.on('log', value => send('runtime:logs', value));
    updater.on('status', value => send('update:status', value));
    const confirmRollback = async version => {
      if (!semver.valid(version)) throw new Error('发行包版本无效');
      if (!semver.lt(version, app.getVersion())) return true;
      const choice = await dialog.showMessageBox(window, { type: 'warning', title: '确认回退程序版本', message: `将程序回退至 ${version}？`, detail: '下次打开启动器时使用所选版本。项目和模型配置会保留，旧版可能无法打开新版创建的项目。', buttons: ['取消', '安装所选版本'], defaultId: 0, cancelId: 0 });
      return choice.response === 1;
    };
    const install = async staged => {
      updater.update({ phase: 'installing', message: '正在写入所选版本的程序文件…' });
      try {
        const manifest = JSON.parse(await fsp.readFile(path.join(staged, 'package-manifest.json'), 'utf8'));
        if (manifest.updateProtocol === 2) {
          await runtime.stop();
          const job = await prepareSelfUpdate(staged, portableRoot, store.dataDir);
          await startSelfUpdate(job);
          queuedVersion = '';
          updater.update({ phase: 'restarting', message: '正在关闭启动器并自动替换程序，完成后会重新打开…' });
          setTimeout(() => app.quit(), 300);
          return updater.status();
        }
        const prepared = await applyUpdate(staged, portableRoot, store.dataDir);
        await updater.finishInstallation(staged, prepared.version);
        return updater.status();
      } catch (error) {
        updater.update({ phase: updater.staged ? 'ready' : 'error', message: '安装失败：' + error.message });
        throw error;
      }
    };
    const installOnce = async action => {
      if (installing) throw new Error('正在安装发行包，请稍候');
      installing = true;
      try { return await action(); } finally { installing = false; }
    };
    const checkAndUpdate = async (automatic = false) => {
      if (checking) return checking;
      if (installing || quitting || automatic && !store.value.autoCheckUpdates) return updater.status();
      checking = (async () => {
        await updater.check();
        const latest = updater.status().versions.find(entry => entry.installable && semver.gt(entry.version, app.getVersion()));
        if (!latest) return updater.status();
        if (automatic) {
          const last = await fsp.readFile(path.join(store.dataDir, 'updates/last-install.json'), 'utf8').then(JSON.parse, () => ({}));
          if (last.success === false && last.failedVersion === latest.version) { updater.update({ phase: 'error', message: `版本 ${latest.version} 上次启动失败，已恢复原程序。可手动检查更新后重试。` }); return updater.status(); }
        }
        await updater.selectVersion(latest.version);
        await updater.download();
        if (automatic && !store.value.autoCheckUpdates) return updater.status();
        if (!['stopped', 'error'].includes(runtime.state.phase)) {
          queuedVersion = latest.version;
          updater.update({ phase: 'ready', message: `新版 ${latest.version} 已下载并校验，停止服务后将自动更新并重新打开启动器。` });
          return updater.status();
        }
        return installOnce(() => install(updater.staged.path));
      })().finally(() => { checking = null; });
      return checking;
    };
    const handlers = {
      'app:load': async () => ({ config: store.public(), status: runtime.status(), logs: runtime.lines, update: updater.status(), exports: await exports.settings() }),
      'app:ready': async () => {
        if (updateReceipt) {
          await markUpdateReady(updateReceipt, portableRoot, store.dataDir, app.getVersion());
          updater.update({ phase: 'finishing', message: '新版已打开，正在清理旧程序和本次更新缓存…' });
          const id = path.basename(path.dirname(updateReceipt)), deadline = Date.now() + 120000;
          while (Date.now() < deadline) {
            const last = await fsp.readFile(path.join(store.dataDir, 'updates/last-install.json'), 'utf8').then(JSON.parse, () => ({}));
            if (last.id === id && last.success) break;
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          updater.update({ phase: 'current', installedVersion: app.getVersion(), message: `已自动更新至 ${app.getVersion()}，新版启动成功。` });
        }
        updateReceipt = '';
        return true;
      },
      'runtime:start': () => runtime.start(),
      'runtime:stop': () => runtime.stop(),
      'runtime:force-stop': () => runtime.forceStop(),
      'runtime:open': () => runtime.open(),
      'runtime:check': () => runtime.check(),
      'skills:list': async () => { await runtime.start({ open: false }); return runtime.api('v1/agent-skills'); },
      'skills:save': async (_event, value) => { await runtime.start({ open: false }); return runtime.api('v1/agent-skills', { method: 'POST', body: JSON.stringify({ id: value.id, name: value.name, description: value.description, content: value.content }) }); },
      'skills:delete': async (_event, id) => { await runtime.start({ open: false }); return runtime.api('v1/agent-skills/' + encodeURIComponent(id), { method: 'DELETE' }); },
      'skills:import': async () => {
        const result = await dialog.showOpenDialog(window, { title: '导入 Skill', properties: ['openFile'], filters: [{ name: 'Markdown / 文本 Skill', extensions: ['md', 'markdown', 'txt'] }] });
        if (result.canceled) return null;
        const file = result.filePaths[0]; if ((await fsp.stat(file)).size > 100000) throw new Error('Skill 文件过大，最多支持 20000 字');
        await runtime.start({ open: false }); return runtime.api('v1/agent-skills', { method: 'POST', body: JSON.stringify({ name: path.basename(file).replace(/\.(md|markdown|txt)$/i, ''), content: await fsp.readFile(file, 'utf8') }) });
      },
      'skills:export': async (_event, id) => {
        await runtime.start({ open: false }); const skills = await runtime.api('v1/agent-skills'), skill = skills.find(s => s.id === id); if (!skill) throw new Error('Skill 不存在');
        const result = await dialog.showSaveDialog(window, { title: '导出 Skill', defaultPath: path.join(store.dataDir, 'outputs', skill.name.replace(/[<>:"/\\|?*]/g, '_') + '.md'), filters: [{ name: 'Markdown Skill', extensions: ['md'] }] });
        if (result.canceled) return false; await fsp.writeFile(result.filePath, skill.content, 'utf8'); return true;
      },
      'config:save': async (_event, value) => { const result = await store.save(value); if (value.autoCheckUpdates === false) queuedVersion = ''; if (runtime.state.phase === 'running' && value.channels) await runtime.configureCanvas(); return result; },
      'config:test': (_event, value) => store.testChannel(value),
      'config:runninghub-model': (_event, input) => store.readRunningHubModel(input.id, input.baseUrl),
      'storage:open': () => shell.openPath(store.dataDir),
      'storage:choose-output': async () => { const directory = await chooseOutput(); return directory ? exports.configure({ directory }) : null; },
      'storage:auto-export': (_event, enabled) => {
        if (typeof enabled !== 'boolean') throw new Error('自动保存设置无效');
        return exports.configure({ enabled });
      },
      'storage:choose': async () => {
        if (runtime.state.phase !== 'stopped' && runtime.state.phase !== 'error') throw new Error('请先停止服务，再切换数据目录');
        const result = await dialog.showOpenDialog(window, { title: '选择现有工作台数据目录；原目录文件会保留', properties: ['openDirectory', 'createDirectory'] });
        if (result.canceled) return null;
        await store.selectDataDir(result.filePaths[0]); app.relaunch(); app.quit(); return true;
      },
      'browser:choose': async () => { const result = await dialog.showOpenDialog(window, { title: '选择浏览器主程序（Chrome、Edge、Firefox 或其他 Chromium 浏览器）', properties: ['openFile'], ...(process.platform === 'win32' ? { filters: [{ name: '浏览器程序', extensions: ['exe'] }] } : {}) }); return result.canceled ? '' : result.filePaths[0]; },
      'update:check': () => checkAndUpdate(),
      'update:clear-cache': () => installOnce(async () => {
        const downloads = await updater.clearCache();
        const versions = app.isPackaged && !trial ? await clearInactiveVersions(portableRoot, programRoot, store.dataDir) : 0;
        return { downloads, versions };
      }),
      'update:open-release': () => shell.openExternal(updater.releaseUrl),
      'update:install': (_event, version) => installOnce(async () => {
        if (process.platform !== 'win32' || !app.isPackaged) throw new Error('安装更新需要在 Windows 整合包中执行');
        if (!semver.valid(version)) throw new Error('请选择正式版本');
        if (!await confirmRollback(version)) return updater.status();
        if (updater.staged?.version !== version) {
          await updater.selectVersion(version);
          await updater.download();
        }
        return install(await updater.installation());
      }),
      'update:import': () => installOnce(async () => {
        const result = await dialog.showOpenDialog(window, { title: '选择画布工作台发行包 ZIP', properties: ['openFile'], filters: [{ name: '工作台整合包', extensions: ['zip'] }] });
        if (result.canceled) return null;
        runtime.log('正在校验导入的发行包');
        const staged = await stageUpdate(result.filePaths[0], store.dataDir);
        try {
          const { version } = JSON.parse(await fsp.readFile(path.join(staged, 'package-manifest.json'), 'utf8'));
          if (await confirmRollback(version)) return await install(staged);
        }
        catch (error) { await fsp.rm(staged, { recursive: true, force: true }); throw error; }
        await fsp.rm(staged, { recursive: true, force: true });
        return null;
      }),
      'about:open': () => shell.openPath(path.join(bundleRoot, 'SOURCE-NOTICE.txt')),
      'about:source': () => shell.openExternal(`https://github.com/${updateSource.owner}/${updateSource.repository}/releases/tag/v${app.getVersion()}`),
    };
    for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, async (event, ...args) => {
      if (event.sender !== window.webContents || !event.senderFrame?.url.startsWith('file:')) throw new Error('请求来源无效');
      if ((installing || ['restarting', 'finishing'].includes(updater.status().phase)) && !['app:load', 'app:ready', 'runtime:force-stop'].includes(channel)) throw new Error('正在安装发行包，请稍候');
      return handler(event, ...args);
    });
    await window.loadFile(path.join(__dirname, 'ui', 'index.html'));
    if (trial) await fsp.writeFile(path.join(programRoot, 'launch-ready'), 'ready', { flag: 'wx' });
    if (updateFailed) void dialog.showMessageBox(window, { type: 'warning', title: '更新未完成', message: '已重新打开原程序', detail: '项目仍在原数据目录。可以在“检查与修复”重试。安装记录位于 ' + path.join(store.dataDir, 'logs', 'update.log') });
    const autoUpdate = () => { if (app.isPackaged && !trial && !updateReceipt && store.value.autoCheckUpdates && !installing) void checkAndUpdate(true).catch(error => runtime.log('自动更新：' + error.message)); };
    setTimeout(autoUpdate, 2000);
    updateTimer = setInterval(autoUpdate, 30 * 60 * 1000);
  }).catch(error => { dialog.showErrorBox('启动器无法启动', error.message); app.quit(); });
  app.on('before-quit', event => {
    if (!quitting && runtime) { event.preventDefault(); quitting = true; clearInterval(updateTimer); Promise.allSettled([picker?.cancel(), runtime.stop(), updater?.close()]).finally(() => app.quit()); }
  });
  app.on('window-all-closed', () => app.quit());
}
