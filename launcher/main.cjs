const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { ConfigStore } = require('./lib/config.cjs');
const { Runtime } = require('./lib/runtime.cjs');
const { ReleaseUpdater } = require('./lib/release-update.cjs');
const updateSource = require('./update-source.json');

const portableRoot = app.isPackaged ? path.dirname(process.execPath) : process.env.CANVAS_DEV_ROOT || path.resolve(__dirname, '..', 'work', 'portable-dev');
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

let window, runtime, store, updater, quitting = false;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    const encrypt = async secret => {
      if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Windows 密钥加密不可用，请重新登录 Windows 后重试');
      return safeStorage.encryptStringAsync(secret);
    };
    const decrypt = async bytes => (await safeStorage.decryptStringAsync(bytes)).result;
    store = await new ConfigStore(portableRoot, encrypt, decrypt).initialize();
    const bundleRoot = process.env.CANVAS_BUNDLE_ROOT || (app.isPackaged ? path.join(portableRoot, 'resources', 'bundle') : path.resolve(__dirname, '..', 'work', 'bundle-linux'));
    runtime = new Runtime({ store, root: bundleRoot, development: !app.isPackaged, chooseFolder: async () => { const result = await dialog.showOpenDialog(window, { title: '选择 FOR 循环的输入文件夹', properties: ['openDirectory'] }); return result.canceled ? null : result.filePaths[0]; } });
    updater = await new ReleaseUpdater({ dataDir: store.dataDir, currentVersion: app.getVersion(), source: updateSource }).initialize();
    window = new BrowserWindow({ width: 1120, height: 780, minWidth: 960, minHeight: 680, title: '画布工作台启动器', backgroundColor: '#f6f7fb', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    const send = (event, value) => { if (window && !window.isDestroyed()) window.webContents.send(event, value); };
    runtime.on('status', value => send('runtime:status', value)); runtime.on('log', value => send('runtime:logs', value));
    updater.on('status', value => send('update:status', value));
    const handlers = {
      'app:load': () => ({ config: store.public(), status: runtime.status(), logs: runtime.lines, update: updater.status() }),
      'runtime:start': () => runtime.start(),
      'runtime:stop': () => runtime.stop(),
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
      'config:save': async (_event, value) => { const result = await store.save(value); if (runtime.state.phase === 'running' && value.channels) await runtime.configureCanvas(); return result; },
      'config:test': (_event, value) => store.testChannel(value),
      'storage:open': () => shell.openPath(store.dataDir),
      'storage:choose': async () => {
        if (runtime.state.phase !== 'stopped' && runtime.state.phase !== 'error') throw new Error('请先停止服务，再切换数据目录');
        const result = await dialog.showOpenDialog(window, { title: '选择现有工作台数据目录；原目录文件会保留', properties: ['openDirectory', 'createDirectory'] });
        if (result.canceled) return null;
        await store.selectDataDir(result.filePaths[0]); app.relaunch(); app.quit(); return true;
      },
      'browser:choose': async () => { const result = await dialog.showOpenDialog(window, { title: '选择浏览器主程序（Chrome、Edge、Firefox 或其他 Chromium 浏览器）', properties: ['openFile'], ...(process.platform === 'win32' ? { filters: [{ name: '浏览器程序', extensions: ['exe'] }] } : {}) }); return result.canceled ? '' : result.filePaths[0]; },
      'update:check': () => updater.check(),
      'update:download': () => updater.download(),
      'update:open-release': () => shell.openExternal(updater.releaseUrl),
      'update:install': async () => {
        if (process.platform !== 'win32' || !app.isPackaged) throw new Error('重启安装需要在 Windows 整合包中执行');
        const staged = await updater.installation(); await runtime.stop();
        await require('./lib/update.cjs').applyUpdate(staged, portableRoot, process.pid, store.dataDir); app.quit();
      },
      'update:import': async () => {
        const result = await dialog.showOpenDialog(window, { title: '选择画布工作台发行包 ZIP', properties: ['openFile'], filters: [{ name: '工作台整合包', extensions: ['zip'] }] });
        if (result.canceled) return null;
        const { stageUpdate, applyUpdate } = require('./lib/update.cjs');
        runtime.log('正在校验导入的发行包');
        const staged = await stageUpdate(result.filePaths[0], store.dataDir);
        await runtime.stop(); await applyUpdate(staged, portableRoot, process.pid, store.dataDir);
        app.quit(); return { restartRequired: true };
      },
      'about:open': () => shell.openPath(path.join(bundleRoot, 'SOURCE-NOTICE.txt')),
    };
    for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, async (event, ...args) => {
      if (event.sender !== window.webContents || !event.senderFrame?.url.startsWith('file:')) throw new Error('请求来源无效');
      return handler(event, ...args);
    });
    await window.loadFile(path.join(__dirname, 'ui', 'index.html'));
    if (store.value.autoCheckUpdates) setTimeout(() => { if (store.value.autoCheckUpdates) updater.check().catch(error => runtime.log('检查更新：' + error.message)); }, 2000);
  }).catch(error => { dialog.showErrorBox('启动器无法启动', error.message); app.quit(); });
  app.on('before-quit', event => {
    if (!quitting && runtime) { event.preventDefault(); quitting = true; Promise.allSettled([runtime.stop(), updater?.close()]).finally(() => app.quit()); }
  });
  app.on('window-all-closed', () => app.quit());
}
