const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { ConfigStore } = require('../lib/config.cjs');
const { Model3DTasks } = require('../lib/model-3d-tasks.cjs');
const { MediaExports } = require('../lib/media-files.cjs');
const { normalizeModel } = require('../lib/runninghub-schema.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.resolve(__dirname, '../../work/tmp/model-3d-'));
  const directory = path.join(root, '中文 工作区'); await fs.mkdir(directory);
  const output = path.join(root, '模型 输出'); await fs.mkdir(output);
  const bytes = await fs.readFile(path.resolve(__dirname, '../../integrations/cozyclay/test/fixtures/unit-cube.glb'));
  const model = 'example/text-to-3d', imageModel = 'example/image-to-3d';
  const properties = { prompt: { type: 'string', maxLength: 20000 }, enablePbr: { type: 'boolean', default: false }, generateType: { type: 'string', enum: ['Normal', 'Geometry'], default: 'Normal' }, faceCount: { type: 'integer', minimum: 10000, maximum: 1500000, default: 500000 } };
  const spec = normalizeModel(model, { type: '3d', name: '测试文生3D', required: ['prompt', 'enablePbr', 'generateType'], properties });
  const imageSpec = normalizeModel(imageModel, { type: '3d', name: '测试图生3D', required: ['imageUrl'], properties: { imageUrl: { type: 'string' }, leftImageUrl: { type: 'string' } } });
  const state = { urls: [], submits: 0, queries: 0, uploads: 0, finished: true, corrupt: false, uncertain: false, queryError: false };
  const fetchImpl = async (url, options) => {
    state.urls.push(url);
    if (url.endsWith('/media/upload/binary')) { state.uploads++; assert.ok(options.body instanceof FormData); return Response.json({ code: 0, data: { download_url: `https://files.example/${state.uploads}.png` } }); }
    if (url.endsWith('/query')) {
      state.queries++; assert.equal(JSON.parse(options.body).taskId, '9000000000001');
      if (state.queryError) return Response.json({ taskId: '9000000000001', status: '', errorCode: '806', errorMessage: 'APIKEY_USER_NOT_FOUND' });
      return Response.json({ taskId: '9000000000001', status: state.finished ? 'SUCCESS' : 'RUNNING', results: state.finished ? [{ outputType: 'glb', url: 'https://files.example/model.glb' }] : null });
    }
    if (url.endsWith('.glb')) return new Response(state.corrupt ? Buffer.from('not a model') : bytes);
    state.submits++;
    if (state.uncertain) throw new TypeError('fetch failed');
    const body = JSON.parse(options.body);
    if (url.endsWith('/text-to-3d')) assert.deepEqual(body, { prompt: '一个白模茶杯', enablePbr: false, generateType: 'Geometry', faceCount: 50000 });
    else assert.deepEqual(body, { [state.frontField || 'imageUrl']: 'https://files.example/1.png', leftImageUrl: 'https://files.example/2.png' });
    return Response.json({ taskId: '9000000000001', status: 'QUEUED' });
  };
  const store = await new ConfigStore(directory, value => Buffer.from(value), value => value.toString(), fetchImpl).initialize();
  await store.save({ channels: [{ id: 'mesh', name: '国内建模渠道', protocol: 'runninghub-standard', baseUrl: 'https://www.runninghub.cn', apiKey: 'test-only-key', models: [model, imageModel], runningHubModels: { [model]: spec, [imageModel]: imageSpec } }] });
  const jobs = new Set(), logs = [];
  const open = () => { const value = new Model3DTasks(store, { exporter: new MediaExports(store.dataDir), choose: async () => output, log: message => logs.push(message) }); jobs.add(value); return value; };
  t.after(async () => { for (const job of jobs) await job.close(); await fs.rm(root, { recursive: true, force: true }); });
  const input = { id: crypto.randomUUID(), sceneId: 'director-test', channelId: 'mesh', model, prompt: '一个白模茶杯', parameters: { generateType: 'Geometry', faceCount: 50000 } };
  return { store, bytes, output, state, open, input, imageModel, logs };
}

