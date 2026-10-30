const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { ConfigStore, directorModelId } = require('../lib/config.cjs');
const { Gateway } = require('../lib/gateway.cjs');
const { contained, verifyManifest } = require('../lib/files.cjs');
const { freePort } = require('../lib/runtime.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.resolve(__dirname, '../../work/tmp/launcher-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(16);
  const encrypt = value => { const cipher = crypto.createCipheriv('aes-256-cbc', key, iv); return Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); };
  const decrypt = bytes => { const cipher = crypto.createDecipheriv('aes-256-cbc', key, iv); return Buffer.concat([cipher.update(bytes), cipher.final()]).toString(); };
  const store = await new ConfigStore(root, encrypt, decrypt).initialize();
  return { root, store, encrypt, decrypt };
}

const channel = (id, baseUrl = '', apiKey = '') => ({ id, name: '渠道 ' + id, baseUrl, apiKey, enabled: true, models: ['same-model', 'same-image', 'same-video'], modelCapabilities: { 'same-model': 'text', 'same-image': 'image', 'same-video': 'video' } });

test('多渠道密钥独立加密、重开保留，清除一个不影响另一个，目录丢失停止写入', async t => {
  const { root, store, encrypt, decrypt } = await fixture(t);
  await store.save({ channels: [channel('a', 'https://example.com/v1/', 'secret-key-a'), channel('b', 'https://example.org', 'secret-key-b')], directorChannelId: 'a', directorModel: 'same-model', imageChannelId: 'b', imageModel: 'same-image' });
  assert.equal(store.public().channels[0].baseUrl, 'https://example.com');
  assert.equal(JSON.stringify(store.public()).includes('secret-key-'), false);
  assert.equal((await fs.readFile(store.file, 'utf8')).includes('secret-key-'), false);
  const reopened = await new ConfigStore(root, encrypt, decrypt).initialize();
  assert.deepEqual(reopened.value.channels.map(entry => entry.apiKey), ['secret-key-a', 'secret-key-b']);
  await reopened.save({ channels: reopened.public().channels });
  assert.deepEqual(reopened.value.channels.map(entry => entry.apiKey), ['secret-key-a', 'secret-key-b']);
  await reopened.save({ channels: reopened.public().channels.map(entry => entry.id === 'a' ? { ...entry, clearApiKey: true } : entry) });
  assert.deepEqual(reopened.value.channels.map(entry => entry.apiKey), ['', 'secret-key-b']);
  await assert.rejects(() => reopened.save({ directorChannelId: 'b', directorModel: 'same-image' }), /重新选择/);
  await assert.rejects(() => reopened.save({ channels: [channel('a'), channel('a')] }), /重复/);
  await fs.rename(store.dataDir, store.dataDir + '-detached');
  await assert.rejects(() => reopened.save({ browser: 'edge' }));
  await assert.rejects(() => fs.stat(store.dataDir));
});

test('上一版单渠道设置及加密密钥可继续使用；跨用户解密失败不会静默覆盖密钥', async t => {
  const { root, store, encrypt, decrypt } = await fixture(t);
  await fs.writeFile(store.file, JSON.stringify({ baseUrl: 'https://example.com/v1', encryptedKey: encrypt('old-secret').toString('base64'), directorModel: 'old-chat', imageModel: 'old-image' }));
  const reopened = await new ConfigStore(root, encrypt, decrypt).initialize();
  assert.equal(reopened.value.channels[0].id, 'launcher'); assert.equal(reopened.value.channels[0].apiKey, 'old-secret');
  assert.equal(reopened.value.imageChannelId, 'launcher');
  const unavailable = await new ConfigStore(root, encrypt, () => { throw Error('another Windows user'); }).initialize();
  assert.equal(unavailable.public().channels[0].keyUnavailable, true);
  await assert.rejects(() => unavailable.save({ browser: 'chrome' }), /无法解密/);
});

