// The stage look's environment light (stage.lighting.envLight, src/stage-environment.js)
// and ambient occlusion (stage.lighting.ao, src/stage-occlusion.js): normalization,
// recipes, the map's pixels, the hemisphere hand-over, the occlusion hook's
// skip rules and state restore, and verify_result's look readback.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createServer } from 'vite';
import { createSceneStage } from '../../src/scenes.js';
import { applyLightingRecipe, LIGHTING_KEEP_PATHS, LIGHTING_PRESETS, LIGHTING_RECIPES, normalizeLighting, stageLook } from '../../src/stage-lighting.js';
import { ENV_HEIGHT, ENV_WIDTH, environmentPixels, environmentRadiance, environmentSpec, linearRgb, luminance } from '../../src/stage-environment.js';
import { lightingChecks } from '../../src/studio-lighting-check.js';
import { elementByPath } from '../../src/studio-elements.js';
import { stageFixture } from './stage-fixture.mjs';

const close = (a, b, eps, message) => assert.ok(Math.abs(a - b) <= eps, `${message}: ${a} vs ${b}`);

// Normalization: both fields default to 0 (the studio look), clamp to their rows, survive when valid.
assert.deepEqual([createSceneStage(null).lighting.envLight, createSceneStage(null).lighting.ao], [0, 0], 'a new stage has no environment light and no occlusion');
const legacyNight = createSceneStage({ lighting: { preset: 'night', sky: '#0b1426' } }).lighting;
assert.deepEqual([legacyNight.envLight, legacyNight.ao], [0, 0], 'a night look saved before the fields existed renders as it did');
assert.deepEqual([normalizeLighting({ envLight: 5, ao: 3 }).envLight, normalizeLighting({ envLight: 5, ao: 3 }).ao], [2, 1], 'clamped to the rows');
assert.deepEqual([normalizeLighting({ envLight: -1, ao: 'on' }).envLight, normalizeLighting({ envLight: -1, ao: 'on' }).ao], [0, 0]);
assert.deepEqual([normalizeLighting({ envLight: 1.4, ao: 0.5 }).envLight, normalizeLighting({ envLight: 1.4, ao: 0.5 }).ao], [1.4, 0.5]);
for (const [path, max] of [['stage.lighting.envLight', 2], ['stage.lighting.ao', 1]]) {
  const row = elementByPath(path);
  assert.ok(row && row.min === 0 && row.max === max && row.persisted && row.undoDomain === 'stage' && /e\.g\.|= /.test(row.note), `${path} is an agent-facing row with range and example`);
}
assert.ok(LIGHTING_KEEP_PATHS.includes('lighting.envLight') && LIGHTING_KEEP_PATHS.includes('lighting.ao'));
console.log('PASS envLight/ao normalization: 0 by default and for old looks, clamped, rows with range and notes, keepable');

// Recipes: studio keeps both off; every other look lights with the map and occludes.
assert.deepEqual([LIGHTING_RECIPES.studio.lighting.envLight, LIGHTING_RECIPES.studio.lighting.ao], [0, 0]);
for (const preset of LIGHTING_PRESETS.filter(p => p !== 'studio')) {
  const { lighting } = applyLightingRecipe(createSceneStage(null), preset);
  assert.ok(lighting.ao >= 0.6, `${preset} occludes`);
  assert.equal(lighting.envLight, preset === 'stage' ? 0 : 1, `${preset} environment light`);
}
const kept = applyLightingRecipe(createSceneStage({ lighting: { ao: 0.3 } }), 'night', ['lighting.ao']);
assert.deepEqual([kept.lighting.ao, kept.lighting.envLight], [0.3, 1], 'keep holds ao back');
console.log('PASS recipes: studio 0/0, the others envLight 1 (stage 0: a black void) and ao 0.6..1, keep');

