import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => 'zh' };
globalThis.requestAnimationFrame = callback => callback();
const { addGeneratedModel } = await import('../src/canvas-model-generator.js');

function glb(json, bin = Buffer.alloc(0)) {
  const pad = (bytes, fill) => Buffer.concat([bytes, Buffer.alloc((4 - bytes.length % 4) % 4, fill)]);
  const body = pad(Buffer.from(JSON.stringify(json)), 0x20), data = pad(bin, 0);
  const header = Buffer.alloc(12); header.write('glTF', 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + body.length + 8 + data.length, 8);
  const chunk = (bytes, type) => { const info = Buffer.alloc(8); info.writeUInt32LE(bytes.length, 0); info.writeUInt32LE(type, 4); return Buffer.concat([info, bytes]); };
  return Buffer.concat([header, chunk(body, 0x4e4f534a), chunk(data, 0x004e4942)]);
}

const geometry = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
const bin = Buffer.concat([geometry, Buffer.alloc(20 * 1024 * 1024 - geometry.length)]);
const model = {
  asset: { version: '2.0' }, buffers: [{ byteLength: bin.length }],
  bufferViews: [{ buffer: 0, byteLength: geometry.length }],
  accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
};
const blob = new Blob([glb(model, bin)]);
let imported = 0, saved = [];
await addGeneratedModel({ blob, name: '测试模型', importMesh: async file => {
  imported++;
  assert.ok(file instanceof File);
  assert.equal(file.size, blob.size);
  assert.equal(file.name, '测试模型.glb');
  assert.equal(file.type, 'model/gltf-binary');
  return { ok: true, output: { objectId: 'mesh' } };
}, save: async force => { saved.push(force); } });
assert.equal(imported, 1); assert.deepEqual(saved, [true]);
console.log('PASS 20 MB GLB 通过 File 导入并保存');

saved = [];
await assert.rejects(addGeneratedModel({ blob, name: '测试模型', importMesh: async () => ({ ok: false, message: 'Not imported: Could not import that model: That model is too large to import — larger than 100 MB' }), save: async force => { saved.push(force); } }), { message: '导入失败：模型过大，超过 100 MB，无法导入' });
assert.deepEqual(saved, []);
console.log('PASS 超过 100 MB 的回执显示中文原因且不保存');

const ktx2 = { ...model, extensionsUsed: ['KHR_texture_basisu'], extensionsRequired: ['KHR_texture_basisu'], images: [{ mimeType: 'image/ktx2' }], textures: [{ extensions: { KHR_texture_basisu: { source: 0 } } }], materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }] };
imported = 0;
await assert.rejects(addGeneratedModel({ blob: new Blob([glb(ktx2)]), name: 'KTX2', importMesh: async () => { imported++; return { ok: true }; }, save: async () => {} }), { message: '模型使用暂不支持的 KTX2 压缩纹理，请导出使用 PNG / JPEG 纹理的 GLB' });
assert.equal(imported, 0);
console.log('PASS KTX2 模型在导入前拒绝');
