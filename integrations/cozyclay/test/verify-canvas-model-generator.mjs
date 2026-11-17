import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generatedGlbProblem } from '../src/canvas-model-generator.js';

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