// stageLook: studio has no map and the full hemisphere; envLight hands the hemisphere's share to the map.
const STUDIO_KEY = { x: 6, y: 9, z: 4, intensity: 1.12, warmth: 0.5, color: null };
for (const theme of ['dark', 'light']) {
  const studio = stageLook({ lighting: null, keyLight: STUDIO_KEY, theme });
  assert.deepEqual([studio.env, studio.envIntensity, studio.ao, studio.hemi.intensity], [null, 0, 0, 0.9], `studio (${theme}): no map, no occlusion, the tuned hemisphere`);
}
const night = applyLightingRecipe(createSceneStage(null), 'night');
const nightLook = stageLook(night);
const lift = Math.min(1, 0.35 + 0.65 * (night.keyLight.intensity / 1.12)), skyLight = 0.9 * lift * night.lighting.ambient;
assert.equal(nightLook.hemi.intensity, 0, 'envLight 1: the map replaces the hemisphere');
close(nightLook.envIntensity, skyLight / Math.PI, 1e-12, 'at the hemisphere level (three multiplies IBL irradiance by pi)');
assert.equal(nightLook.ao, 0.8);
const half = stageLook({ ...night, lighting: { ...night.lighting, envLight: 0.5 } });
close(half.hemi.intensity, skyLight / 2, 1e-12, 'envLight 0.5: half the hemisphere');
close(half.envIntensity, skyLight / 2 / Math.PI, 1e-12, 'and half the map');
console.log('PASS stageLook: studio unchanged in both themes, envLight hands the hemisphere to the map at the same level');

// The map: colours from the look, sky half at hemiSky's level, ground below, glow toward the key.
const spec = nightLook.env;
const flat = { ...spec, sun: { ...spec.sun, color: [0, 0, 0] } };
let weighted = 0, weights = 0;
for (let step = 0; step < 90; step++) for (let turn = 0; turn < 36; turn++) {
  const el = ((step + 0.5) * Math.PI) / 180, az = ((turn + 0.5) * Math.PI) / 18, weight = Math.cos(el);
  weighted += luminance(environmentRadiance(flat, [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)])) * weight;
  weights += weight;
}
close(weighted / weights, luminance(linearRgb(night.lighting.hemiSky)), 1e-3, 'the sky half carries hemiSky\'s light in total');
const down = environmentRadiance(spec, [0, -1, 0]), up = environmentRadiance(spec, [0, 1, 0]);
assert.deepEqual(down.map(v => Number(v.toFixed(5))), linearRgb(night.lighting.hemiGround).map(v => Number(v.toFixed(5))), 'straight down is the ground bounce');
assert.ok(up[2] > up[0] && luminance(up) < luminance(environmentRadiance(flat, [1, 0.05, 0])), 'night: a blue sky, darker overhead than at the horizon');
const key = spec.sun.direction;
const toward = luminance(environmentRadiance(spec, key)), away = luminance(environmentRadiance(spec, [-key[0], key[1], -key[2]]));
assert.ok(toward > 3 * away, `the moon's glow: ${toward} toward vs ${away} away`);
close(Math.hypot(...key), 1, 1e-4, 'the key direction is a unit vector');
const golden = stageLook(applyLightingRecipe(createSceneStage(null), 'golden')).env;
const sunSide = environmentRadiance(golden, golden.sun.direction), zenith = environmentRadiance(golden, [0, 1, 0]);
assert.ok(sunSide[0] > sunSide[2] && zenith[2] > zenith[0], 'golden: warm toward the low sun, blue overhead');
const overcast = stageLook(applyLightingRecipe(createSceneStage(null), 'overcast')).env, day = stageLook(applyLightingRecipe(createSceneStage(null), 'day')).env;
assert.ok(luminance(overcast.sun.color) / luminance(linearRgb('#e3e8ef')) < luminance(day.sun.color) / luminance(linearRgb('#c4dcff')), 'a soft-shadowed look has a fainter sun glow');
const pixels = environmentPixels(spec);
assert.equal(pixels.length, ENV_WIDTH * ENV_HEIGHT * 4);
const pixel = (row, column) => Array.from(pixels.slice((row * ENV_WIDTH + column) * 4, (row * ENV_WIDTH + column) * 4 + 3));
assert.ok(luminance(pixel(0, 0)) < luminance(pixel(ENV_HEIGHT / 2 + 2, 0)) || night.lighting.hemiGround === night.lighting.sky, 'row 0 is the ground (straight down)');
// three samples an equirect at u = atan2(z, x) / 2pi + 0.5, v = asin(y) / pi + 0.5: the texel there is the glow.
const texelOf = ([x, y, z]) => (Math.min(ENV_HEIGHT - 1, Math.floor((Math.asin(y) / Math.PI + 0.5) * ENV_HEIGHT)) * ENV_WIDTH + Math.min(ENV_WIDTH - 1, Math.floor((Math.atan2(z, x) / (2 * Math.PI) + 0.5) * ENV_WIDTH))) * 4;
assert.ok(luminance(pixels.slice(texelOf(key), texelOf(key) + 3)) > 3 * luminance(pixels.slice(texelOf([-key[0], key[1], -key[2]]), texelOf([-key[0], key[1], -key[2]]) + 3)), 'the glow sits where three looks for the key\'s direction');
assert.equal(environmentSpec({ ...night.lighting, envLight: 0 }, night.keyLight, '#0b1426'), null, 'envLight 0 builds no map');
const black = environmentSpec({ ...LIGHTING_RECIPES.stage.lighting, envLight: 1 }, LIGHTING_RECIPES.stage.keyLight, '#000000');
assert.deepEqual([black.horizon, black.zenith, black.ground], [[0, 0, 0], [0, 0, 0], [0, 0, 0]], 'a black sky with a black hemisphere lights nothing');
console.log('PASS the map: sky half at hemiSky level, ground below, the key\'s glow, warm/blue golden, fainter for soft looks, equirect layout');

