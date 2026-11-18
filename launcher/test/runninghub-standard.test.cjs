const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ConfigStore, validateConfig } = require('../lib/config.cjs');
const { model, protocol, normalizeRunningHubURL, networkError, validateResultURL, downloadResult, callStandardImage, callStandardVideo, detect, readCatalogue, loadModel, query } = require('../lib/runninghub-standard.cjs');

const officialIndex = [
  '- Standard Model API > Image Generation & Processing > image-to-image > gpt [GPT Image 2](https://www.runninghub.ai/runninghub-api-doc-en/api-448184504.md):',
  '- Standard Model API > Video Generation & Processing > image-to-video [Video](https://www.runninghub.ai/runninghub-api-doc-en/api-123.md):',
  '- Standard Model API > 3D Generation & Processing > image-to-3D [3D [Deprecated]](https://www.runninghub.ai/runninghub-api-doc-en/api-456.md):',
  '- 标准模型API > 其他 [hitem3d-v3/multi-image-to-3d](https://www.runninghub.ai/runninghub-api-doc-en/api-789.md):',
  '- Task Query & webhook [Query](https://www.runninghub.ai/runninghub-api-doc-en/api-1234.md):',
].join('\n');

test('网络错误原因隐藏密钥和 URL 凭据、签名参数', () => {
  const error = new Error('fetch failed https://user:private-key@cdn.example/path/file.png?signature=secret&key=private-key');
  const message = networkError('下载失败', error, 'private-key').message;
  assert.match(message, /https:\/\/cdn\.example\/path\/file\.png/);
  assert.ok(!message.includes('private-key'));
  assert.ok(!message.includes('signature='));
  assert.ok(!message.includes('@'));
});

test('结果下载只接受 HTTPS 公网地址', async () => {
  const invalid = [
    'http://a.com/x.png', 'https://user:pw@a.com/x', 'https://a.com:8443/x',
    'https://127.0.0.1/x', 'https://10.0.0.1/x', 'https://169.254.169.254/x', 'https://100.64.0.1/x',
    'https://[::1]/x', 'https://[fc00::1]/x', 'https://[::ffff:127.0.0.1]/x',
    'https://localhost/x', 'https://a.localhost/x',
  ];
  const lookup = async () => [{ address: '1.1.1.1', family: 4 }];
  for (const url of invalid) await assert.rejects(validateResultURL(url, lookup), error => error.status === 422 && /结果地址/.test(error.message));
  await assert.rejects(validateResultURL('https://cdn.example/x', async () => [{ address: '1.1.1.1' }, { address: '192.168.1.2' }]), /内网/);
  assert.equal(await validateResultURL('https://rh-images.xiaoyaoyou.com/a/output/x.png', lookup), 'https://rh-images.xiaoyaoyou.com/a/output/x.png');
  assert.equal(await validateResultURL('https://remote-only.example/x', async () => { throw new Error('ENOTFOUND'); }), 'https://remote-only.example/x');
});

