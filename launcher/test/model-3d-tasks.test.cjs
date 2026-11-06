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
  const state = { urls: [], submits: 0, queries: 0, uploads: 0, finished: true, corrupt: false, uncertain: false };
  const fetchImpl = async (url, options) => {
    state.urls.push(url);
    if (url.endsWith('/media/upload/binary')) { state.uploads++; assert.ok(options.body instanceof FormData); return Response.json({ code: 0, data: { download_url: `https://files.example/${state.uploads}.png` } }); }
    if (url.endsWith('/query')) {
      state.queries++; assert.equal(JSON.parse(options.body).taskId, '9000000000001');
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
  const jobs = new Set();
  const open = () => { const value = new Model3DTasks(store, { exporter: new MediaExports(store.dataDir), choose: async () => output }); jobs.add(value); return value; };
  t.after(async () => { for (const job of jobs) await job.close(); await fs.rm(root, { recursive: true, force: true }); });
  const input = { id: crypto.randomUUID(), sceneId: 'director-test', channelId: 'mesh', model, prompt: '一个白模茶杯', parameters: { generateType: 'Geometry', faceCount: 50000 } };
  return { store, bytes, output, state, open, input, imageModel };
}

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
