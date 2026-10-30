const { chromium } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '../..');
  const runtime = JSON.parse(await fs.readFile(path.join(root, 'work/smoke-runtime.json'), 'utf8'));
  const calls = [], servers = [], taskPrefix = 'multi-video-' + Date.now().toString(36);
  for (const name of ['A', 'B']) {
    const server = http.createServer(async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = raw && req.headers['content-type']?.includes('application/json') ? JSON.parse(raw) : {};
      calls.push({ name, url: req.url, key: req.headers.authorization, model: body.model, stream: body.stream });
      if (req.headers.authorization !== `Bearer channel-test-${name}`) { res.writeHead(401); res.end('{}'); return; }
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/models') { res.end(JSON.stringify({ data: ['shared-chat', 'shared-image', 'shared-video'].map(id => ({ id })) })); return; }
      if (req.url === '/v1/chat/completions') {
        if (!body.stream) { res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '渠道 ' + name } }] })); return; }
        res.setHeader('content-type', 'text/event-stream');
        const chunk = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'multi-test', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
        chunk({ role: 'assistant', content: `渠道 ${name} 联调通过` }); chunk({}, 'stop'); res.end('data: [DONE]\n\n'); return;
      }
      if (req.url === '/v1/images/generations') { res.end(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGAAAAABJRU5ErkJggg==' }] })); return; }
      if (req.url === '/v1/videos' || req.url === '/v1/videos/' + taskPrefix + '-' + name) { res.end(JSON.stringify({ id: taskPrefix + '-' + name, object: 'video', model: 'shared-video', status: 'processing', progress: 42 })); return; }
      res.writeHead(404); res.end('{}');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push(server);
  }
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'], env: { ...process.env, TMPDIR: path.join(root, 'work/tmp') } });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  let original;
  try {
    await page.goto(runtime.launchUrl); await page.waitForURL('**/canvas');
    original = await page.evaluate(() => fetch('/local/config').then(r => r.json()));
    await page.goto(runtime.url + '/local-settings');
    for (const [index, name] of ['A', 'B'].entries()) {
      await page.getByRole('button', { name: '＋ 新增渠道', exact: true }).click();
      await page.getByLabel('渠道名称', { exact: true }).fill('联调渠道 ' + name);
      await page.getByLabel('接口地址', { exact: true }).fill(`http://127.0.0.1:${servers[index].address().port}/v1`);
      await page.getByLabel('API Key', { exact: true }).fill('channel-test-' + name);
      await page.getByRole('button', { name: '测试此渠道 / 读取模型', exact: true }).click();
      await page.getByRole('status').filter({ hasText: `渠道「联调渠道 ${name}」连接成功` }).waitFor();
      for (const [model, type] of [['shared-chat', 'text'], ['shared-image', 'image'], ['shared-video', 'video']]) {
        await page.getByLabel('模型名称', { exact: true }).fill(model); await page.getByLabel('类型', { exact: true }).selectOption(type);
        await page.getByRole('button', { name: '加入模型', exact: true }).click();
      }
    }
    const selected = await page.getByLabel('白模导演', { exact: true }).locator('option').evaluateAll(options => options.map(option => ({ text: option.textContent, value: option.value })));
    const a = JSON.parse(selected.find(option => option.text.includes('联调渠道 A')).value)[0];
    const b = JSON.parse(selected.find(option => option.text.includes('联调渠道 B')).value)[0];
    for (const [role, id, model] of [['白模导演', a, 'shared-chat'], ['画布文字', b, 'shared-chat'], ['图片生成', b, 'shared-image'], ['视频生成', a, 'shared-video']]) await page.getByLabel(role, { exact: true }).selectOption(JSON.stringify([id, model]));
    await page.getByRole('button', { name: '保存全部配置', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '全部渠道和默认选择已保存' }).waitFor();
    await page.reload(); await page.getByLabel('白模导演', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('白模导演', { exact: true }).inputValue(), JSON.stringify([a, 'shared-chat']));
    const publicConfig = await page.evaluate(() => fetch('/local/config').then(r => r.json()));
    assert.equal(JSON.stringify(publicConfig).includes('channel-test-'), false);
    assert.equal(publicConfig.channels.find(channel => channel.id === a).hasApiKey, true);
    await page.screenshot({ path: path.join(root, 'outputs/多渠道模型配置.png'), fullPage: true });
    const results = await page.evaluate(async ({ a, b }) => {
      const send = async (url, channelId, body) => { const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Model-Channel-ID': channelId }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
      return {
        textA: await send('/api/v1/chat/completions', a, { model: 'shared-chat', messages: [{ role: 'user', content: '连接测试' }], stream: false }),
        textB: await send('/api/v1/chat/completions', b, { model: 'shared-chat', messages: [{ role: 'user', content: '连接测试' }], stream: false }),
        image: await send('/api/v1/images/generations', b, { model: 'shared-image', prompt: '连接测试', n: 1 }),
        video: await send('/api/v1/videos', a, { model: 'shared-video', prompt: '连接测试' }),
      };
    }, { a, b });
    for (const [kind, result] of Object.entries(results)) assert.equal(result.status, 200, kind + ': ' + JSON.stringify(result));
    const pollStart = calls.length;
    await page.evaluate(async b => { const config = await fetch('/local/config').then(r => r.json()); config.videoChannelId = b; await fetch('/local/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config) }); }, b);
    const poll = await page.evaluate(async id => { const response = await fetch('/api/v1/videos/' + id); return { status: response.status, body: await response.json() }; }, taskPrefix + '-A');
    assert.equal(poll.status, 200, JSON.stringify(poll));
    const pollDeadline = Date.now() + 20000;
    while (!calls.slice(pollStart).some(call => call.name === 'A' && call.url === '/v1/videos/' + taskPrefix + '-A') && Date.now() < pollDeadline) await page.waitForTimeout(250);
    assert.ok(calls.slice(pollStart).some(call => call.name === 'A' && call.url === '/v1/videos/' + taskPrefix + '-A'), '等待后台任务轮询原渠道');
    assert.equal(calls.slice(pollStart).some(call => call.name === 'B' && call.url === '/v1/videos/' + taskPrefix + '-A'), false);
    const projects = await page.evaluate(() => fetch('/api/v1/canvas/projects').then(r => r.json()).then(value => value.data));
    await page.goto(`${runtime.url}/canvas/${projects[0].id}`);
    await page.getByLabel('重置视图', { exact: true }).click();
    await page.getByRole('button', { name: '打开导演台', exact: true }).first().click();
    const studio = page.frameLocator('iframe[title="3D导演台"]');
    await studio.locator('.topbar-mcp[data-state="connected"]').waitFor();
    await studio.locator('.canvas-return-bar').getByText('已保存到本机', { exact: true }).waitFor();
    await studio.getByTestId('studio-agent-bar').click();
    const picker = studio.locator('select.agent-model-select:not(.agent-effort-select)'); await picker.waitFor();
    for (const [id, name] of [[a, 'A'], [b, 'B']]) {
      const value = 'openai-compatible/' + id + '::shared-chat';
      await picker.selectOption(value);
      await studio.locator('textarea.agent-input:visible').fill(`渠道 ${name} 连通性测试，只回复联调通过，不改场景。`);
      await studio.locator('[data-fid="agent_send"]:visible').click();
      await studio.locator('.agent-send:not(.stop)').waitFor({ timeout: 45000 }); await page.waitForTimeout(300);
    }
    assert.ok(calls.some(call => call.name === 'A' && call.stream && call.model === 'shared-chat'));
    assert.ok(calls.some(call => call.name === 'B' && call.stream && call.model === 'shared-chat'));
    assert.ok(calls.every(call => call.key === 'Bearer channel-test-' + call.name));
    const result = { passed: true, provider: '本地测试服务，不代表真实 AI 生成质量', verified: ['浏览器新增两个渠道、分别测试、模型分类及默认选择', '重开保留渠道和默认选择；API 不返回密钥', '同名文字模型经 Go 服务选择正确渠道', '图片和视频请求分别路由至指定渠道', '切换默认视频渠道后已有任务仍从原渠道查询', '白模导演下拉选择两个渠道同名模型并分别完成 SSE 请求'] };
    await fs.writeFile(path.join(root, 'outputs/多渠道联调结果.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error((await page.locator('body').innerText()).slice(-1800));
    for (const frame of page.frames().filter(frame => frame.url().includes('/cozy/app'))) console.error((await frame.locator('body').innerText()).slice(-1500));
    await page.screenshot({ path: path.join(root, 'work/multi-channel-failure.png') }); throw error;
  } finally {
    await page.evaluate(id => fetch('/api/v1/video-tasks/' + id, { method: 'DELETE' }), taskPrefix + '-A').catch(() => {});
    if (original) await page.evaluate(config => fetch('/local/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config) }), original).catch(() => {});
    await browser.close(); await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  }
})().catch(error => { console.error(error); process.exit(1); });