// stage.applyLighting and stage.set carry both fields; verify_result reads the look back.
const f = stageFixture();
try {
  assert.equal(f.run('stage.applyLighting', { preset: 'night' }, 'agent').ok, true);
  assert.deepEqual([f.stage.read().lighting.envLight, f.stage.read().lighting.ao], [1, 0.8]);
  const tweak = f.run('stage.set', { lighting: { envLight: 1.5, ao: 0.4 } }, 'agent');
  assert.equal(tweak.ok, true, JSON.stringify(tweak));
  assert.deepEqual([f.stage.read().lighting.envLight, f.stage.read().lighting.ao, f.stage.read().lighting.preset], [1.5, 0.4, 'night']);
  f.ports.renderFrameBuffer = () => ({ width: 32, height: 18, data: new Uint8Array(32 * 18 * 4).fill(40) });
  const verified = await f.binding.handlers.verify_result(f.request('verify_result', { targets: ['actor-a'], checks: ['lighting'] }));
  assert.deepEqual(verified.checks.lighting.look, { preset: 'night', envLight: 1.5, ao: 0.4 }, JSON.stringify(verified.checks.lighting));
  assert.equal(f.run('stage.applyLighting', { preset: 'studio' }, 'agent').ok, true);
  assert.deepEqual([f.stage.read().lighting.envLight, f.stage.read().lighting.ao], [0, 0], 'studio switches both off');
} finally { f.dispose(); }
const state = { frame: 0, camera: { position: { x: 0, y: 1, z: 4 }, lookAt: { x: 0, y: 1, z: 0 }, focalMm: 35 }, filmback: { sensorId: 'super35' }, characters: [], objects: [], stage: { lighting: { preset: 'golden', envLight: 1, ao: 0.8 } } };
assert.deepEqual(lightingChecks([], state, { renderFrameBuffer: () => ({ width: 4, height: 4, data: new Uint8Array(64) }) }).look, { preset: 'golden', envLight: 1, ao: 0.8 });
console.log('PASS stage.applyLighting / stage.set write envLight and ao; verify_result lighting answers look { preset, envLight, ao }');

