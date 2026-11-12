const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { Runtime } = require('../lib/runtime.cjs');
const { ConfigStore } = require('../lib/config.cjs');
const { normalizeModel } = require('../lib/runninghub-schema.cjs');
const { browserExecutable } = require('../lib/browser.cjs');

(async () => {
  const root = path.resolve(__dirname, '../..');
  const directory = await fs.mkdtemp(path.join(root, 'work/tmp/director-lifecycle-'));
  const location = path.join(directory, '中文 工作区'); await fs.mkdir(location);
  const glb = await fs.readFile(path.join(root, 'integrations/cozyclay/test/fixtures/unit-cube.glb'));
  let submissions = 0;
  const provider = async url => {
    if (url.endsWith('/query')) return Response.json({ taskId: '9000000000001', status: 'SUCCESS', results: [{ outputType: 'glb', url: 'https://fixture.example/cube.glb' }] });
    if (url.endsWith('.glb')) return new Response(glb);
    submissions++; return Response.json({ taskId: '9000000000001', status: 'RUNNING' });
  };
  const store = await new ConfigStore(location, value => Buffer.from(value), value => value.toString(), provider).initialize();
  const model = 'example/text-to-3d', imageModel = 'example/image-to-image';
  await store.save({ channels: [{ id: 'mesh', name: '模拟建模', enabled: true, protocol: 'runninghub-standard', baseUrl: 'https://www.runninghub.cn', apiKey: 'test-only-key', models: [model, imageModel], runningHubModels: {
    [model]: normalizeModel(model, { type: '3d', name: '测试3D模型', required: ['prompt'], properties: { prompt: { type: 'string' } } }),
    [imageModel]: normalizeModel(imageModel, { type: 'image', name: '测试参考图', required: ['prompt', 'imageUrls'], properties: { prompt: { type: 'string' }, imageUrls: { type: 'array', items: { type: 'string' }, maxItems: 10 } } }),
  } }], imageChannelId: 'mesh', imageModel });
  const output = path.join(directory, '另存 模型'); await fs.mkdir(output);
  const runtime = new Runtime({ store, root: path.join(root, 'work', process.platform === 'win32' ? 'bundle-windows' : 'bundle-linux'), development: true, chooseOutput: async () => output });
  let browser, page;
  try {
    await runtime.start({ open: false });
    browser = await chromium.launch({ executablePath: await browserExecutable({ browser: 'chrome' }), headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'], env: { ...process.env, TMPDIR: path.join(root, 'work/tmp') } });
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on('pageerror', error => console.error('DIRECTOR_BROWSER', error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto(runtime.gateway.launchUrl()); await page.waitForURL('**/canvas');
    await page.getByRole('button', { name: '新建画布', exact: true }).first().click(); await page.waitForURL('**/canvas/*');
    await page.getByLabel('导演台', { exact: true }).click(); await page.mouse.click(850, 450);
    await page.getByRole('button', { name: '打开导演台', exact: true }).first().click();
    const panel = page.frameLocator('iframe[title="3D导演台"]');
    await panel.locator('.canvas-return-bar').getByText('已保存到本机', { exact: true }).waitFor();
    let frame = page.frames().find(entry => entry.url().includes('/cozy/app'));
    const created = await frame.evaluate(() => window.__cozyclay.runStudioAction('object.add', { kind: 'cube', name: '重载后保留的白模', placement: { x: 1, y: 0, z: 1 } }));
    assert.ok(created.ok);
    await panel.getByRole('button', { name: '保存场景', exact: true }).click();
    await panel.locator('.canvas-return-bar').getByText('已保存到本机', { exact: true }).waitFor();
    await Promise.all([frame.waitForNavigation({ waitUntil: 'load' }), frame.evaluate(() => { location.reload(); })]);
    await panel.locator('.canvas-return-bar').getByText('已保存到本机', { exact: true }).waitFor({ timeout: 20000 });
    frame = page.frames().find(entry => entry.url().includes('/cozy/app'));
    assert.ok((await frame.evaluate(() => window.__cozyclayProject.export())).includes('重载后保留的白模'));
    console.log('PASS director iframe reload reconnects and restores the saved scene');
    await panel.getByRole('button', { name: 'AI 生成 3D 模型', exact: true }).click();
    await panel.getByLabel('模型描述', { exact: true }).fill('一个白模茶杯');
    await panel.getByRole('button', { name: '提交 3D 生成', exact: true }).click();
    await panel.getByRole('button', { name: '加入场景', exact: true }).waitFor({ timeout: 20000 });
    assert.equal(submissions, 1);
    await panel.getByRole('button', { name: '加入场景', exact: true }).click();
    await panel.getByText('模型已加入场景并保存到本机', { exact: true }).waitFor();
    await panel.getByRole('button', { name: '另存 GLB', exact: true }).click();
    await panel.locator('.canvas-3d-dialog [role=status]').filter({ hasText: '已保存：' }).waitFor();
    assert.deepEqual(await fs.readFile(path.join(output, (await fs.readdir(output))[0])), glb);
    await panel.locator('.canvas-3d-dialog').getByRole('button', { name: '关闭', exact: true }).click();
    let scene = JSON.parse(await frame.evaluate(() => window.__cozyclayProject.export()));
    assert.ok(scene.resources.assets.some(asset => asset.type === 'model/gltf-binary'));
    console.log('PASS mocked cloud 3D submission, persistent download, scene import and native folder export');

    let imageRequest, polls = 0;
    const references = await frame.evaluate(() => ['red', 'blue'].map(color => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16; const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 16, 16); return canvas.toDataURL(); }));
    await page.route('**/api/v1/canvas/image-tasks', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      imageRequest = route.request().postDataJSON();
      await route.fulfill({ json: { code: 0, data: { id: 'blueprint-test', status: 'running' } } });
    });
    await page.route('**/api/v1/canvas/image-tasks/blueprint-test', route => { polls++; return route.fulfill({ json: { code: 0, data: { id: 'blueprint-test', status: 'completed', image_url: references[0] } } }); });
    const blueprint = await frame.evaluate(refs => new Promise(resolve => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => resolve({ error: 'blueprint timeout' }), 20000);
      const listener = event => { if (event.data?.type === 'storyai:director-image-result' && event.data.payload.requestId === requestId) { clearTimeout(timer); window.removeEventListener('message', listener); resolve(event.data.payload); } };
      window.addEventListener('message', listener);
      parent.postMessage({ type: 'storyai:director-image-request', payload: { requestId, prompt: '生成四视图', imageDataUrl: refs[0], referenceDataUrl: refs[1] } }, location.origin);
    }), references);
    assert.equal(blueprint.ok, true, JSON.stringify(blueprint));
    assert.equal(blueprint.width, 16); assert.equal(polls, 1);
    assert.deepEqual(imageRequest.request.imageUrls, references);
    assert.equal(imageRequest.channelId, 'mesh'); assert.equal(imageRequest.request.model, imageModel);
    console.log('PASS director blueprint uses configured image channel, ordered references and local session task polling');

    const compressedPath = path.join(root, 'work/3d-fixtures/LittlestTokyo.glb');
    if (await fs.access(compressedPath).then(() => true, () => false)) {
      const compressed = await fs.readFile(compressedPath);
      const errors = []; page.on('console', message => { if (/could not load mesh|DRACO|decode/i.test(message.text())) errors.push(message.text()); });
      const result = await frame.evaluate(source => window.__cozyclay.importAsset({ dataUrl: source, name: 'Draco模型.glb', placeAs: 'mesh' }), 'data:model/gltf-binary;base64,' + compressed.toString('base64'));
      assert.ok(result);
      await frame.waitForFunction(() => { let scene = window.__cozyclay.shotCam; while (scene && !scene.isScene) scene = scene.parent; let found = false; scene?.traverse(object => { if (object.isMesh && object.geometry?.attributes?.position?.count > 1000) found = true; }); return found; }, { timeout: 20000 });
      assert.equal(errors.length, 0, errors.join('\n'));
      console.log('PASS actual Draco-compressed GLB renders using bundled local WASM decoder');
    }
    await panel.getByRole('button', { name: '保存场景', exact: true }).click();
    await panel.locator('.canvas-return-bar').getByText('已保存到本机', { exact: true }).waitFor();
    await Promise.all([frame.waitForNavigation({ waitUntil: 'load' }), frame.evaluate(() => { location.reload(); })]);
    await panel.locator('.canvas-return-bar').getByText('已保存到本机', { exact: true }).waitFor();
    frame = page.frames().find(entry => entry.url().includes('/cozy/app'));
    scene = JSON.parse(await frame.evaluate(() => window.__cozyclayProject.export()));
    assert.ok(scene.resources.assets.some(asset => asset.type === 'model/gltf-binary'));
    await panel.getByRole('button', { name: '← 返回画布', exact: true }).click();
    await page.locator('iframe[title="3D导演台"]').waitFor({ state: 'detached' });
    const node = page.locator('[data-node-id]').filter({ has: page.getByRole('button', { name: '打开导演台', exact: true }) }).first();
    await node.click({ button: 'right' });
    await page.getByText('复制', { exact: true }).click();
    const nodes = page.locator('[data-node-id]').filter({ has: page.getByRole('button', { name: '打开导演台', exact: true }) });
    await nodes.last().getByRole('button', { name: '打开导演台', exact: true }).click();
    await panel.locator('.canvas-return-bar').getByText('已保存到本机', { exact: true }).waitFor();
    frame = page.frames().find(entry => entry.url().includes('/cozy/app'));
    assert.ok((await frame.evaluate(() => window.__cozyclayProject.export())).includes('重载后保留的白模'));
    const mutation = await frame.evaluate(() => window.__cozyclay.runStudioAction('object.add', { kind: 'cube', name: '复制场景独立道具' })); assert.ok(mutation.ok);
    await panel.getByRole('button', { name: '保存场景', exact: true }).click();
    await panel.locator('.canvas-return-bar').getByText('已保存到本机', { exact: true }).waitFor();
    const saved = await Promise.all((await fs.readdir(path.join(store.dataDir, 'projects/director'))).filter(name => name.endsWith('.json')).map(name => fs.readFile(path.join(store.dataDir, 'projects/director', name), 'utf8')));
    assert.equal(saved.length, 2); assert.equal(saved.filter(value => value.includes('复制场景独立道具')).length, 1);
    console.log('PASS cloned director forks saved scene and writes its own project without changing the original');
  } catch (error) {
    if (page) {
      console.error('DIRECTOR_PAGE', page.url());
      await page.screenshot({ path: path.join(root, 'work/director-lifecycle-failure.png') }).catch(() => {});
      await fs.writeFile(path.join(root, 'work/director-lifecycle-failure.txt'), await page.locator('body').innerText()).catch(() => {});
    }
    throw error;
  } finally {
    await browser?.close(); await runtime.stop(); await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
