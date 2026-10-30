// #742: the Top View is a 2D data diagram computed from editor state. The
// layout (transform + primitives) is asserted directly; the painter is run on a
// recording context to prove it draws every primitive without a canvas.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSceneObject } from '../src/scene-objects.js';
import { createCharacterEntry } from '../src/scenes.js';
import { createShot } from '../src/cuts.js';
import { drawPlanDiagram, planDiagramLayout, PLAN_DIAGRAM } from '../src/plan-diagram.js';

const aim = (pos, at) => ({ pos, yaw: Math.atan2(-(at.x - pos.x), -(at.z - pos.z)), pitch: Math.atan2(at.y - pos.y, Math.hypot(at.x - pos.x, at.z - pos.z)), fovDeg: 40 });
const A = { x: -1, y: 1.5, z: 0 }, B = { x: 1, y: 1.5, z: 0 };
// Ann and Ben 2 m apart facing each other, a table between the master camera and
// Ann, and three shots: master (S1), OTS on Ben (S2), OTS on Ann (S3).
function fixture() {
  const shots = [
    createShot('Master', 0, 23, [{ frame: 0, framing: aim({ x: 0, y: 1.6, z: 5 }, { x: 0, y: 1, z: 0 }) }]),
    createShot('OTS A', 24, 47, [{ frame: 24, framing: aim({ x: -2, y: 1.6, z: 0.6 }, B) }]),
    createShot('OTS B', 48, 71, [{ frame: 48, framing: aim({ x: 2, y: 1.6, z: 0.6 }, A) }]),
  ];
  const state = { frame: 0, frameCount: 72, camera: null,
    objects: [{ ...createSceneObject('cube'), id: 'table', name: 'Table', x: -0.5, z: 2.5, scaleX: 1.2, scaleY: 2, scaleZ: 0.8, rot: 30 }],
    characters: [createCharacterEntry({ id: 'ann', subject: 'Ann', x: -1, z: 0, rot: 90 }), createCharacterEntry({ id: 'ben', subject: 'Ben', x: 1, z: 0, rot: -90 })],
    shotDocument: { shots } };
  const ports = { bounds: ({ entity }) => entity.renderer
    ? { min: { x: entity.x - 0.6, y: 0, z: entity.z - 0.4 }, max: { x: entity.x + 0.6, y: 2, z: entity.z + 0.4 } }
    : { min: { x: entity.x - 0.25, y: 0, z: entity.z - 0.15 }, max: { x: entity.x + 0.25, y: 1.8, z: entity.z + 0.15 } } };
  return { state, ports, shots };
}
const of = (layout, kind) => layout.primitives.filter(p => p.kind === kind);

test('plan diagram: cast, set piece, every shot camera, the action line and the blocked sight line', () => {
  const { state, ports, shots } = fixture(), layout = planDiagramLayout(state, { ports });
  assert.equal(of(layout, 'grid').length, 1);
  assert.deepEqual(of(layout, 'character').map(c => [c.id, c.label, c.x, c.z, c.radius]), [['ann', 'Ann', -1, 0, 0.3], ['ben', 'Ben', 1, 0, 0.3]]);
  assert.deepEqual(of(layout, 'character').map(c => c.facing), [{ x: 1, z: 0 }, { x: -1, z: 0 }], 'yaw 90 faces +X, yaw -90 faces -X');
  const [table] = of(layout, 'object');
  assert.equal(of(layout, 'object').length, 1);
  assert.equal(table.label, 'Table');
  const sides = [0, 1].map(i => Math.hypot(table.corners[i + 1].x - table.corners[i].x, table.corners[i + 1].z - table.corners[i].z));
  assert.deepEqual(sides.map(v => Math.round(v * 100) / 100), [1.2, 0.8], 'footprint width*scaleX by depth*scaleZ');
  const cameras = of(layout, 'camera');
  assert.deepEqual(cameras.map(c => [c.shotId, c.label, c.current]), [[shots[0].id, 'S1', true], [shots[1].id, 'S2', false], [shots[2].id, 'S3', false]]);
  assert.deepEqual(cameras[0].position, { x: 0, z: 5 });
  const reach = Math.hypot(cameras[0].frustum[0].x - 0, cameras[0].frustum[0].z - 5);
  assert.ok(Math.abs(reach - PLAN_DIAGRAM.frustumM) < 1e-3, `frustum is ${PLAN_DIAGRAM.frustumM} m long`);
  assert.ok(cameras[0].frustum[0].z < 5 && cameras[0].frustum[1].z < 5, 'the master looks toward -Z, at the cast');
  assert.deepEqual(of(layout, 'actionLine').map(l => [l.subjectIds, l.distanceM, l.cameraSide]), [[['ann', 'ben'], 2, 'R']]);
  assert.equal(cameras[0].cameraSide, 'R', 'the current camera carries its side');
  assert.deepEqual(of(layout, 'occluder').map(o => [o.shotId, o.subjectId, o.byObjectId]), [[shots[0].id, 'ann', 'table']]);
  assert.deepEqual(of(layout, 'occluder')[0].segment, { from: { x: 0, z: 5 }, to: { x: -1, z: 0 } });
});

