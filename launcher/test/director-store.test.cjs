const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ConfigStore } = require('../lib/config.cjs');
const { Gateway } = require('../lib/gateway.cjs');

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const assetId = (bytes, prefix = 'mesh') => prefix + '-' + sha256(bytes).slice(0, 32);
const envelope = (assets, schemaVersion = 1) => ({ engine: 'cozyclay', schemaVersion, project: { app: 'cozyclay', kind: 'project', version: 5, name: '测试导演台', resources: { assets } }, panoramas: [], activePanorama: null });
const v2Entries = value => value.project.resources.assets.map(({ bytes, ...rest }) => ({ ...rest, size: Buffer.from(bytes, 'base64').length }));
const samples = () => [
  { id: assetId(Buffer.from('image'), 'img'), type: 'image/png', name: '图片', width: 512, height: 256, role: 'workflow-output', bytes: Buffer.from('image').toString('base64') },
  { id: assetId(Buffer.from('abc')), type: 'model/gltf-binary', name: '模型', brightest: 0.5, bytes: 'YWJj' },
];

async function fixture(t) {
  const root = await fs.mkdtemp(path.resolve(__dirname, '../../work/tmp/director-store-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(16);
  const encrypt = value => { const cipher = crypto.createCipheriv('aes-256-cbc', key, iv); return Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); };
  const decrypt = bytes => { const cipher = crypto.createDecipheriv('aes-256-cbc', key, iv); return Buffer.concat([cipher.update(bytes), cipher.final()]).toString(); };
  const store = await new ConfigStore(root, encrypt, decrypt).initialize();
  const gateway = new Gateway({ root, store, log() {} });
  await gateway.listen(0); t.after(() => gateway.close());
  const login = await fetch(gateway.origin + '/local/session', { method: 'POST', body: JSON.stringify({ key: gateway.bootstrap }) });
  const headers = { cookie: login.headers.get('set-cookie').split(';')[0] };
  const request = (route, options = {}) => fetch(gateway.origin + route, { ...options, headers: { ...headers, ...options.headers } });
  const putAsset = (bytes, id = assetId(bytes), { type = 'model/gltf-binary', name = '立方体.glb' } = {}) => request('/local/director-assets/' + id, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'x-asset-type': type, 'x-asset-name': encodeURIComponent(name) }, body: bytes });
  const projectFile = (id = 'scene', backup = false) => path.join(store.dataDir, 'projects/director', id + (backup ? '.v1' : '') + '.json');
  const assetPath = (id, extension) => path.join(store.dataDir, 'projects/director-assets', id + '.' + extension);
  const seed = async (value, id = 'scene') => { await fs.mkdir(path.dirname(projectFile(id)), { recursive: true }); await fs.writeFile(projectFile(id), JSON.stringify(value)); };
  const putProject = (value, id = 'scene') => request('/local/director/' + id, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  const getProject = (suffix = '') => request('/local/director/scene' + suffix);
  const diskProject = async () => JSON.parse(await fs.readFile(projectFile(), 'utf8'));
  const storedAssets = async value => {
    for (const entry of value.project.resources.assets) {
      const bytes = Buffer.from(entry.bytes, 'base64');
      assert.deepEqual(await fs.readFile(assetPath(entry.id, 'bin')), bytes);
      assert.deepEqual(JSON.parse(await fs.readFile(assetPath(entry.id, 'json'), 'utf8')), { id: entry.id, type: entry.type, name: entry.name, size: bytes.length, sha256: sha256(bytes) });
    }
  };
  return { store, gateway, request, putAsset, projectFile, assetPath, seed, putProject, getProject, diskProject, storedAssets };
}

test('L1 素材 PUT、HEAD、GET 保留字节、类型、中文名和完整摘要', async t => {
  const f = await fixture(t), bytes = Buffer.from('abc'), id = assetId(bytes);
  const put = await f.putAsset(bytes);
  assert.equal(put.status, 200); assert.deepEqual(await put.json(), { stored: true, size: 3 });
  const head = await f.request('/local/director-assets/' + id, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), '3');
  const get = await f.request('/local/director-assets/' + id);
  assert.equal(get.status, 200); assert.equal(get.headers.get('content-type'), 'model/gltf-binary');
  assert.deepEqual(Buffer.from(await get.arrayBuffer()), bytes);
  assert.deepEqual(await fs.readFile(f.assetPath(id, 'bin')), bytes);
  const meta = JSON.parse(await fs.readFile(f.assetPath(id, 'json'), 'utf8'));
  assert.equal(meta.sha256.length, 64); assert.equal(meta.sha256, sha256(bytes)); assert.equal(meta.name, '立方体.glb');
});

test('L2 素材内容与编号不一致不写文件', async t => {
  const f = await fixture(t), id = assetId(Buffer.from('other'));
  const response = await f.putAsset(Buffer.from('abc'), id);
  assert.equal(response.status, 400); assert.deepEqual(await response.json(), { msg: '素材内容与编号不一致' });
  assert.equal(existsSync(path.dirname(f.assetPath(id, 'bin'))), false);
});

