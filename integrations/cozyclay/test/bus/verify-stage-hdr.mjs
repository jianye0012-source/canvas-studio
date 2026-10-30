// The stage's HDR environment (stage.lighting.hdr, hdrRotation, hdrIntensity,
// hdrBackground; src/stage-hdr*.js): field normalization and recipes, the
// built-in maps, decoding a generated .hdr through three's HDRLoader, the asset
// record and its content address, project embedding and the resource manifest,
// stage.set and verify_result, and the agent's catalogue.
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { DataUtils } from 'three';
import { createSceneStage } from '../../src/scenes.js';
import { applyLightingRecipe, LIGHTING_KEEP_PATHS, LIGHTING_PRESETS, normalizeLighting, stageLook } from '../../src/stage-lighting.js';
import { declaredHdrSize, HDR_BUILTINS, HDR_MAX_PIXELS, hdrFileProblem, hdrIdForBytes, isHdrEnvironmentId, normalizeHdrFields, sniffHdrType, wrapDegrees } from '../../src/stage-hdr.js';
import { builtinEnvironmentPixels, BUILTIN_HEIGHT, BUILTIN_WIDTH } from '../../src/stage-hdr-builtins.js';
import { analyzedMap, decodeRadiance, fitMap, halfMapFromFloats, HDR_MAX_WIDTH, mapBrightest, mapHorizon } from '../../src/stage-hdr-image.js';
import { isAssetId, normalizeAsset, referencedAssetIds, unreachableAssetIds } from '../../src/scene-assets.js';
import { createProjectDocument, readProjectDocument, verifyEmbeddedAsset } from '../../src/project.js';
import { resourceManifest } from '../../src/project-resources.js';
import { hdrEnvironmentCatalogue } from '../../src/stage-hdr-library.js';
import { lightingChecks } from '../../src/studio-lighting-check.js';
import { elementByPath } from '../../src/studio-elements.js';
import { encodeRgbe, sunSpotMap } from '../hdr-fixture.mjs';
import { stageFixture } from './stage-fixture.mjs';

