const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { CanvasBridge } = require('../lib/canvas-bridge.cjs');
const { FolderStore } = require('../lib/folders.cjs');
const { ConfigStore } = require('../lib/config.cjs');
const { Gateway } = require('../lib/gateway.cjs');

test('专属 MCP 凭据与原项目分离；拒绝无凭据、错误来源，端口变化后配置仍使用同一凭据', async t => {
  const root = await fs.mkdtemp(path.resolve(__dirname, '../../work/tmp/mcp-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = await new ConfigStore(root, async s => Buffer.from(s), async b => b.toString()).initialize();
  const gateway = new Gateway({ store, root, log() {} }); const url = await gateway.listen(0);
  assert.equal((await fetch(url + '/mcp/canvas', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await fetch(url + '/mcp/director', { method: 'POST', headers: { authorization: 'Bearer ' + gateway.mcpToken, origin: 'https://other.example' }, body: '{}' })).status, 403);
  assert.equal((await fetch(url + '/local/mcp/config')).status, 401);
  const headers = { cookie: `canvas_session=${gateway.cookie}` };
  const config = await (await fetch(url + '/local/mcp/config', { headers })).json();
  assert.deepEqual(Object.keys(config.mcpServers), ['canvas-studio-canvas','canvas-studio-director']);
  assert.ok(config.mcpServers['canvas-studio-canvas'].args.includes(path.join(store.dataDir, 'config/mcp-connection.json')));
  assert.ok(!JSON.stringify(config).includes('@tigerowo'));
  const saved = JSON.parse(await fs.readFile(gateway.mcpConfigFile, 'utf8'));
  assert.equal(saved.token.length, 64);
  await gateway.close();
  const reopened = new Gateway({ store, root, log() {} }); await reopened.listen(0); t.after(() => reopened.close());
  assert.equal(reopened.mcpToken, saved.token);
});

test('画布 MCP 独立工具命名，多画布必须指定目标，取消请求会通知页面', async () => {
  const bridge = new CanvasBridge(), events = [];
  const session = id => ({ id, canvasId: 'canvas-' + id, events: { write: text => events.push(text), end() {} }, tools: [{ name: 'get_canvas_summary', inputSchema: { type: 'object', properties: {} } }], pending: new Map() });
  bridge.sessions.set('one', session('one')); bridge.sessions.set('two', session('two'));
  assert.equal(bridge.tools()[1].name, 'canvas_studio_get_canvas_summary');
  await assert.rejects(() => bridge.call('canvas_studio_get_canvas_summary', {}), /workspace_id/);
  const abort = new AbortController();
  const result = bridge.call('canvas_studio_get_canvas_summary', { workspace_id: 'two' }, abort.signal);
  assert.equal(bridge.sessions.get('one').pending.size, 0);
  const pending = [...bridge.sessions.get('two').pending.values()][0]; pending.resolve({ ok: true, id: 'two' });
  assert.deepEqual(await result, { ok: true, id: 'two' });
  const canceled = bridge.call('canvas_studio_get_canvas_summary', { workspace_id: 'one' }, abort.signal); abort.abort();
  await assert.rejects(() => canceled, /取消/); assert.ok(events.some(e => e.includes('tool-cancel')));
  assert.equal(bridge.sessions.get('one').pending.size, 0); bridge.close();
});

test('文件夹循环只读取用户选择的文件夹，中文路径、自然排序、子目录、文件变更和越界保护', async t => {
  const root = await fs.mkdtemp(path.resolve(__dirname, '../../work/tmp/folder-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = path.join(root, '输入素材'); await fs.mkdir(path.join(input, '子目录'), { recursive: true });
  await fs.writeFile(path.join(input, '第10份.txt'), '十'); await fs.writeFile(path.join(input, '第2份.txt'), '二'); await fs.writeFile(path.join(input, '子目录', '文本.md'), '子文件');
  await fs.symlink(path.join(root, 'outside.txt'), path.join(input, '跳过.txt')); await fs.writeFile(path.join(root, 'outside.txt'), '不应读取');
  const store = new FolderStore(root, async () => input); const selected = await store.select();
  const scan = await store.scan(selected.id); assert.deepEqual(scan.files.map(f => f.relativePath), ['第2份.txt', '第10份.txt']);
  assert.equal((await store.scan(selected.id, true)).files.length, 3);
  assert.equal((await store.import(selected.id, scan.files[0])).content, '二');
  const reopened = new FolderStore(root); assert.equal((await reopened.scan(selected.id)).files.length, 2);
  await assert.rejects(() => store.import(selected.id, { ...scan.files[0], id: Buffer.from('../outside.txt').toString('base64url') }), /超出/);
  await fs.writeFile(path.join(input, '第2份.txt'), '已改变'); await assert.rejects(() => store.import(selected.id, scan.files[0]), /修改/);
  await fs.rename(input, input + '-removed'); await assert.rejects(() => store.scan(selected.id)); await assert.rejects(() => fs.stat(input));
});
