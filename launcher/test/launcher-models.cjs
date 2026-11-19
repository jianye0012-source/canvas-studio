const { _electron: electron } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const http = require('node:http');
(async () => {
  const root = path.resolve(__dirname, '../..');
  const taskRoot = await fs.mkdtemp(path.join(root, 'work/tmp/native-channels-'));
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer launcher-test') { res.writeHead(401); res.end('{}'); return; }
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/models') { res.end(JSON.stringify({ data: ['shared-chat', 'shared-image', 'unknown-x'].map(id => ({ id })) })); return; }
    res.writeHead(404); res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const launch = () => electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', path.join(root, 'launcher')], env: { ...process.env, TMPDIR: path.join(root, 'work/tmp'), CANVAS_DEV_ROOT: taskRoot } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    let dialogs = 0;
    const countDialog = async dialog => { dialogs++; await dialog.dismiss(); };
    page.on('dialog', countDialog);
    await page.locator('[data-page="models"]').click();
    assert.equal(dialogs, 0); page.off('dialog', countDialog);
    await page.locator('#add-channel').click();
    await page.getByRole('textbox', { name: '渠道名称' }).fill('检测渠道');
    await page.locator('[name="baseUrl"]').fill(`http://127.0.0.1:${server.address().port}/v1`);
    await page.locator('[name="apiKey"]').fill('launcher-test');
    await page.getByRole('button', { name: '测试此渠道 / 读取模型', exact: true }).click();
    await page.locator('#notice').filter({ hasText: '可加入 2 个' }).waitFor();
    assert.equal(await page.locator('#channel-models li').count(), 0);
    const candidates = page.getByRole('region', { name: '本次检测到的模型' });
    assert.equal(await candidates.isVisible(), true);
    assert.equal(await candidates.getByRole('checkbox').count(), 2);
    for (const checkbox of await candidates.getByRole('checkbox').all()) assert.equal(await checkbox.isChecked(), false);
    assert.equal(await candidates.getByRole('button', { name: '加入所选模型', exact: true }).isDisabled(), true);
    await candidates.getByRole('checkbox', { name: '选择模型 shared-chat', exact: true }).check();
    await candidates.getByRole('button', { name: '加入所选模型', exact: true }).click();
    assert.equal(await page.locator('#channel-models li').count(), 1);
    assert.match(await page.locator('#channel-models li').innerText(), /shared-chat/);
    assert.match(await page.locator('#channel-models li').innerText(), /文字 \/ 白模/);
    assert.equal(await page.locator('#notice').textContent(), '已加入 1 个模型，请保存配置。');
    assert.equal(await candidates.getByRole('checkbox').count(), 1);
    assert.equal(await candidates.getByRole('checkbox', { name: '选择模型 shared-image', exact: true }).count(), 1);
    await candidates.getByRole('button', { name: '全选', exact: true }).click();
    assert.equal(await candidates.getByRole('checkbox').isChecked(), true);
    assert.equal(await candidates.getByRole('button', { name: '全不选', exact: true }).count(), 1);
    const warning = '模型配置有未保存的改动，离开后不会生效。确定离开吗？';
    await Promise.all([
      page.waitForEvent('dialog').then(async dialog => { assert.equal(dialog.message(), warning); await dialog.dismiss(); }),
      page.locator('[data-page="home"]').click(),
    ]);
    assert.equal(await page.locator('#page-title').textContent(), '模型配置');
    await Promise.all([
      page.waitForEvent('dialog').then(async dialog => { assert.equal(dialog.message(), warning); await dialog.accept(); }),
      page.locator('[data-page="home"]').click(),
    ]);
    assert.equal(await page.locator('#page-title').textContent(), '一键启动');
    await page.locator('[data-page="models"]').click();
    assert.equal(await page.getByRole('textbox', { name: '渠道名称' }).inputValue(), '检测渠道');
    assert.equal(await page.locator('#channel-models li').count(), 1);
    await page.locator('#delete-channel').click();
    assert.equal(await page.locator('#notice').textContent(), '渠道已移除；原项目和素材保留。保存后生效。');
    for (const name of ['文字渠道', '图片渠道']) {
      await page.locator('#add-channel').click();
      await page.getByRole('textbox', { name: '渠道名称' }).fill(name);
      await page.locator('[name="baseUrl"]').fill('https://example.com/v1');
      await page.locator('#new-model').fill('same-model'); await page.locator('#new-capability').selectOption(name === '文字渠道' ? 'text' : 'image');
      await page.locator('#add-model').click();
    }
    for (const [role, name] of [['director', '文字渠道'], ['text', '文字渠道'], ['image', '图片渠道']]) {
      const options = await page.locator(`[data-role="${role}"] option`).evaluateAll(options => options.map(option => ({ text: option.textContent, value: option.value })));
      await page.locator(`[data-role="${role}"]`).selectOption(options.find(option => option.text.includes(name)).value);
    }
    await page.locator('#save-models').click(); await page.locator('#notice').filter({ hasText: '全部渠道和默认模型已保存' }).waitFor();
    page.on('dialog', countDialog);
    await page.locator('[data-page="home"]').click();
    assert.equal(dialogs, 0); page.off('dialog', countDialog);
    await page.locator('[data-page="models"]').click();
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
  } finally { await app.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(taskRoot, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