test('L3 重复 PUT 不改写素材', async t => {
  const f = await fixture(t), bytes = Buffer.from('abc'), id = assetId(bytes);
  assert.equal((await f.putAsset(bytes)).status, 200);
  const stamp = new Date('2020-01-01T00:00:00Z'); await fs.utimes(f.assetPath(id, 'bin'), stamp, stamp);
  const before = (await fs.stat(f.assetPath(id, 'bin'))).mtimeMs;
  assert.equal((await f.putAsset(bytes)).status, 200);
  assert.equal((await fs.stat(f.assetPath(id, 'bin'))).mtimeMs, before);
});

test('L4 缺失合法素材为404，非法编号HEAD/GET/PUT均为400', async t => {
  const f = await fixture(t), missing = '/local/director-assets/' + assetId(Buffer.from('absent'));
  assert.equal((await f.request(missing, { method: 'HEAD' })).status, 404);
  const get = await f.request(missing);
  assert.equal(get.status, 404); assert.deepEqual(await get.json(), { msg: '素材不存在' });
  for (const method of ['HEAD', 'GET', 'PUT']) assert.equal((await f.request('/local/director-assets/mesh-zz', { method })).status, 400);
});

test('L5 104857601字节素材返回413且不写文件', async t => {
  const f = await fixture(t), bytes = Buffer.alloc(104857601), id = assetId(bytes);
  const response = await f.putAsset(bytes, id);
  assert.equal(response.status, 413); assert.deepEqual(await response.json(), { msg: '素材超过 100 MB' });
  assert.equal(existsSync(path.dirname(f.assetPath(id, 'bin'))), false);
});

test('L6 HDR校验摘要，sculpt接受非空字节但拒绝空素材', async t => {
  const f = await fixture(t), bytes = Buffer.from('abc');
  assert.equal((await f.putAsset(bytes, assetId(Buffer.from('other'), 'hdr'))).status, 400);
  assert.equal((await f.putAsset(bytes, 'sculpt-' + 'a'.repeat(32))).status, 200);
  const empty = await f.putAsset(Buffer.alloc(0), 'sculpt-' + 'b'.repeat(32));
  assert.equal(empty.status, 400); assert.deepEqual(await empty.json(), { msg: '素材为空' });
});

test('L7 v2项目保存读取无损保留扩展字段', async t => {
  const f = await fixture(t), value = envelope(samples());
  for (const entry of value.project.resources.assets) assert.equal((await f.putAsset(Buffer.from(entry.bytes, 'base64'), entry.id, entry)).status, 200);
  value.project.resources.assets = v2Entries(value); value.schemaVersion = 2;
  assert.equal((await f.putProject(value)).status, 200);
  const get = await f.getProject(); assert.equal(get.status, 200); assert.deepEqual(await get.json(), value);
});

test('L8 v2项目缺素材或size不符返回409且不写主文件', async t => {
  const f = await fixture(t), value = envelope(samples());
  value.project.resources.assets = v2Entries(value); value.schemaVersion = 2;
  const [image, mesh] = value.project.resources.assets;
  assert.equal((await f.putAsset(Buffer.from('image'), image.id, image)).status, 200);
  let response = await f.putProject(value);
  assert.equal(response.status, 409); assert.deepEqual(await response.json(), { msg: `缺少素材 ${mesh.id}，请重试保存`, missing: [mesh.id] });
  assert.equal(existsSync(f.projectFile()), false);
  assert.equal((await f.putAsset(Buffer.from('abc'), mesh.id, mesh)).status, 200);
  mesh.size++;
  response = await f.putProject(value);
  assert.equal(response.status, 409); assert.deepEqual(await response.json(), { msg: `缺少素材 ${mesh.id}，请重试保存`, missing: [mesh.id] });
  assert.equal(existsSync(f.projectFile()), false);
});

test('L9 PUT v1转存为v2，保留所有字段且不生成备份', async t => {
  const f = await fixture(t), value = envelope(samples());
  const put = await f.putProject(value); assert.equal(put.status, 200); assert.deepEqual(await put.json(), { saved: true });
  const saved = await f.diskProject();
  assert.equal(saved.schemaVersion, 2); assert.deepEqual(saved.project.resources.assets, v2Entries(value));
  await f.storedAssets(value); assert.equal(existsSync(f.projectFile('scene', true)), false);
});

