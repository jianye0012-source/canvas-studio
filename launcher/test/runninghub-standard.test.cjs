const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ConfigStore, validateConfig } = require('../lib/config.cjs');
const { model, protocol, callStandardImage } = require('../lib/runninghub-standard.cjs');

test('RunningHub 标准模型用账户接口验证密钥和内置图生图，其他渠道仍读取 OpenAI 模型', async () => {
  const calls = [];
  const channel = { id: 'rh', name: 'RunningHub', protocol, baseUrl: 'https://www.runninghub.ai/openapi/v2/' + model, apiKey: 'fixture-key' };
  const store = new ConfigStore('', null, null, async (url, request) => {
    calls.push({ url, request });
    return Response.json(url.endsWith('/v1/models') ? { data: [{ id: 'other-model' }] } : { code: 0, data: { apiType: 'NORMAL' } });
  });
  store.value = validateConfig({ channels: [] });
  assert.deepEqual((await store.testChannel(channel)).models, [model]);
  assert.equal(calls[0].url, 'https://www.runninghub.ai/uc/openapi/accountStatus');
  assert.deepEqual(JSON.parse(calls[0].request.body), { apikey: 'fixture-key' });
  assert.equal(calls[0].request.headers.authorization, 'Bearer fixture-key');
  const compatible = { id: 'compatible', name: '兼容', baseUrl: 'https://example.com/v1', models: [], modelCapabilities: {} };
  assert.deepEqual((await store.testChannel(compatible)).models, ['other-model']);
  assert.equal(calls[1].url, 'https://example.com/v1/models');
  await assert.rejects(() => store.testChannel({ ...compatible, baseUrl: 'https://www.runninghub.ai/runninghub-api-doc-en/' }), /请选择 RunningHub 标准模型/);
  await assert.rejects(() => store.testChannel({ ...channel, baseUrl: 'https://example.com' }), /标准模型请使用/);
  assert.equal(calls.length, 2);
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
