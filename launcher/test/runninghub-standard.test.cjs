const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ConfigStore, validateConfig } = require('../lib/config.cjs');
const { model, protocol, normalizeRunningHubURL, callStandardImage, callStandardVideo } = require('../lib/runninghub-standard.cjs');

const officialIndex = [
  '- Standard Model API > Image Generation & Processing > image-to-image > gpt [GPT Image 2](https://www.runninghub.ai/runninghub-api-doc-en/api-448184504.md):',
  '- Standard Model API > Video Generation & Processing > image-to-video [Video](https://www.runninghub.ai/runninghub-api-doc-en/api-123.md):',
  '- Standard Model API > 3D Generation & Processing > image-to-3D [3D [Deprecated]](https://www.runninghub.ai/runninghub-api-doc-en/api-456.md):',
  '- Task Query & webhook [Query](https://www.runninghub.ai/runninghub-api-doc-en/api-1234.md):',
].join('\n');

test('RunningHub 保留国内和国际站地址，拒绝外部域名、端口、凭据和跳转参数', () => {
  for (const site of ['cn', 'ai']) {
    const root = 'https://www.runninghub.' + site;
    for (const value of [root, root + '/', root.replace('www.', ''), root + '/openapi/v2/youchuan/text-to-image-v82', root + '/runninghub-api-doc-' + (site === 'cn' ? 'cn' : 'en') + '/']) {
      assert.equal(normalizeRunningHubURL(value), root);
    }
    for (const value of [root + ':8443', root + '?target=elsewhere', root.replace('https:', 'http:'), root.replace('www.', 'person@www.'), root + '.example.org']) {
      assert.throws(() => normalizeRunningHubURL(value));
    }
  }
});

test('国内目录、模型参数、账户、上传、提交和查询使用同一站点，两站目录缓存独立', async () => {
  const calls = [];
  const key = 'fixture-shared-key';
  const endpoint = 'youchuan/text-to-image-v82';
  const store = new ConfigStore('', null, null, async (url, request) => {
    calls.push(url);
    const cn = new URL(url).hostname.endsWith('.cn');
    if (url.endsWith('/llms.txt')) return new Response(`- ${cn ? '模型API > 图像生成与处理' : 'Standard Model API > Image Generation & Processing'} > text-to-image [${cn ? '悠船' : 'Other'}](https://www.runninghub.${cn ? 'cn/runninghub-api-doc-cn' : 'ai/runninghub-api-doc-en'}/api-123.md):`);
    if (url.endsWith('.md')) {
      assert.equal(request.headers, undefined);
      const schema = { required: ['prompt'], properties: { prompt: { type: 'string' } } };
      const definition = { paths: { ['/openapi/v2/' + (cn ? endpoint : 'example/text-to-image')]: { post: { requestBody: { content: { 'application/json': { schema } } } } } } };
      return new Response(['# 测试模型', '\x60\x60\x60yaml', JSON.stringify(definition), '\x60\x60\x60'].join('\n'));
    }
    assert.equal(request.headers.authorization, 'Bearer ' + key);
    assert.equal(request.credentials, 'omit');
    if (url.endsWith('/accountStatus')) return Response.json({ code: 0, data: { remainMoney: cn ? '0.00' : '8.00', remainCoins: '0', currency: 'CNY' } });
    if (url.endsWith('/media/upload/binary')) return Response.json({ code: 0, data: { download_url: 'https://cdn.example.org/reference.png' } });
    return Response.json({ taskId: '321', status: 'RUNNING' });
  });
  store.value = validateConfig({ channels: [] });
  const input = { id: 'cn', name: '国内', protocol, baseUrl: 'https://www.runninghub.cn', apiKey: key };
  const result = await store.testChannel(input);
  assert.equal(result.runningHub.models[0].type, 'image');
  assert.equal(result.runningHub.account.remainMoney, '0.00');
  assert.equal(result.runningHub.baseUrl, input.baseUrl);
  await store.testChannel({ ...input, baseUrl: 'https://www.runninghub.ai' });
  const cn = await store.readRunningHubModel('123', input.baseUrl);
  const ai = await store.readRunningHubModel('123', 'https://www.runninghub.ai');
  assert.equal(cn.endpoint, endpoint);
  assert.equal(ai.endpoint, 'example/text-to-image');
  const channel = validateConfig({ channels: [{ ...input, models: [endpoint], runningHubModels: { [endpoint]: cn } }] }).channels[0];
  assert.equal(channel.baseUrl, input.baseUrl);
  const options = { fetchImpl: store.fetchImpl };
  await callStandardImage(channel, '/runninghub/submit', { model: endpoint, prompt: '测试' }, options);
  await callStandardImage(channel, '/runninghub/query', { taskId: '321' }, options);
  const imageEndpoint = 'example/image-to-image';
  channel.models.push(imageEndpoint);
  channel.modelCapabilities[imageEndpoint] = 'image';
  channel.runningHubModels[imageEndpoint] = { required: ['prompt', 'imageUrls'], properties: { prompt: { type: 'string' }, imageUrls: { type: 'array' } } };
  await callStandardImage(channel, '/runninghub/submit', { model: imageEndpoint, prompt: '参考图', imageUrls: ['data:image/png;base64,YQ=='] }, options);
  assert.deepEqual(calls.slice(-4), [input.baseUrl + '/openapi/v2/' + endpoint, input.baseUrl + '/openapi/v2/query', input.baseUrl + '/openapi/v2/media/upload/binary', input.baseUrl + '/openapi/v2/' + imageEndpoint]);
});

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
  assert.deepEqual(result.models, []);
  assert.deepEqual(result.runningHub.models.map(({ type, importable }) => [type, importable]), [['image', true], ['video', true], ['3d', false]]);
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
  const channel = { baseUrl: 'https://www.runninghub.ai', apiKey: 'fixture-key', models: [model], modelCapabilities: { [model]: 'image' } };
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

