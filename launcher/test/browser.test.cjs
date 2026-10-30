const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { browserExecutable, openWorkspace } = require('../lib/browser.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.resolve(__dirname, '../../work/tmp/browser-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, '机械盘数据'); await fs.mkdir(dataDir);
  return { root, dataDir };
}
async function recorder(root, name) {
  const file = path.join(root, name), record = file + '.json';
  await fs.writeFile(file, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)));`, { mode: 0o755 });
  return { file, record };
}
async function recorded(file) {
  const deadline = Date.now() + 5000;
  for (;;) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (Date.now() >= deadline) throw error; await new Promise(resolve => setTimeout(resolve, 30)); }
  }
}

test('Edge、Chrome、Firefox 分别查找指定浏览器，缺失时不改用另一浏览器', async t => {
  const { root } = await fixture(t);
  const edge = path.join(root, 'Microsoft/Edge/Application/msedge.exe');
  const chrome = path.join(root, 'Google/Chrome/Application/chrome.exe');
  const firefox = path.join(root, 'Mozilla Firefox/firefox.exe');
  for (const file of [edge, chrome, firefox]) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, 'test'); }
  for (const [browser, expected] of [['edge', edge], ['chrome', chrome], ['firefox', firefox]]) assert.equal(await browserExecutable({ browser }, 'win32', { PROGRAMFILES: root }), expected);
  await fs.unlink(edge);
  await assert.rejects(() => browserExecutable({ browser: 'edge' }, 'win32', { PROGRAMFILES: root }), /未找到 Edge/);
  await assert.rejects(() => browserExecutable({ browser: 'custom', browserPath: '' }), /请选择/);
  await assert.rejects(() => browserExecutable({ browser: 'custom', browserPath: root }), /程序不可用/);
});

test('自选 Chromium 浏览器按中文及空格路径启动，资料、缓存和下载均使用数据目录', async t => {
  const { root, dataDir } = await fixture(t);
  const first = await recorder(root, '浏览器 一.exe'), second = await recorder(root, '浏览器 二.exe');
  await openWorkspace('http://127.0.0.1:17860/canvas', { browser: 'custom', browserPath: first.file }, dataDir);
  const args = await recorded(first.record);
  assert.ok(args.includes('http://127.0.0.1:17860/canvas'));
  const profile = args.find(value => value.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
  const cache = args.find(value => value.startsWith('--disk-cache-dir=')).slice('--disk-cache-dir='.length);
  assert.ok(profile.startsWith(path.join(dataDir, 'browser') + path.sep)); assert.ok(cache.startsWith(path.join(dataDir, 'cache') + path.sep));
  const prefs = JSON.parse(await fs.readFile(path.join(profile, 'Default/Preferences'), 'utf8'));
  assert.equal(prefs.download.default_directory, path.join(dataDir, 'outputs'));
  await openWorkspace('http://127.0.0.1:17860/canvas', { browser: 'custom', browserPath: second.file }, dataDir);
  const other = await recorded(second.record);
  assert.notEqual(args.find(value => value.startsWith('--user-data-dir=')), other.find(value => value.startsWith('--user-data-dir=')));
});

test('Firefox 使用其专用参数和下载、缓存设置；数据目录消失时停止写入', async t => {
  const { root, dataDir } = await fixture(t);
  const browser = await recorder(root, 'firefox.exe');
  await openWorkspace('http://127.0.0.1:17860/canvas', { browser: 'custom', browserPath: browser.file }, dataDir);
  const args = await recorded(browser.record);
  assert.equal(args[0], '-no-remote'); assert.equal(args[1], '-profile'); assert.equal(args.length, 4);
  assert.ok(args[2].startsWith(path.join(dataDir, 'browser') + path.sep));
  const prefs = await fs.readFile(path.join(args[2], 'user.js'), 'utf8');
  assert.ok(prefs.includes(JSON.stringify(path.join(dataDir, 'outputs')))); assert.ok(prefs.includes('browser.cache.disk.parent_directory'));
  const missing = path.join(root, '不可用机械盘');
  await assert.rejects(() => openWorkspace('http://127.0.0.1:17860/canvas', { browser: 'custom', browserPath: browser.file }, missing));
  await assert.rejects(() => fs.stat(missing));
});