test('结果下载先查询任务、跳转即拒绝、失败原因不含密钥', async () => {
  const channel = { baseUrl: 'https://www.runninghub.cn', apiKey: 'secret-key-x' };
  const lookup = async () => [{ address: '1.1.1.1', family: 4 }];
  const queryReply = value => async url => url.endsWith('/query') ? Response.json(value) : new Response('image');
  await assert.rejects(downloadResult(channel, '1', { fetchImpl: queryReply({ status: 'RUNNING' }), lookup }), error => error.status === 409 && /尚未完成/.test(error.message));
  await assert.rejects(downloadResult(channel, '1', { fetchImpl: queryReply({ status: 'SUCCESS', results: [{ url: 'http://a.com/x.png' }] }), lookup }), error => error.status === 422);
  const success = { status: 'SUCCESS', results: [{ url: 'https://rh-images.xiaoyaoyou.com/a/output/x.png' }] };
  const redirect = async (url, options) => { if (url.endsWith('/query')) return Response.json(success); assert.equal(options.redirect, 'manual'); return new Response(null, { status: 302, headers: { location: 'https://x/' } }); };
  await assert.rejects(downloadResult(channel, '1', { fetchImpl: redirect, lookup }), error => error.status === 422 && /发生跳转/.test(error.message));
  const opaque = async url => url.endsWith('/query') ? Response.json(success) : { status: 0, type: 'opaqueredirect' };
  await assert.rejects(downloadResult(channel, '1', { fetchImpl: opaque, lookup }), error => error.status === 422 && /发生跳转/.test(error.message));
  const blocked = async url => { if (url.endsWith('/query')) return Response.json(success); throw Object.assign(new Error('Redirect was cancelled'), { code: 'ERR_REDIRECT_BLOCKED' }); };
  await assert.rejects(downloadResult(channel, '1', { fetchImpl: blocked, lookup }), error => error.status === 422 && /发生跳转/.test(error.message));
  const offline = async url => { if (url.endsWith('/query')) return Response.json(success); throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND') }); };
  await assert.rejects(downloadResult(channel, '1', { fetchImpl: offline, lookup }), error => error.status === 502 && !/发生跳转/.test(error.message));
  const network = async url => { if (url.endsWith('/query')) return Response.json(success); throw new Error('fetch failed secret-key-x https://user:pw@cdn.example/x?signature=private'); };
  await assert.rejects(downloadResult(channel, '1', { fetchImpl: network, lookup }), error => {
    assert.equal(error.status, 502);
    assert.match(error.message, /fetch failed/);
    assert.ok(!error.message.includes('secret-key-x'));
    assert.ok(!error.message.includes('signature='));
    assert.ok(!error.message.includes('@'));
    return true;
  });
});

test('查询返回空状态和错误码时判定失败', async () => {
  const channel = { baseUrl: 'https://www.runninghub.cn', apiKey: 'invalid-key' };
  for (const [response, expected] of [
    [{ status: '', errorCode: '806', errorMessage: 'APIKEY_USER_NOT_FOUND' }, 'FAILED'],
    [{ status: '', errorCode: '' }, ''],
    [{ status: '', errorCode: '0' }, ''],
    [{ status: 'RUNNING', errorCode: '806' }, 'RUNNING'],
  ]) {
    const result = await query(channel, '1', { fetchImpl: async () => Response.json({ taskId: '1', ...response }) });
    assert.equal(result.status, expected);
    assert.equal(result.errorCode, response.errorCode);
    assert.equal(result.errorMessage, response.errorMessage);
  }
});

test('RunningHub 账户和查询保留网络异常原因，并脱敏密钥及限制长度', async () => {
  const channel = { baseUrl: 'https://www.runninghub.cn', apiKey: 'private-fixture-key' };
  const failures = [
    [new Error('net::ERR_PROXY_CONNECTION_FAILED'), /net::ERR_PROXY_CONNECTION_FAILED/],
    [new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED', message: 'proxy refused ' + channel.apiKey } }), /ECONNREFUSED proxy refused \*\*\*/],
    [new DOMException('The operation was aborted due to timeout', 'TimeoutError'), /TimeoutError.*timeout/],
    [new DOMException('This operation was aborted', 'AbortError'), /AbortError.*aborted/],
    [new Error(channel.apiKey + 'x'.repeat(500)), /\*\*\*x+/],
  ];
  for (const [failure, reason] of failures) {
    const fetchImpl = async url => {
      if (new URL(url).pathname.endsWith('/llms.txt')) return new Response(officialIndex.replaceAll('runninghub.ai/runninghub-api-doc-en', 'runninghub.cn/runninghub-api-doc-cn'));
      throw failure;
    };
    const result = await detect(channel, { fetchImpl });
    assert.equal(result.runningHub.models.length, 4);
    assert.match(result.runningHub.accountError, reason);
    assert.ok(!result.runningHub.accountError.includes(channel.apiKey));
    await assert.rejects(query(channel, '1', { fetchImpl }), error => {
      assert.match(error.message, /无法连接 RunningHub/);
      assert.match(error.message, reason);
      assert.ok(!error.message.includes(channel.apiKey));
      assert.ok(error.message.split('：')[1].length <= 300);
      return true;
    });
  }
});

test('RunningHub 目录和参数读取保留网络异常及 HTTP 状态', async () => {
  const baseUrl = 'https://www.runninghub.cn';
  const entry = { id: '123', importable: true, type: 'image', docUrl: baseUrl + '/runninghub-api-doc-cn/api-123.md' };
  for (const [fetchImpl, reason] of [
    [async () => { throw new Error('net::ERR_NAME_NOT_RESOLVED'); }, /net::ERR_NAME_NOT_RESOLVED/],
    [async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); }, /TimeoutError.*timeout/],
    [async () => new Response(null, { status: 503 }), /HTTP 503/],
  ]) {
    await assert.rejects(readCatalogue(baseUrl, fetchImpl), reason);
    await assert.rejects(loadModel('123', [entry], fetchImpl), reason);
  }
});

