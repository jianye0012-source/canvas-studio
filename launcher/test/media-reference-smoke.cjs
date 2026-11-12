const { chromium } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { Runtime } = require('../lib/runtime.cjs');
const { ConfigStore } = require('../lib/config.cjs');
const { browserExecutable } = require('../lib/browser.cjs');
const { terminateChild } = require('../lib/process-control.cjs');

(async () => {
  const root = path.resolve(__dirname, '../..');
  const directory = await fs.mkdtemp(path.join(root, 'work/tmp/media-reference-'));
  const folder = path.join(directory, '中文 图片'); await fs.mkdir(folder);
  const store = await new ConfigStore(directory, value => Buffer.from(value), value => value.toString()).initialize();
  let pending, hold = false, picks = [];
  const choose = files => hold ? new Promise(resolve => { pending = () => resolve(typeof files === 'string' ? undefined : []); }) : Promise.resolve(files);
  const runtime = new Runtime({ store, root: path.join(root, 'work', process.platform === 'win32' ? 'bundle-windows' : 'bundle-linux'), development: true,
    chooseFolder: () => choose(folder), chooseMedia: () => choose(picks), cancelPicker: () => { pending?.(); pending = null; } });
  let browser, dev, page;
  const errors = [];
  try {
    await runtime.start({ open: false });
    if (process.env.CANVAS_TEST_DEV === '1') {
      const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port; await new Promise(resolve => server.close(resolve));
      const log = require('node:fs').openSync(path.join(root, 'work/media-reference-dev.log'), 'w');
      dev = spawn(process.execPath, [path.join(root, 'web/node_modules/next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: path.join(root, 'web'), detached: true, env: { ...process.env, TMPDIR: path.join(root, 'work/tmp'), API_BASE_URL: `http://127.0.0.1:${runtime.apiPort}`, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', log, log] });
      require('node:fs').closeSync(log); dev.ownsProcessGroup = true;
      for (let i = 0; ; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/local-mode`)).status) break; } catch {} if (i > 90) throw new Error('开发服务启动超时'); await delay(500); }
      runtime.gateway.webPort = port;
      const upgrades = runtime.gateway.server.listeners('upgrade');
      runtime.gateway.server.removeAllListeners('upgrade');
      runtime.gateway.server.on('upgrade', (request, socket, head) => {
        if (request.url.startsWith('/_next/webpack-hmr')) runtime.gateway.proxy.ws(request, socket, head, { target: `http://127.0.0.1:${port}` });
        else for (const listener of upgrades) listener.call(runtime.gateway.server, request, socket, head);
      });
    }
    browser = await chromium.launch({ executablePath: await browserExecutable({ browser: 'chrome' }), headless: true, args: ['--no-sandbox'], env: { ...process.env, TMPDIR: path.join(root, 'work/tmp') } });
    page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') console.error('BROWSER', message.text().slice(0, 400)); });
    page.on('response', response => { if (response.status() >= 400) console.error('HTTP', response.status(), response.url()); });
    await page.goto(runtime.gateway.launchUrl(), { timeout: 120000 }); await page.waitForURL('**/canvas', { timeout: 120000 });
    await page.getByRole('button', { name: '新建画布', exact: true }).first().waitFor({ timeout: 120000 });
    const images = await page.evaluate(() => ['red', 'blue'].map(color => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32; const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 32, 32); return canvas.toDataURL(); }));
    for (let i = 0; i < images.length; i++) await fs.writeFile(path.join(folder, `图片${i + 1}.png`), Buffer.from(images[i].split(',')[1], 'base64'));
    picks = [path.join(folder, '图片1.png')];
    const model = 'fixture/image-to-image';
    await page.evaluate(async model => {
      const configured = await fetch('/local/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channels: [{ id: 'rh', name: '参考图验证', enabled: true, protocol: 'runninghub-standard', baseUrl: 'https://www.runninghub.cn', apiKey: 'test-key', models: [model], runningHubModels: { [model]: { type: 'image', name: '测试图生图', required: ['prompt', 'imageUrls'], properties: { prompt: { type: 'string' }, imageUrls: { type: 'array', items: { type: 'string' }, maxItems: 10 } } } } }], imageModel: model, imageChannelId: 'rh' }) });
      if (!configured.ok) throw new Error(await configured.text());
      const now = new Date().toISOString();
      const project = { id: 'reference-proof', title: '参考图验证', createdAt: now, updatedAt: now, nodes: [
        { id: 'input-a', type: 'image', title: '参考图甲', position: { x: 0, y: 0 }, width: 240, height: 240, metadata: {} },
        { id: 'input-b', type: 'image', title: '参考图乙', position: { x: 0, y: 360 }, width: 240, height: 240, metadata: {} },
        { id: 'output', type: 'image', title: '图生图结果', position: { x: 500, y: 0 }, width: 240, height: 240, metadata: { prompt: '保持参考图的颜色和结构' } },
        { id: 'loop', type: 'folder-loop', title: 'FOR 文件夹循环', position: { x: 900, y: 0 }, width: 380, height: 340, metadata: {} },
      ], connections: [], chatSessions: [], activeChatId: null, agentConfig: null, backgroundMode: 'dots', showImageInfo: false, viewport: { x: 380, y: 180, k: 0.8 }, sidePanel: { open: true, width: 280 }, agentPanel: { open: false, width: 464 }, autoTitlePending: false };
      const response = await fetch('/api/v1/canvas/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: project }) });
      const result = await response.json();
      if (!response.ok || result.code !== 0) throw new Error(JSON.stringify(result));
    }, model);
    await page.goto(runtime.gateway.origin + '/canvas/reference-proof', { timeout: 120000 });
    const input = id => page.locator(`[data-node-id="${id}"]`);
    await input('input-a').click();
    await page.getByRole('button', { name: '上传图片', exact: true }).click();
    await page.getByRole('button', { name: '用本机窗口选择', exact: true }).click();
    await input('input-a').locator('img').first().waitFor();
    console.log('PASS image node native selection imports a local image');
    hold = true;
    await input('input-b').click();
    await page.getByRole('button', { name: '上传图片', exact: true }).click();
    await page.getByRole('button', { name: '用本机窗口选择', exact: true }).click();
    await page.getByRole('button', { name: '取消本机选择', exact: true }).waitFor();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '选择文件', exact: true }).click();
    await (await chooser).setFiles(path.join(folder, '图片2.png'));
    await input('input-b').locator('img').first().waitFor();
    assert.equal(pending, null); hold = false;
    console.log('PASS pending native selection cancels and a real browser file chooser imports another image');
    hold = true;
    await page.getByRole('button', { name: '选文件夹', exact: true }).click();
    await page.getByRole('button', { name: '取消文件夹选择', exact: true }).click();
    await page.getByRole('button', { name: '取消文件夹选择', exact: true }).waitFor({ state: 'detached' });
    hold = false;
    await page.getByRole('button', { name: '选文件夹', exact: true }).click();
    await input('loop').getByText('待运行 / 可继续 · 0 / 2', { exact: true }).waitFor();
    console.log('PASS folder selection cancels, reopens and scans Chinese image paths');
    const savedReferences = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/canvas/projects' && response.request().postDataJSON()?.data?.connections?.length === 2);
    await input('output').click();
    await page.getByRole('button', { name: '从画布选择参考节点', exact: true }).click();
    await input('input-b').click(); await input('input-a').click();
    await page.keyboard.press('Escape');
    await page.getByText('参考内容 · 2', { exact: true }).waitFor();
    assert.equal((await (await savedReferences).json()).data.connections.length, 2);
    await page.reload();
    await input('output').click();
    await page.getByText('参考内容 · 2', { exact: true }).waitFor();
    const previews = page.getByText('参考内容 · 2', { exact: true }).locator('..').locator('img');
    assert.equal(await previews.count(), 2);
    let request;
    await page.route('**/api/v1/canvas/image-tasks', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      request = route.request().postDataJSON();
      await route.fulfill({ json: { code: 0, data: { id: request.clientTaskId, status: 'completed', image_url: images[0] } } });
    });
    await page.getByRole('button', { name: '生成', exact: true }).click();
    await input('output').locator('img').first().waitFor();
    assert.deepEqual(request.request.imageUrls, [images[1], images[0]]);
    assert.equal(request.channelId, 'rh'); assert.equal(request.request.model, model);
    assert.equal(errors.length, 0, errors.join('\n'));
    await page.screenshot({ path: path.join(root, 'work/media-reference-verified.png') });
    console.log('PASS reference selection survives saving and reopening, shows both thumbnails and sends ordered local image bytes to the selected RunningHub model');
  } catch (error) {
    console.error('BROWSER_ERRORS', errors);
    if (page) {
      await page.screenshot({ path: path.join(root, 'work/media-reference-failure.png') }).catch(() => {});
      await fs.writeFile(path.join(root, 'work/media-reference-failure.txt'), await page.locator('body').innerText()).catch(() => {});
    }
    throw error;
  } finally {
    await browser?.close(); await runtime.stop(); if (dev) await terminateChild(dev, true);
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