const dot = (a, b) => (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(...a) / Math.hypot(...b);
const unit = (az, el) => [Math.cos(el * Math.PI / 180) * Math.cos(az * Math.PI / 180), Math.sin(el * Math.PI / 180), Math.cos(el * Math.PI / 180) * Math.sin(az * Math.PI / 180)];
const FILE_ID = `hdr-${'ab'.repeat(16)}`;

// 1. Fields: no map by default, built-ins and file ids accepted, rotation wrapped, intensity clamped.
assert.deepEqual(normalizeHdrFields(), { hdr: null, hdrRotation: 0, hdrIntensity: 1, hdrBackground: true });
assert.deepEqual(createSceneStage(null).lighting.hdr, null, 'a new stage has no HDR');
const legacy = createSceneStage({ lighting: { preset: 'night', sky: '#0b1426', envLight: 1 } }).lighting;
assert.deepEqual([legacy.hdr, legacy.hdrRotation, legacy.hdrIntensity, legacy.hdrBackground], [null, 0, 1, true], 'a look saved before the fields existed has none');
for (const id of [...HDR_BUILTINS.map(entry => entry.id), FILE_ID]) assert.equal(normalizeLighting({ hdr: id }).hdr, id);
for (const bad of ['builtin:moon', 'hdr-123', `img-${'ab'.repeat(16)}`, 7, '']) assert.equal(normalizeLighting({ hdr: bad }).hdr, null, `${bad} is no environment`);
assert.ok(isHdrEnvironmentId('builtin:studio-softbox') && !isHdrEnvironmentId('studio-softbox'));
assert.deepEqual([190, 180, -180, -540, 725.5].map(wrapDegrees), [-170, -180, -180, -180, 5.5]);
assert.deepEqual([normalizeLighting({ hdrRotation: 190 }).hdrRotation, normalizeLighting({ hdrIntensity: 9 }).hdrIntensity, normalizeLighting({ hdrIntensity: -1 }).hdrIntensity, normalizeLighting({ hdrBackground: 'yes' }).hdrBackground], [-170, 4, 0, true]);
for (const [path, type] of [['stage.lighting.hdr', 'id'], ['stage.lighting.hdrRotation', 'number'], ['stage.lighting.hdrIntensity', 'number'], ['stage.lighting.hdrBackground', 'boolean']]) {
  const row = elementByPath(path);
  assert.ok(row && row.type === type && row.persisted && row.undoDomain === 'stage' && row.note.length > 60, `${path} is an agent-facing row with a note`);
}
assert.deepEqual([elementByPath('stage.lighting.hdrRotation').min, elementByPath('stage.lighting.hdrRotation').max, elementByPath('stage.lighting.hdrIntensity').max], [-180, 180, 4]);
console.log('PASS fields: null by default and for old looks, built-ins and hdr- ids only, rotation wrapped, intensity 0..4, rows with notes');

// 2. Recipes clear the map unless kept; the look hands the light to it.
const withMap = createSceneStage({ lighting: { hdr: 'builtin:night-street', hdrRotation: 45, hdrIntensity: 2, hdrBackground: false, envLight: 1 } });
for (const preset of LIGHTING_PRESETS) assert.equal(applyLightingRecipe(withMap, preset).lighting.hdr, null, `${preset} clears the HDR`);
assert.ok(LIGHTING_KEEP_PATHS.includes('lighting.hdr'));
const kept = applyLightingRecipe(withMap, 'night', ['lighting.hdr']).lighting;
assert.deepEqual([kept.hdr, kept.hdrRotation, kept.hdrIntensity, kept.hdrBackground, kept.preset], ['builtin:night-street', 45, 2, false, 'night'], 'keep lighting.hdr holds all four');
const KEY = { x: 6, y: 9, z: 4, intensity: 1.12, warmth: 0.5, color: null };
assert.equal(stageLook({ lighting: null, keyLight: KEY }).hdr, null, 'no map, no hdr look');
const look = stageLook({ lighting: { ...withMap.lighting, envLight: 1.5 }, keyLight: KEY });
assert.deepEqual(look.hdr, { id: 'builtin:night-street', rotation: 45, intensity: 2, background: false, envIntensity: 3 }, 'light = file x hdrIntensity x envLight');
assert.ok(look.env, 'the sky map stays the fallback until the file loads');
const themedLight = stageLook({ lighting: { hdr: 'builtin:studio-softbox', hdrBackground: false }, keyLight: KEY, theme: 'light' });
const backdropLight = stageLook({ lighting: { hdr: 'builtin:studio-softbox', hdrBackground: true }, keyLight: KEY, theme: 'light' });
assert.deepEqual([themedLight.lightDeck, backdropLight.lightDeck, backdropLight.sky], [true, false, stageLook({ lighting: null, keyLight: KEY, theme: 'dark' }).sky], 'an HDR backdrop is theme-independent: the dark stage under it in either theme');
console.log('PASS recipes clear the HDR (keep "lighting.hdr" holds rotation, intensity and backdrop too); stageLook hdr light = intensity x envLight');

// 3. Built-ins: deterministic, finite, brightest where the catalogue says.
for (const entry of HDR_BUILTINS) {
  const pixels = builtinEnvironmentPixels(entry.id);
  assert.equal(pixels.length, BUILTIN_WIDTH * BUILTIN_HEIGHT * 4);
  assert.ok(pixels.every(value => Number.isFinite(value) && value >= 0), `${entry.id} is finite and non-negative`);
  assert.deepEqual(builtinEnvironmentPixels(entry.id), pixels, `${entry.id} is the same every time`);
  const map = analyzedMap(halfMapFromFloats(BUILTIN_WIDTH, BUILTIN_HEIGHT, pixels));
  assert.deepEqual(map.brightest, [...entry.brightest], `${entry.id} brightest`);
  assert.ok(map.horizon.every(value => value > 0.005), `${entry.id} horizon ${map.horizon}`);
}
assert.equal(builtinEnvironmentPixels('builtin:moon'), null);
console.log('PASS built-ins: three deterministic maps, brightest direction as listed');

// 4. A generated .hdr: valid for three's HDRLoader, rows flipped bottom-up, the sun where it was drawn.
const sun = sunSpotMap({ width: 256, height: 128, az: 30, el: 25, radius: 6, sun: 40 });
const file = encodeRgbe(sun.width, sun.height, sun.rgb);
assert.equal(sniffHdrType(file), 'image/vnd.radiance');
assert.deepEqual(declaredHdrSize('image/vnd.radiance', file), { width: 256, height: 128 });
const decoded = decodeRadiance(file.buffer);
assert.deepEqual([decoded.width, decoded.height], [256, 128]);
assert.ok(dot(decoded.brightest, unit(30, 25)) > 0.9995, `the sun decodes at az 30 el 25: ${decoded.brightest}`);
const texel = (map, row, column) => [0, 1, 2].map(c => DataUtils.fromHalfFloat(map.data[(row * map.width + column) * 4 + c]));
assert.ok(Math.abs(texel(decoded, 0, 10)[2] - 0.04) < 0.002 && Math.abs(texel(decoded, 127, 10)[2] - 0.12) < 0.004, 'row 0 is the ground, the last row the sky');
assert.ok(Math.abs(texel(decoded, 64 + 17, 128 + 21)[0] - 40) < 0.5, 'the sun keeps its radiance (above 1, a real HDR)');
assert.ok(decoded.horizon[2] > decoded.horizon[0], `horizon is the sky and ground mean: ${decoded.horizon}`);
console.log(`PASS a generated .hdr decodes through HDRLoader: 256x128, sun at ${decoded.brightest}, radiance 40 kept, horizon ${decoded.horizon}`);

// 5. fitMap: a wide map is box-filtered by a whole factor and flipped once.
const wide = { width: 4100, height: 4, data: new Uint16Array(4100 * 4 * 4), topDown: true };
for (let column = 0; column < 4100; column++) for (let row = 0; row < 4; row++) wide.data.set([DataUtils.toHalfFloat(row), 0, 0, DataUtils.toHalfFloat(1)], (row * 4100 + column) * 4);
const fitted = fitMap(wide);
assert.deepEqual([fitted.width, fitted.height, HDR_MAX_WIDTH], [1366, 1, 2048], 'factor 3 keeps it under 2048');
assert.equal(DataUtils.fromHalfFloat(fitted.data[0]), 2, 'rows 3..1 (top-down 0..2) average to 2');
assert.deepEqual(mapBrightest(halfMapFromFloats(2, 1, new Float32Array([0, 0, 0, 1, 5, 5, 5, 1]))), [0, 0, 1], 'the brightest texel is +z');
assert.deepEqual(mapHorizon(halfMapFromFloats(1, 2, new Float32Array([1, 2, 3, 1, 3, 4, 5, 1]))), [2, 3, 4]);
console.log('PASS fitMap: whole-factor box filter under 2048, one flip; brightest and horizon read the map');

// 6. The file as an asset: sniffed, size-checked, content-addressed, kept verbatim, reachable through the stage.
assert.equal(hdrFileProblem(33 * 1048576, 'image/vnd.radiance', { width: 2, height: 1 }), 'that file is 33.0 MB; an HDR environment can be at most 32 MB');
assert.match(hdrFileProblem(10, null, null), /not an HDR environment/);
assert.match(hdrFileProblem(10, 'image/vnd.radiance', { width: 8192, height: 4096 }), /limit is 16 megapixels/);
assert.equal(HDR_MAX_PIXELS, 4096 * 4096);
assert.match(hdrFileProblem(10, 'image/x-exr', null), /no readable image size/);
assert.equal(hdrFileProblem(file.length, 'image/vnd.radiance', { width: 256, height: 128 }), null);
const exr = new Uint8Array(64), view = new DataView(exr.buffer);
exr.set([0x76, 0x2f, 0x31, 0x01, 2, 0, 0, 0]);
exr.set(new TextEncoder().encode('dataWindow\0box2i\0'), 8);
[16, 0, 0, 1023, 511].forEach((value, i) => view.setInt32(25 + i * 4, value, true));
assert.equal(sniffHdrType(exr), 'image/x-exr');
assert.deepEqual(declaredHdrSize('image/x-exr', exr), { width: 1024, height: 512 });
assert.equal(sniffHdrType(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), 'image/png');
assert.equal(sniffHdrType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
const id = await hdrIdForBytes(file, webcrypto.subtle);
assert.match(id, /^hdr-[0-9a-f]{32}$/);
assert.ok(isAssetId(id));
const record = normalizeAsset({ id, type: 'image/vnd.radiance', bytes: file.buffer, name: 'sun.hdr', width: 256, height: 128, brightest: decoded.brightest });
assert.deepEqual(Object.keys(record), ['id', 'type', 'bytes', 'name', 'width', 'height', 'brightest']);
assert.equal(normalizeAsset({ id, type: 'model/gltf-binary', bytes: file.buffer }), null, 'an hdr- id must carry an environment type');
const scenes = [{ id: 'scene-1', objects: [], stage: createSceneStage({ lighting: { hdr: id, envLight: 1 } }) }, { id: 'scene-2', objects: [], stage: createSceneStage(null) }];
assert.ok(referencedAssetIds(scenes).has(id), 'the stage look holds its file');
assert.deepEqual(unreachableAssetIds([id, FILE_ID], scenes), [FILE_ID], 'a file no scene names is unreachable');
console.log(`PASS the asset: sniffed (hdr/exr/png/jpg), 32 MB and 16 MP limits, ${id}, kept verbatim with its size and brightest, reachable through stage.lighting.hdr`);

// 7. A saved project embeds the file and opening it brings it back, verified against its address.
const project = createProjectDocument({ scenesDocument: { version: 1, activeSceneId: 'scene-1', scenes }, name: 'HDR', assets: [record] });
assert.deepEqual(project.resources.assets.map(asset => [asset.id, asset.type, asset.name]), [[id, 'image/vnd.radiance', 'sun.hdr']]);
const opened = readProjectDocument(JSON.stringify(project));
assert.equal(opened.ok, true, JSON.stringify(opened));
const back = opened.project.assets.find(asset => asset.id === id);
assert.ok(back && back.bytes.byteLength === file.length && await verifyEmbeddedAsset(back, webcrypto.subtle), 'the file comes back byte for byte under its own address');
assert.equal(opened.project.scenesDocument.scenes[0].stage.lighting.hdr, id);
const manifest = resourceManifest({ scenesDocument: { scenes }, assets: [record] });
assert.deepEqual(manifest.items.filter(item => item.kind === 'environment').map(item => [item.id, item.status, item.bytes]), [[id, 'embedded', file.length]]);
assert.deepEqual(resourceManifest({ scenesDocument: { scenes } }).missing.map(item => item.kind), ['environment'], 'a scene naming a file nobody has reports it missing');
console.log('PASS project: embedded on save, back on open under a verified address, listed in the manifest (missing when absent)');

// 8. stage.set and verify_result carry the fields; the agent's catalogue lists the built-ins.
const f = stageFixture();
try {
  const set = f.run('stage.set', { lighting: { hdr: 'builtin:overcast-field', hdrRotation: 200, hdrIntensity: 1.5, hdrBackground: false, envLight: 1 } }, 'agent');
  assert.equal(set.ok, true, JSON.stringify(set));
  const lighting = f.stage.read().lighting;
  assert.deepEqual([lighting.hdr, lighting.hdrRotation, lighting.hdrIntensity, lighting.hdrBackground], ['builtin:overcast-field', -160, 1.5, false]);
  assert.equal(f.run('stage.set', { lighting: { hdr: null } }, 'agent').ok, true);
  assert.equal(f.stage.read().lighting.hdr, null);
  const catalogue = await f.binding.handlers.inspect_studio({ scope: 'catalogue' });
  assert.deepEqual(catalogue.environments.map(entry => [entry.id, entry.source]), HDR_BUILTINS.map(entry => [entry.id, 'builtin']));
  assert.ok(catalogue.environments.every(entry => entry.brightest.length === 3 && entry.note));
} finally { f.dispose(); }
assert.deepEqual(hdrEnvironmentCatalogue().map(entry => entry.id), HDR_BUILTINS.map(entry => entry.id), 'without IndexedDB the catalogue is the built-ins');
const state = { frame: 0, camera: { position: { x: 0, y: 1, z: 4 }, lookAt: { x: 0, y: 1, z: 0 }, focalMm: 35 }, filmback: { sensorId: 'super35' }, characters: [], objects: [],
  stage: { lighting: { preset: 'night', envLight: 1, ao: 0.8, hdr: 'builtin:night-street', hdrRotation: 90 } } };
assert.deepEqual(lightingChecks([], state, { renderFrameBuffer: () => ({ width: 4, height: 4, data: new Uint8Array(64) }) }).look,
  { preset: 'night', envLight: 1, ao: 0.8, hdr: 'builtin:night-street', hdrLoaded: true, hdrRotation: 90, hdrIntensity: 1, hdrBackground: true });
console.log('PASS stage.set writes the four fields (rotation wrapped); inspect_studio catalogue lists environments; verify_result look names the HDR and whether it loaded');