test('读取已添加的 RunningHub 模型前重新拉取目录，失效模型不使用缓存', async () => {
  const baseUrl = 'https://www.runninghub.cn';
  let available = true;
  const reads = [];
  const store = new ConfigStore('', null, null, async (url, request) => {
    reads.push(url);
    assert.equal(request.cache, 'no-store');
    assert.match(request.headers['Cache-Control'], /no-cache/);
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/llms.txt')) return new Response(`- 模型API > 图像生成与处理 > image-to-image [${available ? '当前模型' : '新模型'}](${baseUrl}/runninghub-api-doc-cn/api-${available ? '123' : '456'}.md):`);
    const schema = { required: ['prompt'], properties: { prompt: { type: 'string' } } };
    const definition = { paths: { '/openapi/v2/current/image-to-image': { post: { requestBody: { content: { 'application/json': { schema } } } } } } };
    return new Response(['# 当前模型', '```yaml', JSON.stringify(definition), '```'].join('\n'));
  });
  await store.readRunningHubModel('123', baseUrl);
  available = false;
  await assert.rejects(store.readRunningHubModel('123', baseUrl), /请先检测/);
  const catalogues = reads.filter(url => new URL(url).pathname.endsWith('/llms.txt'));
  assert.equal(catalogues.length, 2); assert.notEqual(catalogues[0], catalogues[1]);
});

