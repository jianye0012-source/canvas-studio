const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { discoverModels } = require('../lib/model-catalog.cjs');
const { ConfigStore, supportsRole } = require('../lib/config.cjs');

test('按输出能力归类，读不到能力的名称待确认，工具支持只影响白模', () => {
  const result = discoverModels([
    { id: 'plain', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, supported_parameters: ['tools'] },
    { id: 'no-tools', type: 'text', supports_tools: false },
    { id: 'artist', output_modalities: ['image'] },
    'kling-v3', 'gemini-3.7-flash', 'gpt-image-2', 'qwen3.6-flash', 'unknown-model', 'text-embedding-3-small', null,
  ]);
  assert.deepEqual(result.modelCapabilities, { plain: 'text', 'no-tools': 'text', artist: 'image', 'kling-v3': 'video', 'gemini-3.7-flash': 'text', 'gpt-image-2': 'image', 'qwen3.6-flash': 'text' });
  assert.deepEqual(result.modelToolSupport, { plain: true, 'no-tools': false });
  assert.ok(result.models.includes('unknown-model'));
  assert.equal(supportsRole(result, 'no-tools', 'director'), false);
  assert.equal(supportsRole(result, 'no-tools', 'text'), true);
});

test('新增和保存另一渠道后，原有四个默认模型和同名模型的渠道均保留', async t => {
  const root = await fs.mkdtemp(path.resolve(__dirname, '../../work/tmp/catalogue-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = await new ConfigStore(root).initialize();
  const models = ['gpt-4o', 'gpt-image-2', 'kling-v3'];
  const modelCapabilities = { 'gpt-4o': 'text', 'gpt-image-2': 'image', 'kling-v3': 'video' };
  const a = { id: 'a', name: '原渠道', baseUrl: 'https://first.example', models, modelCapabilities };
  const b = { id: 'b', name: '新渠道', baseUrl: 'https://second.example', models, modelCapabilities };
  const choices = { textChannelId: 'a', textModel: 'gpt-4o', directorChannelId: 'a', directorModel: 'gpt-4o', imageChannelId: 'a', imageModel: 'gpt-image-2', videoChannelId: 'a', videoModel: 'kling-v3' };
  await store.save({ channels: [a], ...choices });
  await store.save({ channels: [a, b] });
  const reopened = await new ConfigStore(root).initialize();
  assert.equal(reopened.public().channels.length, 2);
  for (const [key, value] of Object.entries(choices)) assert.equal(reopened.public()[key], value);
});
