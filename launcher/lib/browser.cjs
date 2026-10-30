const path = require('node:path');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { writableDirectory, atomicJson } = require('./files.cjs');

async function browserExecutable(config, platform = process.platform, env = process.env) {
  if (config.browser === 'custom' && !config.browserPath) throw new Error('请选择指定浏览器的程序文件');
  const relative = { edge: 'Microsoft/Edge/Application/msedge.exe', chrome: 'Google/Chrome/Application/chrome.exe', firefox: 'Mozilla Firefox/firefox.exe' };
  const linux = { edge: ['/usr/bin/microsoft-edge', '/opt/microsoft/msedge/msedge'], chrome: ['/usr/bin/google-chrome', '/usr/bin/chromium'], firefox: ['/usr/bin/firefox', '/usr/bin/firefox-esr', '/opt/firefox/firefox', '/snap/bin/firefox'] };
  const candidates = config.browserPath ? [config.browserPath] : platform === 'win32'
    ? [env['PROGRAMFILES(X86)'], env.PROGRAMFILES, env.LOCALAPPDATA].filter(Boolean).map(base => path.join(base, relative[config.browser]))
    : linux[config.browser] || [];
  for (const file of candidates) {
    try { if (!(await fs.stat(file)).isFile()) continue; await fs.access(file, platform === 'win32' ? constants.F_OK : constants.X_OK); return file; } catch {}
  }
  throw new Error(config.browserPath ? '指定的浏览器程序不可用，请在首页重新选择' : `未找到 ${ { edge: 'Edge', chrome: 'Chrome', firefox: 'Firefox' }[config.browser] || '浏览器' }，请在首页选择浏览器程序`);
}

async function openWorkspace(url, config, dataDir) {
  await writableDirectory(dataDir);
  const executable = await browserExecutable(config);
  const firefox = /^firefox(?:-esr)?(?:\.exe)?$/i.test(path.basename(executable));
  const key = config.browser === 'custom' ? 'custom-' + crypto.createHash('sha256').update(path.resolve(executable)).digest('hex').slice(0, 12) : config.browser;
  const profile = path.join(dataDir, 'browser', key), cache = path.join(dataDir, 'cache', key), downloads = path.join(dataDir, 'outputs');
  for (const dir of [profile, cache, downloads]) await fs.mkdir(dir, { recursive: true });
  let args;
  if (firefox) {
    const prefs = { 'browser.download.folderList': 2, 'browser.download.dir': downloads, 'browser.download.useDownloadDir': true, 'browser.cache.disk.parent_directory': cache, 'browser.shell.checkDefaultBrowser': false, 'browser.startup.homepage_override.mstone': 'ignore' };
    await fs.writeFile(path.join(profile, 'user.js'), Object.entries(prefs).map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`).join('\n'), { mode: 0o600 });
    args = ['-no-remote', '-profile', profile, url];
  } else {
    const preferences = path.join(profile, 'Default', 'Preferences');
    let prefs = {}; try { prefs = JSON.parse(await fs.readFile(preferences, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('浏览器专用配置无法读取，请检查数据目录'); }
    prefs.download = { ...prefs.download, default_directory: downloads, prompt_for_download: false, directory_upgrade: true };
    await atomicJson(preferences, prefs);
    args = [`--user-data-dir=${profile}`, `--disk-cache-dir=${cache}`, '--no-first-run', '--no-default-browser-check', url];
  }
  const child = spawn(executable, args, { detached: true, stdio: 'ignore', windowsHide: true });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
}
module.exports = { browserExecutable, openWorkspace };