test('OpenAI 兼容渠道每次检测联网读取模型，失败直接报错', async () => {
  let version = 0;
  const store = new ConfigStore('', null, null, async (_url, request) => {
    assert.equal(request.cache, 'no-store'); assert.equal(request.credentials, 'omit');
    assert.match(request.headers['Cache-Control'], /no-cache/);
    version++;
    return version === 3 ? new Response(null, { status: 503 }) : Response.json({ data: [{ id: 'gpt-live-' + version }] });
  });
  store.value = validateConfig({ channels: [] });
  const channel = { id: 'live', name: '实时渠道', baseUrl: 'https://example.com', apiKey: 'test-key', models: [], modelCapabilities: {} };
  assert.deepEqual((await store.testChannel(channel)).models, ['gpt-live-1']);
  assert.deepEqual((await store.testChannel(channel)).models, ['gpt-live-2']);
  await assert.rejects(store.testChannel(channel), /503/);
});

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
    if (new URL(url).pathname.endsWith('/llms.txt')) return new Response(`- ${cn ? '模型API > 图像生成与处理' : 'Standard Model API > Image Generation & Processing'} > text-to-image [${cn ? '悠船' : 'Other'}](https://www.runninghub.${cn ? 'cn/runninghub-api-doc-cn' : 'ai/runninghub-api-doc-en'}/api-123.md):`);
    if (new URL(url).pathname.endsWith('.md')) {
      assert.equal(request.headers.authorization, undefined);
      assert.match(request.headers['Cache-Control'], /no-cache/);
      const schema = { required: ['prompt'], properties: { prompt: { type: 'string' } } };
      const definition = { paths: { ['/openapi/v2/' + (cn ? endpoint : 'example/text-to-image')]: { post: { requestBody: { content: { 'application/json': { schema } } } } } } };
      return new Response(['# 测试模型', '\x60\x60\x60yaml', JSON.stringify(definition), '\x60\x60\x60'].join('\n'));
    }
    assert.equal(request.headers.authorization, 'Bearer ' + key);
    assert.equal(request.credentials, 'omit');
    if (new URL(url).pathname.endsWith('/accountStatus')) return Response.json({ code: 0, data: { remainMoney: cn ? '0.00' : '8.00', remainCoins: '0', currency: 'CNY' } });
    if (new URL(url).pathname.endsWith('/media/upload/binary')) return Response.json({ code: 0, data: { download_url: 'https://cdn.example.org/reference.png' } });
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
    if (new URL(url).pathname.endsWith('/llms.txt')) return new Response(index);
    return Response.json(new URL(url).pathname.endsWith('/v1/models') ? { data: [{ id: 'other-model' }] } : { code: 0, data: { apiType: 'NORMAL' } });
  });
  store.value = validateConfig({ channels: [] });
  const result = await store.testChannel(channel);
  assert.deepEqual(result.models, []);
  assert.deepEqual(result.runningHub.models.map(({ type, importable }) => [type, importable]), [['image', true], ['video', true], ['3d', false], ['3d', true]]);
  assert.equal(result.runningHub.models[2].name, '3D [Deprecated]');
  assert.equal(result.runningHub.accountError, '');
  assert.equal(calls[0].url.split('?')[0], 'https://www.runninghub.ai/runninghub-api-doc-en/llms.txt');
  assert.ok(new URL(calls[0].url).searchParams.get('_canvasFresh'));
  assert.equal(calls[0].request.headers.authorization, undefined);
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
    if (!new URL(url).pathname.endsWith('/llms.txt')) return new Response(null, { status: 401 });
    return new Response(fail ? '维护中' : officialIndex);
  });
  store.value = validateConfig({ channels: [channel], imageChannelId: channel.id, imageModel: model });
  assert.deepEqual(validateConfig({ channels: [{ ...channel, models: [] }] }).channels[0].models, []);
  const noKey = await store.testChannel(channel);
  assert.equal(noKey.runningHub.models.length, 4);
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
    if (new URL(url).pathname.endsWith('/llms.txt')) return new Response(officialIndex);
    const doc = docs[new URL(url).pathname.split('/').at(-1)];
    if (doc) {
      assert.equal(request.headers.authorization, undefined);
      assert.match(request.headers['Cache-Control'], /no-cache/);
      const [endpoint, required, properties] = doc;
      const definition = { paths: { ['/openapi/v2/' + endpoint]: { post: { requestBody: { content: { 'application/json': { schema: { required, properties } } } } } } } };
      return new Response(['# 测试模型', '', '\x60\x60\x60yaml', JSON.stringify(definition), '\x60\x60\x60'].join('\n'));
    }
    return Response.json({ code: 0, data: {} });
  });
  const input = { id: 'rh', name: 'RunningHub', protocol, baseUrl: 'https://www.runninghub.ai', apiKey: 'fixture-key' };
  store.value = validateConfig({ channels: [] });
  await store.testChannel(input);
  await assert.rejects(() => store.readRunningHubModel('456', 'https://www.runninghub.ai'), /请选择|请先检测/);
  const specs = await Promise.all(['448184504', '123'].map(id => store.readRunningHubModel(id, 'https://www.runninghub.ai')));
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
