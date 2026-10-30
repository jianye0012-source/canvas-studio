const { chromium } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '../..');
  const runtime = JSON.parse(await fs.readFile(path.join(root, 'work/smoke-runtime.json'), 'utf8'));
  let calls = 0;
  const upstream = http.createServer(async (req, res) => {
    if (req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return; }
    for await (const _chunk of req) {} calls++;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const chunk = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'transport-test', object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: 'smoke-director', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    chunk({ role: 'assistant', content: '模型接口联调通过' }); chunk({}, 'stop'); res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'], env: { ...process.env, TMPDIR: path.join(root, 'work/tmp') } });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  let original;
  try {
    await page.goto(runtime.launchUrl); await page.waitForURL('**/canvas');
    const projects = await page.evaluate(() => fetch('/api/v1/canvas/projects').then(r => r.json()).then(value => value.data));
    await page.getByText(projects[0].title, { exact: true }).first().waitFor();
    original = await page.evaluate(() => fetch('/local/config').then(r => r.json()));
    await page.evaluate(async baseUrl => { const config = await fetch('/local/config').then(r => r.json()); config.channels = config.channels.map(channel => ({ ...channel, baseUrl })); const response = await fetch('/local/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config) }); if (!response.ok) throw new Error('测试配置失败'); }, `http://127.0.0.1:${upstream.address().port}`);
    await page.goto(`${runtime.url}/canvas/${projects[0].id}`);
    await page.getByLabel('重置视图', { exact: true }).click();
    await page.getByRole('button', { name: '打开导演台', exact: true }).first().click();
    const studio = page.frameLocator('iframe[title="3D导演台"]');
    await studio.locator('.topbar-mcp[data-state="connected"]').waitFor();
    await studio.locator('.canvas-return-bar').getByText('已保存到本机', { exact: true }).waitFor();
    await studio.getByTestId('studio-agent-bar').click();
    const composer = studio.locator('textarea.agent-input:visible'); await composer.waitFor();
    for (let index = 0; index < 2; index++) {
      await composer.fill(`这是第 ${index+1} 次接口连通性测试，请只回复“模型接口联调通过”，不修改场景。`);
      await studio.locator('[data-fid="agent_send"]:visible').click();
      await studio.locator('.agent-send:not(.stop)').waitFor({ timeout: 45000 });
      await page.waitForTimeout(300);
    }
    assert.ok(calls >= 2, '两次请求都必须到达兼容接口');
    const cookies = await page.context().cookies();
    assert.ok(cookies.some(cookie => cookie.name === 'studio_owner' && cookie.path === '/cozy/agent'));
    assert.match(await studio.locator('body').innerText(), /模型接口联调通过/);
    await fs.writeFile(path.join(root, 'outputs/模型接口联调结果.json'), JSON.stringify({ passed: true, provider: '本地测试替身；不代表真实 AI 生成质量', calls, verified: ['OpenAI 兼容 SSE 转发', '白模面板连续两轮请求', '会话 Cookie 路径适配'] }, null, 2));
    console.log('AI 面板连续两轮兼容接口传输及会话 Cookie 通过，调用次数', calls);
  } catch (error) {
    console.error((await page.locator('body').innerText()).slice(-1500));
    for (const frame of page.frames().filter(frame => frame.url().includes('/cozy/app'))) console.error((await frame.locator('body').innerText()).slice(-2000));
    throw error;
  } finally {
    if (original) await page.evaluate(config => fetch('/local/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config) }), original).catch(() => {});
    await browser.close(); await new Promise(resolve => upstream.close(resolve));
  }
})().catch(error => { console.error(error); process.exit(1); });
