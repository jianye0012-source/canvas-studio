const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ConfigStore, validateConfig } = require('../lib/config.cjs');
const { model, protocol, callStandardImage } = require('../lib/runninghub-standard.cjs');

const officialIndex = [
  '- Standard Model API > Image Generation & Processing > image-to-image > gpt [GPT Image 2](https://www.runninghub.ai/runninghub-api-doc-en/api-448184504.md):',
  '- Standard Model API > Video Generation & Processing > image-to-video [Video](https://www.runninghub.ai/runninghub-api-doc-en/api-123.md):',
  '- Standard Model API > 3D Generation & Processing > image-to-3D [3D [Deprecated]](https://www.runninghub.ai/runninghub-api-doc-en/api-456.md):',
  '- Task Query & webhook [Query](https://www.runninghub.ai/runninghub-api-doc-en/api-1234.md):',
].join('\n');

test('RunningHub 检测联网读取并分类官方目录，账户密钥只发送到官方账户接口', async () => {
  const calls = [];
  const channel = { id: 'rh', name: 'RunningHub', protocol, baseUrl: 'https://www.runninghub.ai/runninghub-api-doc-en/', apiKey: 'fixture-key' };
  let index = officialIndex;
  const store = new ConfigStore('', null, null, async (url, request) => {
    calls.push({ url, request });
    if (url.endsWith('/llms.txt')) return new Response(index);
    return Response.json(url.endsWith('/v1/models') ? { data: [{ id: 'other-model' }] } : { code: 0, data: { apiType: 'NORMAL' } });
  });
  store.value = validateConfig({ channels: [] });
  const result = await store.testChannel(channel);
  assert.deepEqual(result.models, [model]);
  assert.deepEqual(result.runningHub.models.map(({ type, integrated }) => [type, integrated]), [['image', true], ['video', false], ['3d', false]]);
  assert.equal(result.runningHub.models[2].name, '3D [Deprecated]');
  assert.equal(result.runningHub.accountError, '');
  assert.equal(calls[0].url, 'https://www.runninghub.ai/runninghub-api-doc-en/llms.txt');
  assert.equal(calls[0].request.headers, undefined);
  assert.equal(calls[0].request.cache, 'no-store');
  assert.equal(calls[0].request.credentials, 'omit');
  assert.equal(calls[1].url, 'https://www.runninghub.ai/uc/openapi/accountStatus');
  assert.deepEqual(JSON.parse(calls[1].request.body), { apikey: 'fixture-key' });
  assert.equal(calls[1].request.headers.authorization, 'Bearer fixture-key');
  index = officialIndex.split('\n')[1];
  const updated = await store.testChannel(channel);
  assert.deepEqual(updated.models, []);
  assert.equal(updated.runningHub.models.length, 1);
  const compatible = { id: 'compatible', name: '兼容', baseUrl: 'https://example.com/v1', models: [], modelCapabilities: {} };
  assert.deepEqual((await store.testChannel(compatible)).models, ['other-model']);
  assert.equal(calls[4].url, 'https://example.com/v1/models');
  await assert.rejects(() => store.testChannel({ ...compatible, baseUrl: 'https://www.runninghub.ai/runninghub-api-doc-en/' }), /请选择 RunningHub 标准模型/);
  await assert.rejects(() => store.testChannel({ ...channel, baseUrl: 'https://example.com' }), /标准模型请使用/);
  assert.equal(calls.length, 5);
});

test('RunningHub 目录可独立展示，读取失败不会返回内置目录或覆盖原模型', async () => {
  const channel = { id: 'rh', name: 'RunningHub', protocol, baseUrl: 'https://www.runninghub.ai', models: [model] };
  let fail = false;
  const store = new ConfigStore('', null, null, async url => {
    if (!url.endsWith('/llms.txt')) return new Response(null, { status: 401 });
    return new Response(fail ? '维护中' : officialIndex);
  });
  store.value = validateConfig({ channels: [channel], imageChannelId: channel.id, imageModel: model });
  assert.deepEqual(validateConfig({ channels: [{ ...channel, models: [] }] }).channels[0].models, []);
  const noKey = await store.testChannel(channel);
  assert.equal(noKey.runningHub.models.length, 3);
  assert.match(noKey.runningHub.accountError, /请填写/);
  assert.deepEqual(noKey.models, []);
  const invalidKey = await store.testChannel({ ...channel, apiKey: 'invalid-fixture' });
  assert.match(invalidKey.runningHub.accountError, /拒绝访问/);
  assert.deepEqual(invalidKey.models, []);
  fail = true;
  await assert.rejects(() => store.testChannel(channel), /官方目录未返回可识别的模型/);
  assert.equal(store.public().imageModel, model);
  assert.deepEqual(store.public().channels[0].models, [model]);
});

test('图生图参数和查询走不同端点，拒绝缺少参考图且清理错误信息中的密钥', async () => {
  const channel = { baseUrl: 'https://www.runninghub.ai', apiKey: 'fixture-key' };
  const calls = [];
  const options = { fetchImpl: async (url, request) => {
    calls.push([url, JSON.parse(request.body)]);
    assert.equal(request.redirect, 'error');
    return Response.json({ taskId: '123', status: 'RUNNING', errorMessage: 'fixture-key' });
  } };
  await assert.rejects(() => callStandardImage(channel, '/runninghub/submit', { model, prompt: '改图' }, options), /需要 1 至 10 张/);
  const params = { prompt: '改图', imageUrls: ['data:image/png;base64,YQ=='], aspectRatio: '16:9', resolution: '2k' };
  const submitted = await callStandardImage(channel, '/runninghub/submit', { model, ...params }, options);
  assert.equal(submitted.errorMessage, '***');
  await callStandardImage(channel, '/runninghub/query', { taskId: submitted.taskId }, options);
  assert.deepEqual(calls, [
    ['https://www.runninghub.ai/openapi/v2/' + model, params],
    ['https://www.runninghub.ai/openapi/v2/query', { taskId: '123' }],
  ]);
});
