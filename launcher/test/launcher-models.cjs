const { _electron: electron } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const root = path.resolve(__dirname, '../..');
  const taskRoot = await fs.mkdtemp(path.join(root, 'work/tmp/native-channels-'));
  const launch = () => electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', path.join(root, 'launcher')], env: { ...process.env, TMPDIR: path.join(root, 'work/tmp'), CANVAS_DEV_ROOT: taskRoot } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.locator('[data-page="models"]').click();
    for (const name of ['文字渠道', '图片渠道']) {
      await page.locator('#add-channel').click();
      await page.locator('[name="name"]').fill(name);
      await page.locator('[name="baseUrl"]').fill('https://example.com/v1');
      await page.locator('#new-model').fill('same-model'); await page.locator('#new-capability').selectOption(name === '文字渠道' ? 'text' : 'image');
      await page.locator('#add-model').click();
    }
    for (const [role, name] of [['director', '文字渠道'], ['text', '文字渠道'], ['image', '图片渠道']]) {
      const options = await page.locator(`[data-role="${role}"] option`).evaluateAll(options => options.map(option => ({ text: option.textContent, value: option.value })));
      await page.locator(`[data-role="${role}"]`).selectOption(options.find(option => option.text.includes(name)).value);
    }
    await page.locator('#save-models').click(); await page.locator('#notice').filter({ hasText: '全部渠道和默认模型已保存' }).waitFor();
    const config = await page.evaluate(() => window.launcher.invoke('app:load').then(value => value.config));
    assert.equal(config.channels.length, 2); assert.notEqual(config.directorChannelId, config.imageChannelId);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1120, 1250));
    await page.locator('main').evaluate(main => { main.scrollTop = 0; });
    await page.screenshot({ path: path.join(root, 'outputs/启动器多渠道预览.png') });
    await app.close(); app = await launch(); page = await app.firstWindow();
    await page.locator('[data-page="models"]').click(); await page.locator('#channel-list button').first().waitFor();
    const reopened = await page.evaluate(() => window.launcher.invoke('app:load').then(value => value.config));
    assert.equal(reopened.channels.length, 2); assert.equal(reopened.imageChannelId, config.imageChannelId);
    console.log('实际 Electron 启动器新增渠道、同名模型、分别选择与重启保留通过');
  } finally { await app.close(); await fs.rm(taskRoot, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