test('损坏的任务记录不影响列表，其他导演台与未写盘更新保持独立', async t => {
  const { open, input, logs } = await fixture(t); const jobs = open(); await jobs.create(input);
  const valid = await jobs.read(input.id);
  const other = { ...valid, id: crypto.randomUUID(), sceneId: 'other' };
  await jobs.write(other);
  const otherBytes = await fs.readFile(jobs.file(other.id));
  const pending = { ...valid, id: crypto.randomUUID() };
  await jobs.write(pending); jobs.unwritten.set(pending.id, { ...pending, status: 'download_failed' });
  const covered = { ...valid, id: crypto.randomUUID() };
  await fs.writeFile(jobs.file(covered.id), '{broken'); jobs.unwritten.set(covered.id, covered);
  const bad = new Map([
    [crypto.randomUUID(), Buffer.from('{broken')],
    [crypto.randomUUID(), Buffer.from(JSON.stringify({ ...valid, id: crypto.randomUUID(), format: 2 }))],
  ]);
  for (const [id, bytes] of bad) await fs.writeFile(jobs.file(id), bytes);
  for (let i = 0; i < 3; i++) {
    const listed = await jobs.list('director-test');
    assert.deepEqual(new Set(listed.map(task => task.id)), new Set([input.id, pending.id, covered.id]));
    assert.equal(listed.find(task => task.id === pending.id).status, 'download_failed');
  }
  for (const [id, bytes] of bad) {
    assert.deepEqual(await fs.readFile(jobs.file(id)), bytes);
    assert.equal(logs.filter(message => message.includes(id + '.json')).length, 1);
  }
  assert.deepEqual(await fs.readFile(jobs.file(other.id)), otherBytes);
  assert.equal(await fs.readFile(jobs.file(covered.id), 'utf8'), '{broken');
});

test('3D 按官方参数提交、同编号防重、保存 GLB 并另存中文目录且不覆盖同名文件', async t => {
  const { open, input, state, bytes, output } = await fixture(t); const jobs = open();
  assert.equal(jobs.models().length, 2);
  assert.equal((await jobs.create(input)).status, 'processing');
  await jobs.create(input); assert.equal(state.submits, 1);
  const complete = await jobs.refresh(input.id); assert.equal(complete.status, 'completed');
  assert.deepEqual(await fs.readFile((await jobs.open(input.id)).file), bytes);
  const a = await jobs.export(input.id), b = await jobs.export(input.id); assert.notEqual(a.name, b.name);
  assert.deepEqual(await fs.readFile(path.join(output, b.name)), bytes);
  assert.ok(!(await fs.readFile(jobs.file(input.id), 'utf8')).includes('test-only-key'));
  assert.equal((await jobs.list('director-test')).length, 1);
});

test('重启后查询原 3D 任务及原站点，下载损坏可重试但不重新生成', async t => {
  const { open, input, state, store } = await fixture(t); let jobs = open();
  await jobs.create(input); await jobs.close();
  store.value.channels[0].baseUrl = 'https://www.runninghub.ai';
  jobs = open(); await jobs.ready; state.corrupt = true;
  assert.equal((await jobs.refresh(input.id)).status, 'download_failed');
  assert.equal((await fs.readdir(jobs.root)).some(name => name.endsWith('.part')), false);
  state.corrupt = false; const saved = await jobs.read(input.id); saved.nextPollAt = 0; await jobs.write(saved);
  assert.equal((await jobs.refresh(input.id)).status, 'completed'); assert.equal(state.submits, 1);
  assert.ok(state.urls.filter(url => url.endsWith('/query')).every(url => url.startsWith('https://www.runninghub.cn/')));
});

test('图生3D保留正面与侧面引用顺序，分别上传后提交', async t => {
  const { open, input, state, imageModel } = await fixture(t); const jobs = open();
  await jobs.create({ ...input, model: imageModel, prompt: '', parameters: {}, references: { imageUrl: 'data:image/png;base64,AQ==', leftImageUrl: 'data:image/png;base64,Ag==' } });
  assert.equal(state.uploads, 2); assert.equal(state.submits, 1);
});

test('多视图 3D 的 frontImageUrl 识别为参考图并上传，不当作普通字符串', async t => {
  const { open, input, state, store, imageModel } = await fixture(t); const jobs = open();
  const spec = store.value.channels[0].runningHubModels[imageModel];
  spec.properties.frontImageUrl = spec.properties.imageUrl; delete spec.properties.imageUrl; spec.required = ['frontImageUrl'];
  state.frontField = 'frontImageUrl';
  assert.ok(jobs.models().find(model => model.model === imageModel).fields.find(field => field.name === 'frontImageUrl').media);
  await jobs.create({ ...input, model: imageModel, prompt: '', parameters: {}, references: { frontImageUrl: 'data:image/png;base64,AQ==', leftImageUrl: 'data:image/png;base64,Ag==' } });
  assert.equal(state.uploads, 2); assert.equal(state.submits, 1);
});