test('plan diagram: the current shot follows the playhead and the framing fits the content', () => {
  const { state, ports, shots } = fixture();
  state.frame = 30;
  const layout = planDiagramLayout(state, { ports, width: 1280, height: 720 });
  assert.deepEqual(of(layout, 'camera').filter(c => c.current).map(c => c.label), ['S2']);
  assert.deepEqual(of(layout, 'occluder'), [], 'the OTS looks past the table');
  assert.equal(of(layout, 'actionLine')[0].shotId, shots[1].id);
  // Content spans x -2..2 and z 0..5 (plus the table), margin 1.5 m, 16:9.
  const { view } = layout;
  assert.ok(view.minX <= -2 - PLAN_DIAGRAM.marginM && view.maxX >= 2 + PLAN_DIAGRAM.marginM);
  assert.ok(view.minZ <= -PLAN_DIAGRAM.marginM && view.maxZ >= 5 + PLAN_DIAGRAM.marginM);
  assert.ok(Math.abs((view.maxX - view.minX) / (view.maxZ - view.minZ) - 1280 / 720) < 1e-9, 'keeps the output aspect');
  const [px, py] = layout.toPixel({ x: view.minX, z: view.minZ }), [qx, qy] = layout.toPixel({ x: view.maxX, z: view.maxZ });
  assert.deepEqual([px, py].map(Math.round), [0, 0]);
  assert.deepEqual([qx, qy].map(Math.round), [1280, 720]);
  // A far-away prop is capped at 30 m.
  state.objects.push({ ...createSceneObject('cube'), id: 'far', x: 200, z: 0 });
  const far = planDiagramLayout(state, { ports });
  assert.ok(far.view.maxX - far.view.minX <= PLAN_DIAGRAM.maxSpanM + 1e-9);
  assert.ok(far.view.minX <= -2 && far.view.maxX >= 2 && far.view.minZ <= 0 && far.view.maxZ >= 5, 'a capped view stays on the cast and cameras');
  // A ground plane under everything is drawn first, so the props stay on top.
  state.objects.push({ ...createSceneObject('plane'), id: 'ground', x: 0, z: 0, scaleX: 20, scaleZ: 20 });
  assert.deepEqual(of(planDiagramLayout(state, { ports }), 'object').map(o => o.id), ['ground', 'far', 'table']);
  // Hidden cast and props are left out; one character draws no action line.
  state.objects = []; state.characters[1] = { ...state.characters[1], hidden: true };
  const lone = planDiagramLayout(state, { ports });
  assert.equal(of(lone, 'character').length, 1);
  assert.equal(of(lone, 'actionLine').length, 0);
});

test('plan diagram: the painter draws on a recording context', () => {
  const { state, ports } = fixture(), calls = [];
  const ctx = new Proxy({}, { get: (target, key) => key in target ? target[key] : (...args) => { calls.push([key, ...args]); }, set: (target, key, value) => { target[key] = value; return true; } });
  const layout = drawPlanDiagram(ctx, state, { ports, width: 640, height: 360 });
  const texts = calls.filter(c => c[0] === 'fillText').map(c => c[1]);
  for (const label of ['Ann', 'Ben', 'Table', 'S1 (R)', 'S2', 'S3', '2.00 m', 'x 0', 'z 0', 'character', 'object', 'action line']) assert.ok(texts.includes(label), `draws "${label}": ${JSON.stringify(texts)}`);
  assert.ok(calls.some(c => c[0] === 'setLineDash' && c[1].length), 'the action line is dashed');
  assert.equal(layout.width, 640);
});
