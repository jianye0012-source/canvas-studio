// A take that grabs and lifts a group (the cup Empty with its parts) survives a scene save ->
// load: the saved source keeps the scene the compile saw (scene.objects with each part's
// ancestors and their poses), and loading compiles it again into the same group-root track,
// bit for bit, with the same held frames. The parts have no tracks of their own.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { motionFixture } from './motion-fixture.mjs';
import { createCharacterEntry } from '../../src/scenes.js';
import { savedTakeSource } from '../../src/domains/motion/take-source.js';

const ok = receipt => { assert.equal(receipt.ok, true, JSON.stringify(receipt)); return receipt; };

// The cup scene of test/motion3/fixtures/cup-scene.mjs, built through the object commands.
function buildCupScene(f) {
	const byName = name => f.store.current.objects.find(o => o.name === name);
	const add = (kind, name, parent, set) => {
		ok(f.run('object.add', { kind, name, ...(parent ? { parent: byName(parent).id } : {}), placement: { x: set.x, z: set.z } }, 'agent'));
		ok(f.run('object.update', { id: byName(name).id, patch: set }, 'agent'));
	};
	add('empty', 'Table', null, { x: 0, y: 0, z: 1 });
	add('cube', 'Table Top', 'Table', { x: 0, y: 0.71, z: 1, scaleX: 1.2, scaleY: 0.04, scaleZ: 0.8 });
	add('empty', 'Cup', 'Table', { x: 0.2, y: 0.75, z: 0.85 });
	add('cylinder', 'Cup Body', 'Cup', { x: 0.2, y: 0.75, z: 0.85, scaleX: 0.08, scaleY: 0.1, scaleZ: 0.08 });
	add('cube', 'Cup Handle', 'Cup', { x: 0.268, y: 0.77, z: 0.85, scaleX: 0.012, scaleY: 0.06, scaleZ: 0.015 });
	return { cup: byName('Cup').id, handle: byName('Cup Handle').id, body: byName('Cup Body').id };
}

const liftSpec = ({ cup, handle }) => ({ schema: 'cozyclay.motion-spec.v1', fps: 24, frames: 100,
	use: [{ skill: 'standIdle', args: { at: [0.15, 0.3], heading: 0 }, f0: 0 }],
	props: { grip: { hand: 'l', origin: ['LeftHandIndex2', 'LeftHandMiddle2'], points: { fingers: [0, 0, 0] } } },
	anchors: { cupHandle: { kind: 'object', object: handle, local: [0, 0.03, 0] } },
	fits: [{ side: 'l', anchor: 'cupHandle', effector: { prop: 'grip', point: 'fingers' } }],
	keys: [{ f: 10, set: { pitch: 0, armw_l: 0, w_cupHandle_l: 0 } }, { f: 30, set: { pitch: 25, armw_l: 1, w_cupHandle_l: 1, hand_l: [0.3, 1, 0.7] } },
		{ f: 36, set: { w_cupHandle_l: 1, pitch: 25, hand_l: [0.3, 1, 0.7] } }, { f: 60, set: { w_cupHandle_l: 0, pitch: 10, hand_l: [0.3, 1.2, 0.6] } }, { f: 99, set: {} }],
	objects: { [cup]: { prop: 'grip', grab: 34, release: 80 } } });

test('take v3: a grabbed group reloads to the same group-root track', () => {
	const f = motionFixture();
	try {
		const ids = buildCupScene(f);
		ok(f.run('motion.compile', { characterId: 'actor-a', spec: liftSpec(ids) }, 'agent'));
		const installed = f.motion.motionFor('actor-a');
		assert.deepEqual(Object.keys(installed.objects), [ids.cup], 'one track, on the group root');
		const track = installed.objects[ids.cup];
		assert.ok(track.pos[70 * 3 + 1] - track.pos[1] > 0.1, 'the cup group is lifted');
		assert.equal(track.hold[33], 0); assert.equal(track.hold[34], 1); assert.equal(track.hold[81], 0);
		const saved = JSON.parse(JSON.stringify(f.cast.read().map(row => ({ ...row, motionTake: savedTakeSource(f.motion.layer(row.id).take) }))));
		const parts = saved[0].motionTake.scene.objects;
		assert.deepEqual(parts[ids.body].ancestors.slice(0, 1), [ids.cup], 'the saved scene keeps the part under its group');
		// The cup moves after the save: the reload still compiles against the scene the take was made in.
		ok(f.run('object.update', { id: ids.cup, patch: { x: 3 } }, 'agent'));
		f.motion.load(f.motion.sceneSlice({ cast: saved.map((row, index) => createCharacterEntry(row, index)) }));
		const restored = f.motion.motionFor('actor-a');
		assert.notEqual(restored, installed, 'the take was compiled again, not reused');
		assert.deepEqual(Object.keys(restored.objects), [ids.cup]);
		for (const key of ['pos', 'quat', 'hold']) assert.deepEqual([...restored.objects[ids.cup][key]], [...track[key]], `${key} identical after reload`);
		assert.deepEqual([...restored.rot], [...installed.rot], 'bones identical after reload');
	} finally { f.dispose(); }
});