test('RunningHub 区分首尾帧与有序参考图，不丢弃模型不支持的输入', async () => {
  const { parameters } = require('../lib/runninghub-schema.cjs');
  const frame = { type: 'string' };
  const references = { type: 'array', minItems: 1, maxItems: 3 };
  const input = { imageUrls: ['first-reference', 'second-reference'], firstFrameUrl: 'first-frame', lastFrameUrl: 'last-frame' };
  const both = { required: [], properties: { firstFrameUrl: frame, lastFrameUrl: frame, imageUrls: references } };
  assert.deepEqual(parameters(both, input), input);
  assert.deepEqual(parameters(both, { firstFrameUrl: 'first-frame', lastFrameUrl: 'last-frame' }), { firstFrameUrl: 'first-frame', lastFrameUrl: 'last-frame' });
  const single = { required: ['imageUrl'], properties: { imageUrl: frame } };
  assert.deepEqual(parameters(single, { firstFrameUrl: 'first-frame' }), { imageUrl: 'first-frame' });
  assert.throws(() => parameters(single, input), /不支持.*尾帧/);
  assert.throws(() => parameters({ required: [], properties: { imageUrls: references } }, input), /不支持.*首帧/);
});

test('同一 RunningHub 渠道按官方参数添加多个模型，生成走各自端点', async () => {
  const textModel = 'example/text-to-image';
  const videoModel = 'example/image-to-video';
  const prompt = { type: 'string', maxLength: 20000 };
  const image = { type: 'string', format: 'uri' };
  const docs = {
    'api-448184504.md': [textModel, ['prompt'], { prompt, aspectRatio: { type: 'string', enum: ['16:9'], default: '16:9' } }],
    'api-123.md': [videoModel, ['prompt', 'imageUrl', 'duration'], { prompt, imageUrl: image, duration: { type: 'integer', default: 5 } }],
  };
  const calls = [];
  const store = new ConfigStore('', null, null, async (url, request) => {
    if (url.endsWith('/llms.txt')) return new Response(officialIndex);
    const doc = docs[url.split('/').at(-1)];
    if (doc) {
      assert.equal(request.headers, undefined);
      const [endpoint, required, properties] = doc;
      const definition = { paths: { ['/openapi/v2/' + endpoint]: { post: { requestBody: { content: { 'application/json': { schema: { required, properties } } } } } } } };
      return new Response(['# 测试模型', '', '\x60\x60\x60yaml', JSON.stringify(definition), '\x60\x60\x60'].join('\n'));
    }
    return Response.json({ code: 0, data: {} });
  });
  const input = { id: 'rh', name: 'RunningHub', protocol, baseUrl: 'https://www.runninghub.ai', apiKey: 'fixture-key' };
  store.value = validateConfig({ channels: [] });
  await store.testChannel(input);
  await assert.rejects(() => store.readRunningHubModel('456'), /请选择|请先检测/);
  const specs = await Promise.all(['448184504', '123'].map(id => store.readRunningHubModel(id)));
  const channel = validateConfig({
    channels: [{ ...input, models: [model, textModel, videoModel], runningHubModels: Object.fromEntries(specs.map(({ endpoint, ...spec }) => [endpoint, spec])) }],
    imageChannelId: 'rh', imageModel: model, videoChannelId: 'rh', videoModel,
  }).channels[0];
  assert.deepEqual(channel.modelCapabilities, { [model]: 'image', [textModel]: 'image', [videoModel]: 'video' });
  const options = { fetchImpl: async (url, request) => {
    const route = url.split('/openapi/v2/')[1];
    if (route === 'media/upload/binary') {
      assert.equal(request.body.get('file').type, 'image/png');
      calls.push([route]);
      return Response.json({ code: 0, data: { download_url: 'https://cdn.example.org/source.png' } });
    }
    calls.push([route, JSON.parse(request.body)]);
    return Response.json({ taskId: '234', status: 'CREATE' });
  } };
  await callStandardImage(channel, '/runninghub/submit', { model: textModel, prompt: '文生图', aspectRatio: '1:1' }, options);
  await assert.rejects(() => callStandardVideo(channel, { model: videoModel, prompt: '图生视频' }, options), /请添加参考图/);
  const task = await callStandardVideo(channel, { model: videoModel, prompt: '图生视频', imageUrls: ['data:image/png;base64,YQ=='], duration: '8' }, options);
  assert.deepEqual(task, { id: '234', task_id: '234', status: 'queued' });
  await assert.rejects(() => callStandardVideo(channel, { model: textModel, prompt: '类型错误' }, options), /类型不匹配/);
  assert.deepEqual(calls, [
    [textModel, { prompt: '文生图', aspectRatio: '16:9' }],
    ['media/upload/binary'],
    [videoModel, { prompt: '图生视频', imageUrl: 'https://cdn.example.org/source.png', duration: 8 }],
  ]);
});