test('L10 GET迁移保留原始字节，重复GET不改备份或主文件', async t => {
  const f = await fixture(t), value = envelope(samples()); await f.seed(value);
  const original = await fs.readFile(f.projectFile());
  let get = await f.getProject(); assert.equal(get.status, 200);
  const migrated = await get.json(); assert.equal(migrated.schemaVersion, 2); assert.deepEqual(migrated.project.resources.assets, v2Entries(value));
  assert.deepEqual(await f.diskProject(), migrated); await f.storedAssets(value);
  const backup = f.projectFile('scene', true), before = await fs.stat(backup), main = await fs.readFile(f.projectFile());
  assert.equal(sha256(await fs.readFile(backup)), sha256(original));
  get = await f.getProject(); assert.equal(get.status, 200); assert.deepEqual(await get.json(), migrated);
  assert.equal(sha256(await fs.readFile(backup)), sha256(original)); assert.equal((await fs.stat(backup)).mtimeMs, before.mtimeMs);
  assert.deepEqual(await fs.readFile(f.projectFile()), main);
});

test('L11 中断后的迁移复用备份和完整素材，覆盖只有bin的素材', async t => {
  const f = await fixture(t), value = envelope(samples()), [image, mesh] = value.project.resources.assets;
  await f.seed(value); const backup = f.projectFile('scene', true); await fs.copyFile(f.projectFile(), backup);
  const before = await fs.stat(backup), original = await fs.readFile(backup);
  assert.equal((await f.putAsset(Buffer.from(image.bytes, 'base64'), image.id, image)).status, 200);
  await fs.writeFile(f.assetPath(mesh.id, 'bin'), 'interrupted');
  const get = await f.getProject(); assert.equal(get.status, 200); assert.equal((await get.json()).schemaVersion, 2);
  await f.storedAssets(value); assert.deepEqual(await fs.readFile(backup), original); assert.equal((await fs.stat(backup)).mtimeMs, before.mtimeMs);
});

test('L12 迁移后inline还原完整v1及额外字段', async t => {
  const f = await fixture(t), value = envelope(samples()); await f.seed(value);
  assert.equal((await f.getProject()).status, 200);
  const inline = await f.getProject('?inline=1'); assert.equal(inline.status, 200); assert.deepEqual(await inline.json(), value);
});

test('L13 inline缺少素材返回500并带编号', async t => {
  const f = await fixture(t), value = envelope(samples());
  value.project.resources.assets = v2Entries(value); value.schemaVersion = 2; await f.seed(value);
  const get = await f.getProject('?inline=1'); assert.equal(get.status, 500); assert.equal((await get.json()).msg, '素材缺失 ' + value.project.resources.assets[0].id);
});

test('L14 DELETE删除主文件和备份，保留素材库', async t => {
  const f = await fixture(t), value = envelope(samples()); await f.seed(value);
  assert.equal((await f.getProject()).status, 200);
  const response = await f.request('/local/director/scene', { method: 'DELETE' });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { deleted: true });
  assert.equal(existsSync(f.projectFile()), false); assert.equal(existsSync(f.projectFile('scene', true)), false);
  await f.storedAssets(value);
});

test('L16 GET迁移跳过摘要不符素材，备份仍保留原始坏条目', async t => {
  const f = await fixture(t), good = samples(), bad = { id: assetId(Buffer.from('different')), type: 'model/gltf-binary', name: '坏模型', bytes: 'YWJj' };
  const value = envelope([bad, ...good]); await f.seed(value); const original = await fs.readFile(f.projectFile());
  const get = await f.getProject(); assert.equal(get.status, 200);
  const result = await get.json(); assert.equal(result.schemaVersion, 2); assert.deepEqual(result.project.resources.assets, v2Entries(envelope(good)));
  assert.equal(existsSync(f.assetPath(bad.id, 'bin')), false); assert.equal(existsSync(f.assetPath(bad.id, 'json')), false);
  await f.storedAssets(envelope(good)); assert.equal(sha256(await fs.readFile(f.projectFile('scene', true))), sha256(original));
});

test('L17 PUT v1跳过摘要不符素材，仍保存v2且不生成备份', async t => {
  const f = await fixture(t), good = samples(), bad = { id: assetId(Buffer.from('different')), type: 'model/gltf-binary', name: '坏模型', bytes: 'YWJj' };
  const put = await f.putProject(envelope([bad, ...good])); assert.equal(put.status, 200); assert.deepEqual(await put.json(), { saved: true });
  const result = await f.diskProject(); assert.equal(result.schemaVersion, 2); assert.deepEqual(result.project.resources.assets, v2Entries(envelope(good)));
  assert.equal(existsSync(f.assetPath(bad.id, 'bin')), false); assert.equal(existsSync(f.assetPath(bad.id, 'json')), false);
  await f.storedAssets(envelope(good)); assert.equal(existsSync(f.projectFile('scene', true)), false);
});

test('L15 同编号GET迁移和PUT v1并发后主文件仍为合法v2', async t => {
  const f = await fixture(t), value = envelope(samples()); await f.seed(value);
  const responses = await Promise.all([f.getProject(), f.putProject(value)]);
  for (const response of responses) assert.equal(response.status, 200);
  const saved = await f.diskProject(); assert.deepEqual(saved, envelope(v2Entries(value), 2)); await f.storedAssets(value);
});