// The occlusion hook (loaded through Vite: it imports the layer constants from a .jsx module).
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
let installOcclusion;
try { ({ installOcclusion } = await server.ssrLoadModule('/src/stage-occlusion.js')); } finally { await server.close(); }
const scene = new THREE.Scene(), background = new THREE.Color('#123456');
scene.background = background;
const solid = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
const halo = Object.assign(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })), { userData: { beautyOnly: true } });
const smoke = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ transparent: true }));
scene.add(solid, halo, smoke);
const output = { isRenderTarget: true, name: 'export' };
const log = [];
let current = output;
const renderer = {
  autoClear: true, shadowMap: { autoUpdate: true, needsUpdate: false },
  getRenderTarget: () => current, setRenderTarget(target) { current = target; log.push(['target', target === output ? 'export' : target ? `${target.width}x${target.height}` : 'canvas']); },
  getViewport: v => v.set(0, 0, 1920, 1080), getScissor: v => v.set(0, 0, 1920, 1080), getCurrentViewport: v => v.set(0, 0, 1920, 1080),
  setViewport() { log.push(['viewport']); }, setScissor() {},
  render(drawn, camera) {
    if (drawn === scene) log.push(['prepass', { override: scene.overrideMaterial?.colorWrite === false, background: scene.background, shown: [solid.visible, halo.visible, smoke.visible], gizmo: camera.layers.isEnabled(5), shadows: renderer.shadowMap.autoUpdate }]);
    else log.push(['quad', drawn.material.blending === THREE.CustomBlending ? 'composite' : 'pass', renderer.autoClear]);
  },
};
const settings = { strength: 0.8 };
const remove = installOcclusion(scene, settings);
const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
camera.layers.enable(5);
const mask = camera.layers.mask;
scene.onAfterRender(renderer, scene, camera);
assert.deepEqual(log.map(entry => entry[0] === 'target' ? entry[1] : entry[0] === 'quad' ? `${entry[1]}:${entry[2]}` : entry[0]),
  ['960x540', 'prepass', '960x540', 'pass:true', '960x540', 'pass:true', 'export', 'composite:false'], 'half-resolution prepass, occlusion, blur, then a multiply into the frame just drawn');
assert.deepEqual(log[1][1], { override: true, background: null, shown: [true, false, false], gizmo: false, shadows: false }, 'the prepass: depth only, no sky, no halos or see-through parts, no editor layer, no shadow re-render');
assert.deepEqual([scene.background, scene.overrideMaterial, solid.visible, halo.visible, smoke.visible, camera.layers.mask, renderer.autoClear, renderer.shadowMap.autoUpdate, current],
  [background, null, true, true, true, mask, true, true, output], 'everything is put back');
for (const [label, skip] of [['an override material (outline prepass, depth/normal plates)', () => { scene.overrideMaterial = new THREE.MeshNormalMaterial(); }],
  ['an orthographic camera (the plan)', () => {}], ['strength 0', () => { settings.strength = 0; }]]) {
  log.length = 0;
  skip();
  scene.onAfterRender(renderer, scene, label.startsWith('an ortho') ? new THREE.OrthographicCamera() : camera);
  assert.deepEqual(log, [], `skipped for ${label}`);
  scene.overrideMaterial = null;
}
settings.strength = 0.8;
log.length = 0;
current = null;
renderer.getCurrentViewport = v => v.set(0, 0, 800, 450);
scene.onAfterRender(renderer, scene, camera);
assert.deepEqual(log.filter(entry => entry[0] !== 'prepass' && entry[0] !== 'quad').map(entry => entry[1] ?? entry[0]), ['800x450', '800x450', '800x450', 'canvas', 'viewport'],
  'a canvas pane up to 960 px runs at full size and takes its own viewport back before the multiply');
remove();
assert.equal(Object.hasOwn(scene, 'onAfterRender'), false, 'removing the pass takes the hook off');
console.log('PASS occlusion hook: prepass/occlusion/blur/multiply order, what the prepass leaves out, state restored, skips, removal');
