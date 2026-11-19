import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generatedGlbProblem, hasActiveModelTask, modelTaskStatusText } from '../src/canvas-model-generator.js';

function glb(json) {
  const source = Buffer.from(JSON.stringify(json));
  const padded = Buffer.concat([source, Buffer.alloc((4 - source.length % 4) % 4, 0x20)]);
  const bytes = Buffer.alloc(20 + padded.length);
  bytes.write('glTF', 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(padded.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); padded.copy(bytes, 20);
  return bytes;
}

const cube = readFileSync(new URL('./fixtures/unit-cube.glb', import.meta.url));
assert.equal(generatedGlbProblem(cube), null);
console.log('PASS 普通 GLB 仍可加入场景');

const textured = {
  asset: { version: '2.0' },
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
  accessors: [{ min: [0, 0, 0], max: [1, 1, 1] }],
  images: [{ mimeType: 'image/ktx2' }],
  textures: [{ extensions: { KHR_texture_basisu: { source: 0 } } }],
  materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
};
for (const extensions of [
  { extensionsUsed: ['KHR_texture_basisu'], extensionsRequired: ['KHR_texture_basisu'] },
  { extensionsUsed: ['KHR_texture_basisu'] },
]) assert.match(generatedGlbProblem(glb({ ...textured, ...extensions })), /模型使用暂不支持的 KTX2 压缩纹理/);
console.log('PASS 必需及仅使用 KTX2 时显示中文提示');

assert.equal(generatedGlbProblem(glb({ asset: { version: '2.0' } })), '生成文件不包含可显示的网格，请核对平台结果');
console.log('PASS 无可显示网格时保留原有提示');

assert.equal(hasActiveModelTask([]), false);
assert.equal(hasActiveModelTask([{ status: 'completed' }, { status: 'failed' }]), false);
for (const status of ['submitting', 'processing', 'download_failed']) assert.equal(hasActiveModelTask([{ status }]), true);
assert.equal(hasActiveModelTask([{ status: 'download_failed', downloadStopped: true }]), false);
console.log('PASS 只有活动任务继续轮询');

for (const [input, expected] of [
  [{ status: 'processing', platformStatus: 'QUEUED' }, '排队中'],
  [{ status: 'processing', platformStatus: 'RUNNING' }, '生成中'],
  [{ status: 'processing' }, '生成中'],
  [{ status: 'processing', download: { received: 4718592, total: 10485760 } }, '下载中 45%（4.5 / 10.0 MB）'],
  [{ status: 'processing', download: { received: 4718592, total: 0 } }, '下载中 · 已下载 4.5 MB'],
  [{ status: 'download_failed', downloadStopped: true, download: { received: 1, total: 2 } }, '模型下载已停止自动重试'],
  [{ status: 'completed' }, '已生成并保存到本机'],
  [{ status: 'weird' }, '待查询'],
]) assert.equal(modelTaskStatusText(input), expected);
console.log('PASS 排队、生成、下载进度及终态文案');