test('提交未确认不自动重发，数据盘不可用时不提交并拒绝越界任务编号', async t => {
  const { open, input, state, store } = await fixture(t); const jobs = open(); state.uncertain = true;
  assert.equal((await jobs.create(input)).status, 'uncertain');
  await jobs.create(input); await jobs.refresh(input.id); assert.equal(state.submits, 1);
  assert.throws(() => jobs.refresh('../outside'), /编号无效/);
  await jobs.close(); await fs.rm(store.dataDir, { recursive: true, force: true });
  await assert.rejects(jobs.create({ ...input, id: crypto.randomUUID() })); assert.equal(state.submits, 1);
  await assert.rejects(fs.access(store.dataDir), { code: 'ENOENT' });
});

test('中断的提交记录显示未确认，不冒充仍在运行', async t => {
  const { open, input, state } = await fixture(t); const jobs = open(); await jobs.create(input); await jobs.close();
  const saved = await jobs.read(input.id); delete saved.taskId; saved.status = 'submitting'; await jobs.write(saved);
  const restored = open(); await restored.ready;
  assert.equal((await restored.read(input.id)).status, 'uncertain'); assert.equal(state.submits, 1);
});

test('3D 查询返回错误码时任务立即失败且不再轮询', async t => {
  const { open, input, state } = await fixture(t); const jobs = open();
  await jobs.create(input);
  state.queryError = true;
  const failed = await jobs.refresh(input.id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /APIKEY_USER_NOT_FOUND/);
  const queries = state.queries;
  await jobs.refresh(input.id);
  assert.equal(state.queries, queries);
});

test('处理中超过 24 小时失败，已完成与下载待重试不受此时限影响', async t => {
  const { open, input, state } = await fixture(t); const jobs = open();
  await jobs.create(input);
  let task = await jobs.read(input.id); task.createdAt = Date.now() - 25 * 3600_000; await jobs.write(task);
  const expired = await jobs.refresh(input.id);
  assert.equal(expired.status, 'failed'); assert.match(expired.error, /超过 24 小时/);
  assert.equal(state.queries, 0); assert.equal(jobs.active.has(input.id), false);

  const completedInput = { ...input, id: crypto.randomUUID() };
  await jobs.create(completedInput); await jobs.refresh(completedInput.id);
  task = await jobs.read(completedInput.id); task.createdAt = Date.now() - 25 * 3600_000; await jobs.write(task);
  assert.equal((await jobs.refresh(completedInput.id)).status, 'completed');
  assert.ok((await fs.stat(jobs.file(completedInput.id, 'glb'))).size > 0);

  const retryInput = { ...input, id: crypto.randomUUID() };
  await jobs.create(retryInput); state.corrupt = true; await jobs.refresh(retryInput.id);
  task = await jobs.read(retryInput.id); task.createdAt = Date.now() - 25 * 3600_000; task.nextPollAt = 0; await jobs.write(task);
  state.corrupt = false; const before = state.urls.filter(url => url.endsWith('.glb')).length;
  assert.equal((await jobs.refresh(retryInput.id)).status, 'completed');
  assert.equal(state.urls.filter(url => url.endsWith('.glb')).length, before + 1);

  const inactiveInput = { ...input, id: crypto.randomUUID() };
  await jobs.create(inactiveInput);
  for (const status of ['uncertain', 'blocked', 'submitting']) {
    task = await jobs.read(inactiveInput.id);
    task.status = status; task.createdAt = Date.now() - 25 * 3600_000; task.nextPollAt = Date.now() + 60000;
    await jobs.write(task);
    assert.equal((await jobs.refresh(inactiveInput.id)).status, status);
  }
});

test('下载连续失败十次停止自动重试，重启不恢复，手动重试可继续', async t => {
  const { open, input, state } = await fixture(t); const jobs = open(); await jobs.create(input);
  state.corrupt = true;
  for (let attempt = 1; attempt <= 10; attempt++) {
    const task = await jobs.read(input.id); task.nextPollAt = 0; await jobs.write(task);
    const before = Date.now(); const result = await jobs.refresh(input.id);
    assert.equal(result.status, 'download_failed');
    assert.equal(result.downloadAttempts, attempt);
    if (attempt < 10) {
      assert.equal(Boolean(result.downloadStopped), false);
      const expected = Math.min(30000 * 2 ** (attempt - 1), 30 * 60_000);
      assert.ok(result.nextPollAt - before >= expected - 1000 && result.nextPollAt - before <= expected + 1000);
    } else {
      assert.equal(result.downloadStopped, true); assert.match(result.error, /连续失败 10 次/);
      assert.equal(jobs.active.has(input.id), false);
    }
  }
  const downloads = state.urls.filter(url => url.endsWith('.glb')).length;
  await jobs.tick(); assert.equal(state.urls.filter(url => url.endsWith('.glb')).length, downloads);
  const restored = open(); await restored.ready; assert.equal(restored.active.has(input.id), false);
  state.corrupt = false;
  const complete = await restored.refresh(input.id, { manual: true });
  assert.equal(complete.status, 'completed'); assert.equal(complete.downloadAttempts, 0);
  assert.equal(complete.downloadStopped, undefined); assert.ok((await fs.stat(restored.file(input.id, 'glb'))).size > 0);
  assert.equal(state.submits, 1);
});

