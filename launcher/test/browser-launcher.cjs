const { _electron: electron } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const root = path.resolve(__dirname, '../..');
  const taskRoot = await fs.mkdtemp(path.join(root, 'work/tmp/native-browser-'));
  const executable = path.join(taskRoot, '联调 浏览器.exe'), record = path.join(taskRoot, 'launches.json');
  await fs.writeFile(executable, `#!${process.execPath}\nconst fs=require('node:fs');let calls=[];try{calls=JSON.parse(fs.readFileSync(${JSON.stringify(record)},'utf8'));}catch{}calls.push(process.argv.slice(2));fs.writeFileSync(${JSON.stringify(record)},JSON.stringify(calls));`, { mode: 0o755 });
  const launch = () => electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', path.join(root, 'launcher')], env: { ...process.env, TMPDIR: path.join(root, 'work/tmp'), CANVAS_DEV_ROOT: taskRoot } });
  let app = await launch();
  async function readCalls(count) {
    const deadline = Date.now() + 10000;
    for (;;) { try { const calls = JSON.parse(await fs.readFile(record, 'utf8')); if (calls.length >= count) return calls; } catch {} if (Date.now() >= deadline) throw Error('未收到浏览器启动参数'); await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  try {
    let page = await app.firstWindow(); await page.locator('#browser-current').filter({ hasText: '已保存：' }).waitFor();
    await page.getByLabel('打开工作台的浏览器', { exact: true }).selectOption('chrome');
    await page.locator('#save-browser').click();
    await page.locator('#notice').filter({ hasText: '浏览器选择已保存' }).waitFor();
    assert.equal((await page.evaluate(() => window.launcher.invoke('app:load'))).config.browser, 'chrome');
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, executable);
    await page.locator('#choose-browser').click();
    await page.waitForFunction(file => document.querySelector('#browser-form').elements.browserPath.value === file, executable);
    assert.equal(await page.getByLabel('打开工作台的浏览器', { exact: true }).inputValue(), 'custom');
    await page.locator('#start').click(); await page.locator('#top-status').filter({ hasText: '运行中' }).waitFor({ timeout: 120000 });
    let calls = await readCalls(1);
    assert.ok(calls[0].some(arg => arg.startsWith('--user-data-dir=' + path.join(taskRoot, 'data/browser'))));
    assert.ok(calls[0].at(-1).includes('/local/bootstrap#'));
    await page.locator('#open').click(); calls = await readCalls(2);
    assert.equal(calls[0].find(arg => arg.startsWith('--user-data-dir=')), calls[1].find(arg => arg.startsWith('--user-data-dir=')));
    const config = (await page.evaluate(() => window.launcher.invoke('app:load'))).config;
    assert.equal(config.browserPath, executable); assert.equal(config.browser, 'custom');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1120, 950));
    await page.screenshot({ path: path.join(root, 'outputs/指定浏览器预览.png') });
    await page.locator('#stop').click(); await page.locator('#sidebar-status').filter({ hasText: '服务未启动' }).waitFor();
    await app.close(); app = await launch(); page = await app.firstWindow();
    await page.locator('#browser-current').filter({ hasText: '联调 浏览器.exe' }).waitFor();
    assert.equal(await page.locator('#browser-form [name="browserPath"]').inputValue(), executable);
    await page.getByLabel('打开工作台的浏览器', { exact: true }).selectOption('edge');
    assert.equal(await page.locator('#browser-form [name="browserPath"]').inputValue(), '');
    await page.locator('#save-browser').click(); await page.locator('#notice').filter({ hasText: '浏览器选择已保存' }).waitFor();
    await page.getByLabel('打开工作台的浏览器', { exact: true }).selectOption('custom');
    await page.locator('#start').click(); await page.locator('#notice.error').filter({ hasText: '请选择指定浏览器' }).waitFor();
    assert.equal((await page.evaluate(() => window.launcher.invoke('app:load'))).status.phase, 'stopped');
    const result = { passed: true, platform: 'Linux 上运行真实 Electron 启动器，测试程序记录浏览器启动参数', verified: ['首页指定程序与常用浏览器选择', '一键启动及打开工作台均使用所选程序并自动保存', '重启后保留选择', '改选常用浏览器清除旧路径', '未指定程序时明确提示，服务不启动', '独立资料目录位于机械盘数据目录'], remaining: ['Windows 下的浏览器实机启动'] };
    await fs.writeFile(path.join(root, 'outputs/指定浏览器联调结果.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  } finally { await app.close(); await fs.rm(taskRoot, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