test('本机会话保护数据，拒绝外站来源，项目串行落盘并重新读取', async t => {
  const { root, store } = await fixture(t);
  const gateway = new Gateway({ root, store, apiPort: 1, webPort: 1, cozyPort: 1, livePort: 1, serviceToken: 'internal', providerToken: 'private', log() {} });
  await gateway.listen(0); t.after(() => gateway.close());
  const url = gateway.origin;
  assert.equal((await fetch(url + '/local/config')).status, 401);
  assert.equal((await fetch(url + '/local/session', { method: 'POST', body: JSON.stringify({ key: 'bad' }) })).status, 403);
  const login = await fetch(url + '/local/session', { method: 'POST', body: JSON.stringify({ key: gateway.bootstrap }) });
  const headers = { cookie: login.headers.get('set-cookie').split(';')[0], 'content-type': 'application/json' };
  assert.equal((await fetch(url + '/local/config', { headers: { ...headers, origin: 'https://example.com' } })).status, 403);
  assert.equal((await fetch(url + '/local/config', { headers })).status, 200);
  const envelope = { engine: 'cozyclay', schemaVersion: 1, project: { app: 'cozyclay', kind: 'project', name: 'saved-scene', resources: { assets: [{ id: 'mesh-test', bytes: 'YWJj' }] } } };
  const saved = await fetch(url + '/local/director/test-node', { method: 'PUT', headers, body: JSON.stringify(envelope) });
  assert.equal(saved.status, 200);
  assert.deepEqual(await (await fetch(url + '/local/director/test-node', { headers })).json(), envelope);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(store.dataDir, 'projects/director/test-node.json'), 'utf8')), envelope);
  assert.equal((await fetch(url + '/local/director/bad.node', { headers })).status, 400);
  assert.equal((await fetch(url + '/api/auth/register', { method: 'POST', headers, body: '{}' })).status, 404);
});

test('同名模型按渠道转发正确密钥，默认选择改变不影响任务查询，导演模型别名还原', async t => {
  const { root, store } = await fixture(t); const seen = [];
  const upstream = http.createServer(async (req, res) => { let body = ''; for await (const chunk of req) body += chunk; seen.push({ headers: req.headers, url: req.url, body }); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true })); });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => upstream.close(resolve)));
  const baseUrl = `http://127.0.0.1:${upstream.address().port}`;
  await store.save({ channels: [channel('a', baseUrl, 'key-a'), channel('b', baseUrl, 'key-b')], directorChannelId: 'a', directorModel: 'same-model' });
  const gateway = new Gateway({ root, store, providerToken: 'private', log() {} }); await gateway.listen(0); t.after(() => gateway.close());
  const headers = { authorization: 'Bearer private', 'content-type': 'application/json' };
  for (const id of ['a', 'b']) assert.equal((await fetch(gateway.origin + `/local-ai/channels/${id}/v1/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ model: 'same-model' }) })).status, 200);
  assert.deepEqual(seen.slice(0, 2).map(entry => entry.headers.authorization), ['Bearer key-a', 'Bearer key-b']);
  assert.equal(seen[0].url, '/v1/chat/completions'); assert.equal(seen[0].headers.cookie, undefined);
  const models = await (await fetch(gateway.origin + '/local-ai/director/v1/models', { headers })).json();
  assert.deepEqual(models.data.map(entry => entry.id), ['a::same-model', 'b::same-model']);
  const response = await fetch(gateway.origin + '/local-ai/director/v1/chat/completions', { method: 'POST', headers, body: JSON.stringify({ model: directorModelId('b', 'same-model'), messages: [{ role: 'user', content: 'test' }], stream: true }) });
  assert.equal(response.status, 200); assert.equal(seen.at(-1).headers.authorization, 'Bearer key-b'); assert.equal(JSON.parse(seen.at(-1).body).model, 'same-model');
  await store.save({ videoChannelId: 'b', videoModel: 'same-video' });
  assert.equal((await fetch(gateway.origin + '/local-ai/channels/a/v1/videos/submitted-task', { headers })).status, 200);
  assert.equal(seen.at(-1).headers.authorization, 'Bearer key-a');
  await store.save({ channels: store.public().channels.map(entry => entry.id === 'a' ? { ...entry, enabled: false } : entry), directorChannelId: '', directorModel: '' });
  const count = seen.length;
  assert.equal((await fetch(gateway.origin + '/local-ai/channels/a/v1/videos/submitted-task', { headers })).status, 400);
  assert.equal(seen.length, count, '停用渠道不会把已有任务转到另一个渠道');
  assert.equal((await fetch(gateway.origin + '/local-ai/director/v1/chat/completions', { method: 'POST', headers, body: JSON.stringify({ model: 'a::same-model' }) })).status, 400);
});

test('文件清单识别损坏，路径越界被拒绝，端口冲突可选择空闲端口', async t => {
  const { root } = await fixture(t);
  assert.throws(() => contained(root, '../outside')); assert.throws(() => contained(root, '..\\outside'));
  await fs.writeFile(path.join(root, 'runtime.txt'), 'ok');
  await fs.writeFile(path.join(root, 'bundle-manifest.json'), JSON.stringify({ format: 1, files: [{ path: 'runtime.txt', size: 2, sha256: crypto.createHash('sha256').update('ok').digest('hex') }] }));
  assert.equal((await verifyManifest(root)).checked, 1);
  await fs.writeFile(path.join(root, 'runtime.txt'), 'no'); await assert.rejects(() => verifyManifest(root), /校验失败/);
  const server = http.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  assert.notEqual(await freePort(server.address().port), server.address().port);
});
