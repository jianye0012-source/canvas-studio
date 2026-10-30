const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '../..');
  const runtime = JSON.parse(await fs.readFile(path.join(root, 'work/smoke-runtime.json'), 'utf8'));
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'], env: { ...process.env, TMPDIR: path.join(root, 'work/tmp') } });
  const errors = [], results = [];
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(runtime.launchUrl); await page.waitForURL('**/canvas');
    assert.equal(await page.getByRole('link', { name: '登录', exact: true }).count(), 0);
    let projects = await page.evaluate(() => fetch('/api/v1/canvas/projects').then(r => r.json()).then(value => value.data));
    if (!projects.length) {
      await page.getByRole('button', { name: '新建画布', exact: true }).first().click();
      await page.waitForURL('**/canvas/*'); await page.waitForTimeout(1000);
      projects = await page.evaluate(() => fetch('/api/v1/canvas/projects').then(r => r.json()).then(value => value.data));
    }
    const projectId = projects[0].id;
    await page.goto(`${runtime.url}/canvas/${projectId}`);
    await page.getByLabel('重置视图', { exact: true }).click();
    if (!projects[0].nodes.some(node => node.type === 'director')) {
      await page.getByLabel('导演台', { exact: true }).click(); await page.mouse.click(850, 450);
    }
    await page.getByRole('button', { name: '打开导演台', exact: true }).first().click();
    await page.frameLocator('iframe[title="3D导演台"]').locator('.canvas-return-bar').waitFor();
    const frame = page.frames().find(frame => frame.url().includes('/cozy/app'));
    await frame.locator('.topbar-mcp[data-state="connected"]').waitFor();
    await frame.locator('.canvas-return-bar').getByText('已保存到本机', { exact: true }).waitFor();
    await frame.locator('.project-browser-backdrop').waitFor({ state: 'detached' });
    results.push('免登录、导演台加载、自动落盘及同源 WebSocket 连接通过');
    const fresh = await frame.evaluate(() => window.__cozyclay.runStudioAction('project.new', { name: '联调白模导演台', previsMode: 'animation', castStyle: 'rig' }));
    assert.equal(fresh?.ok, true);
    await frame.waitForFunction(() => window.__cozyclay.characters.length === 0);
    if (!await frame.evaluate(() => window.__cozyclay.characters.length)) {
      await frame.getByRole('button', { name: '添加', exact: true }).first().click();
      await frame.getByText('Y Bot', { exact: true }).first().click();
    }
    await frame.waitForFunction(() => Boolean(window.__cozyclay?.rigA));
    const setup = await frame.evaluate(async () => {
      const api = window.__cozyclay;
      const added = await api.runStudioAction('object.add', { kind: 'cube', name: '联调白模道具', placement: { x: 1.5, z: 1.5, y: 0 } });
      const object = { id: added?.affectedIds?.[0] };
      if (!object.id) throw new Error('object.add: ' + JSON.stringify(added));
      await api.runStudioAction('object.update', { id: object.id, patch: { name: '修改后的白模道具', x: 1.8 } });
      const characterId = api.characters[0].id;
      const motion = await api.runStudioAction('motion.compile', { characterId, spec: { schema: 'cozyclay.motion-spec.v1', fps: 24, frames: 90, use: [{ skill: 'standIdle', f0: 0, args: { at: [0, 0], heading: 0 } }, { skill: 'walkTo', f0: 0, args: { heading: 0, steps: 2, period: 16, step: 0.35 } }] }, install: true });
      return { object, motion };
    });
    assert.ok(setup.object.id, '创建道具应返回对象编号');
    assert.equal(setup.motion?.ok, true, JSON.stringify(setup.motion));
    results.push(`白模角色、道具修改及 90 帧动作编译通过；QA=${setup.motion.output?.qa?.ok}`);
    const imported = await frame.evaluate(async () => {
      const obj = 'o TestTriangle\nv 0 0 0\nv 0.5 0 0\nv 0 0.5 0\nf 1 2 3\n';
      return window.__cozyclay.importAsset({ dataUrl: 'data:model/obj;base64,' + btoa(obj), name: '联调导入模型.obj', placeAs: 'mesh' });
    });
    assert.ok(imported);
    await frame.getByRole('button', { name: '保存场景', exact: true }).click();
    await frame.locator('.canvas-return-bar').getByText('已保存到本机', { exact: true }).waitFor();
    const exported = JSON.parse(await frame.evaluate(() => window.__cozyclayProject.export()));
    assert.ok(exported.resources.assets.length, '导入模型应包含在项目文件中');
    results.push('模型导入及资产嵌入项目文件通过');
    await frame.getByRole('button', { name: '截图到画布', exact: true }).click();
    await frame.locator('.canvas-return-bar').getByText('截图已发送到画布', { exact: true }).waitFor();
    await frame.getByRole('button', { name: '动画到画布', exact: true }).click();
    await frame.locator('.canvas-return-bar').getByText('动画已发送到画布', { exact: true }).waitFor({ timeout: 120000 });
    await frame.getByRole('button', { name: '← 返回画布', exact: true }).click();
    await page.locator('iframe[title="3D导演台"]').waitFor({ state: 'detached' });
    await page.waitForTimeout(1000);
    const saved = await page.evaluate(id => fetch('/api/v1/canvas/projects').then(r => r.json()).then(result => result.data.find(project => project.id === id)), projectId);
    assert.ok(saved.nodes.some(node => node.type === 'image'), '截图应出现在画布');
    const imageNode = saved.nodes.filter(node => node.type === 'image').at(-1);
    assert.ok(imageNode.metadata.storageKey.startsWith('server:'), '截图应直接保存到磁盘');
    const videoNode = saved.nodes.filter(node => node.type === 'video').at(-1); assert.ok(videoNode, '动画应出现在画布');
    assert.ok(videoNode.metadata.storageKey.startsWith('server:'), '动画应保存到磁盘');
    const media = await page.evaluate(async id => { const response = await fetch('/api/files/' + id + '/content', { headers: { Range: 'bytes=0-15' } }); return { status: response.status, bytes: (await response.arrayBuffer()).byteLength }; }, videoNode.metadata.storageKey.slice('server:'.length));
    assert.deepEqual(media, { status: 206, bytes: 16 });
    const assetData = await page.evaluate(() => fetch('/api/v1/user-data/assets').then(r => r.json()).then(value => value.data));
    assert.ok(assetData.assets.some(asset => asset.source === 'Director' && asset.kind === 'image'));
    assert.ok(assetData.assets.some(asset => asset.source === 'Director' && asset.kind === 'video'));
    assert.ok(saved.connections.length >= 2);
    results.push('截图、MP4 动画回传画布并持久化连线通过');
    results.push('截图与动画直接落盘、素材库同步及 MP4 分段读取通过');
    const directorId = saved.nodes.find(node => node.type === 'director').id;
    const envelope = JSON.parse(await fs.readFile(path.join(runtime.dataDir, 'projects/director', directorId + '.json'), 'utf8'));
    assert.ok(envelope.project.resources.assets.length);
    const second = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const another = await second.newPage(); another.on('pageerror', error => errors.push(error.message));
    await another.goto(runtime.launchUrl); await another.waitForURL('**/canvas');
    await another.getByText(saved.title, { exact: true }).first().waitFor();
    await another.goto(`${runtime.url}/canvas/${projectId}`);
    await another.getByLabel('重置视图', { exact: true }).click();
    await another.getByRole('button', { name: '打开导演台', exact: true }).first().click();
    const other = another.frameLocator('iframe[title="3D导演台"]');
    await other.locator('.canvas-return-bar').getByText('已保存到本机', { exact: true }).waitFor();
    await other.locator('.project-browser-backdrop').waitFor({ state: 'detached' });
    const secondFrame = another.frames().find(frame => frame.url().includes('/cozy/app'));
    await secondFrame.waitForFunction(() => Boolean(window.__cozyclay?.rigA && window.__cozyclay?.shotCam));
    await another.waitForTimeout(700);
    const restored = JSON.parse(await secondFrame.evaluate(() => window.__cozyclayProject.export()));
    assert.equal(restored.resources.assets.length, envelope.project.resources.assets.length);
    assert.ok(JSON.stringify(restored).includes('修改后的白模道具'));
    assert.ok(JSON.stringify(restored).includes('cozyclay.motion-spec.v1'));
    results.push('全新浏览器资料下恢复场景、导入资产及动作通过');
    await another.screenshot({ path: path.join(root, 'outputs/白模导演台联调.png') });
    const beforeFailure = await another.evaluate(id => fetch('/api/v1/canvas/projects').then(r => r.json()).then(result => result.data.find(project => project.id === id).nodes.length), projectId);
    await another.route('**/api/v1/files', route => route.fulfill({ status: 507, contentType: 'application/json', body: JSON.stringify({ code: 1, data: null, msg: '模拟磁盘不可写' }) }));
    await other.getByRole('button', { name: '截图到画布', exact: true }).click();
    await other.locator('.canvas-return-bar .error').waitFor();
    assert.match(await other.locator('.canvas-return-bar .error').innerText(), /未写入磁盘/);
    await another.unroute('**/api/v1/files');
    const afterFailure = await another.evaluate(id => fetch('/api/v1/canvas/projects').then(r => r.json()).then(result => result.data.find(project => project.id === id).nodes.length), projectId);
    assert.equal(afterFailure, beforeFailure);
    results.push('模拟磁盘写入失败时明确提示，不生成虚假成功节点');
    assert.deepEqual(errors, []);
    results.push('浏览器脚本运行无未处理异常');
    await fs.writeFile(path.join(root, 'outputs/浏览器联调结果.json'), JSON.stringify({ passed: true, results }, null, 2));
    console.log(JSON.stringify({ passed: true, results }, null, 2));
  } catch (error) {
    for (const context of browser.contexts()) for (const item of context.pages()) console.error('页面状态', item.url(), (await item.locator('body').innerText().catch(() => '')).slice(-1000));
    for (const frame of page.frames().filter(frame => frame.url().includes('/cozy/app'))) console.error('导演台状态：', await frame.locator('.canvas-return-bar').innerText().catch(() => '未就绪'));
    await page.screenshot({ path: path.join(root, 'work/browser-smoke-failure.png') }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