test('手动查询不受冷却阻挡，平台失败与模型超限保持原有终态', async t => {
  const { open, input, state } = await fixture(t); const jobs = open(); await jobs.create(input);
  let task = await jobs.read(input.id); task.nextPollAt = Date.now() + 10 * 60_000; await jobs.write(task);
  await jobs.refresh(input.id); assert.equal(state.queries, 0);
  state.finished = false; await jobs.refresh(input.id, { manual: true }); assert.equal(state.queries, 1);
  state.queryError = true; task = await jobs.read(input.id); task.nextPollAt = 0; await jobs.write(task);
  assert.equal((await jobs.refresh(input.id)).status, 'failed'); assert.equal(state.queries, 2);
  const tooLarge = { ...input, id: crypto.randomUUID() }; state.queryError = false; state.finished = true;
  await jobs.create(tooLarge);
  jobs.download = async () => { throw Object.assign(new Error('模型过大'), { code: 'MODEL_TOO_LARGE' }); };
  const failure = await jobs.refresh(tooLarge.id);
  assert.equal(failure.status, 'failed'); assert.equal(failure.downloadAttempts, undefined);
  assert.equal(state.submits, 2);
});

test('下载错误不暴露密钥、签名地址和本机路径', async t => {
  const { open, input, store } = await fixture(t); const jobs = open(); await jobs.create(input);
  jobs.download = async () => { throw new Error(`下载失败 ${store.value.channels[0].apiKey} https://files.example/model.glb?signature=private ${store.dataDir}`); };
  const task = await jobs.refresh(input.id);
  assert.equal(task.status, 'download_failed');
  assert.match(task.error, /下载失败/);
  for (const secret of ['test-only-key', 'signature=private', store.dataDir]) assert.ok(!task.error.includes(secret));
});

test('慢下载不阻塞其他任务查询，刷新并发最多三个', async t => {
  const { open, input, store } = await fixture(t); const jobs = open(); await jobs.ready;
  const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
  for (const [index, id] of ids.entries()) {
    await jobs.write({ format: 1, id, sceneId: input.sceneId, channelId: input.channelId, baseUrl: 'https://www.runninghub.cn', taskId: String(index + 1), status: 'processing', createdAt: Date.now() });
    jobs.active.add(id);
  }
  const queried = []; let concurrent = 0, maximum = 0;
  store.fetchImpl = async (url, options) => {
    const taskId = JSON.parse(options.body).taskId; queried.push(taskId);
    return Response.json(taskId === '1'
      ? { taskId, status: 'SUCCESS', results: [{ outputType: 'glb', url: 'https://files.example/model.glb' }] }
      : { taskId, status: 'RUNNING' });
  };
  jobs.download = async () => { await new Promise(resolve => setTimeout(resolve, 2000)); };
  const refresh = jobs.refresh.bind(jobs);
  jobs.refresh = async id => { concurrent++; maximum = Math.max(maximum, concurrent); try { return await refresh(id); } finally { concurrent--; } };
  const ticking = jobs.tick();
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.ok(queried.filter(id => id !== '1').length >= 2);
  await ticking;
  assert.equal(queried.length, 4); assert.ok(maximum <= 3);
});

test('重复 tick 与手动刷新同一任务只查询一次，关闭会中止所有并发查询', async t => {
  const { open, input, store } = await fixture(t); const jobs = open(); await jobs.ready;
  const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
  for (const [index, id] of ids.entries()) {
    await jobs.write({ format: 1, id, sceneId: input.sceneId, channelId: input.channelId, baseUrl: 'https://www.runninghub.cn', taskId: String(index + 1), status: 'processing', createdAt: Date.now() });
    jobs.active.add(id);
  }
  let started = 0, releaseStart;
  const firstStarted = new Promise(resolve => { releaseStart = resolve; });
  store.fetchImpl = (_url, options) => {
    started++; if (started === 3) releaseStart();
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
  };
  const ticking = jobs.tick(); await firstStarted;
  const second = jobs.tick(); const sameId = jobs.refresh(ids[0]);
  assert.equal(started, 3);
  await jobs.close(); await Promise.all([ticking, second, sameId]);
  assert.equal(started, 3);
});
