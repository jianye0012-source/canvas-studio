// inspect_studio entity rows carry each object's world box, so an agent that builds an object
// from parts sees where every part ends: a rotated cylinder (pivot at its base) reaches one way
// only, and an empty that groups parts reports the union of their boxes. The per-turn context
// rows come from the same projection, and an action readback agrees with them.
import assert from 'node:assert/strict';
import { Euler, Vector3 } from 'three';
import { objectsFixture } from './objects-fixture.mjs';
import { validateStudioSchema, StudioSchemas } from '../../src/studio-agent-protocol.js';

const f = objectsFixture([]);
const arrange = ops => f.binding.handlers.arrange_objects(f.request('arrange_objects', { ops }));
const create = (name, kind, world, extra = {}) => ({ op: 'create', source: { kind }, name, position: { world }, ...extra });
const rowOf = name => f.objects.read().find(o => o.name === name);
const inspect = ids => f.binding.handlers.inspect_studio({ scope: 'entities', ids, limit: 24 }).entities;
const close = (a, b, label) => ['x', 'y', 'z'].forEach(k => {
  assert.ok(Math.abs(a.min[k] - b.min[k]) < 1e-3 && Math.abs(a.max[k] - b.max[k]) < 1e-3, `${label} ${k}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
});
/** Independent world AABB of a scene object row: its base-pivot local box, scaled, rotated (XYZ), moved. */
function expected(o) {
  const w = o.footprint.width * o.scaleX / 2, d = o.footprint.depth * o.scaleZ / 2, h = o.height * o.scaleY, D = Math.PI / 180;
  const euler = new Euler(o.rotX * D, o.rot * D, o.rotZ * D, 'XYZ');
  const pts = [-w, w].flatMap(x => [0, h].flatMap(y => [-d, d].map(z => new Vector3(x, y, z).applyEuler(euler).add(new Vector3(o.x, o.y, o.z)))));
  return { min: Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.min(...pts.map(p => p[k]))])), max: Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.max(...pts.map(p => p[k]))])) };
}
try {
  const made = arrange([
    create('Rifle', 'empty', { x: 1, y: 1, z: 2 }),
    create('Barrel', 'cylinder', { x: 1, y: 1.2, z: 2 }, { scale: { x: 0.05, y: 0.6, z: 0.05 }, rotationDeg: { x: 0, y: 0, z: 90 }, parent: 'Rifle' }),
    create('Receiver', 'cube', { x: 1.2, y: 1.1, z: 2 }, { scale: { x: 0.3, y: 0.1, z: 0.06 }, parent: 'Rifle' }),
  ]);
  assert.equal(made.status, 'applied', JSON.stringify(made).slice(0, 400));
  const [rifle, barrel, receiver] = ['Rifle', 'Barrel', 'Receiver'].map(rowOf);
  const rows = Object.fromEntries(inspect([rifle.id, barrel.id, receiver.id]).map(row => [row.id, row]));

  // 1. A rolled cylinder: its box is where the mesh is, reaching from the pivot toward -X only.
  const bb = rows[barrel.id].bounds;
  close(bb, expected(barrel), 'barrel');
  assert.ok(Math.abs(bb.max.x - barrel.x) < 1e-3 && bb.min.x < barrel.x - 0.5 * barrel.height * barrel.scaleY, `the rolled barrel reaches -X from its pivot: ${JSON.stringify(bb)}`);
  close(rows[receiver.id].bounds, expected(receiver), 'receiver');
  console.log('PASS a rotated cylinder row carries its world box, one-sided from the base pivot');

  // 2. The empty that groups them: the union of its parts' boxes, not a point at its pivot.
  const parts = [bb, rows[receiver.id].bounds];
  close(rows[rifle.id].bounds, { min: Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.min(...parts.map(b => b.min[k]))])), max: Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.max(...parts.map(b => b.max[k]))])) }, 'group');
  console.log('PASS an empty group row carries the union of its parts');

  // 3. A bodiless node with nothing under it has no box; the schema accepts every row.
  const lone = arrange([create('Marker', 'empty', { x: -3, y: 0, z: -3 })]);
  assert.equal(lone.status, 'applied');
  const all = f.binding.handlers.inspect_studio({ scope: 'entities', limit: 24 }).entities;
  assert.equal(all.find(row => row.name === 'Marker').bounds, null);
  for (const row of all) validateStudioSchema(StudioSchemas.StudioContextV1.properties.entities.items, row);
  console.log('PASS a lone empty has no box, and every row passes the entity schema');

  // 4. The per-turn context rows and an action readback show the same boxes as inspect.
  const context = f.binding.context().entities;
  for (const id of [rifle.id, barrel.id, receiver.id]) assert.deepEqual(context.find(row => row.id === id)?.bounds, rows[id].bounds, `context row ${id}`);
  const moved = arrange([{ op: 'update', id: rifle.id, name: 'Rifle 2' }]);
  assert.equal(moved.status, 'applied', JSON.stringify(moved).slice(0, 400));
  assert.deepEqual(moved.delta.find(d => d.id === rifle.id).after.bounds, inspect([rifle.id])[0].bounds, 'a group readback is its parts\' box, as inspect');
  console.log('PASS context rows and readback agree with inspect');
} finally {
  f.dispose();
}
