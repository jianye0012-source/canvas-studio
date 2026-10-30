// A compiled take v3 survives undo/redo and a scene save -> load: the motion layer keeps the
// take's source (spec, placement, the scene objects it reads), and loading compiles it again
// into the same bones.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { motionFixture } from './motion-fixture.mjs';
import { createCharacterEntry } from '../../src/scenes.js';
import { savedTakeSource } from '../../src/domains/motion/take-source.js';
import { skeletonFor } from '../../src/motion3/rigs/index.js';
import { fk } from '../../src/motion3/compiler/skeleton.js';

const ok = receipt => { assert.equal(receipt.ok, true, JSON.stringify(receipt)); return receipt; };
const FRAMES = [0, 17, 48, 95, 119];

function walkSpec(model) {
	const sk = skeletonFor(model), I = sk.index, P = sk.restWorldPos, ank = P[I.LeftFoot][1];
	return { schema: 'cozyclay.motion-spec.v1', fps: 24, frames: 120,
		keys: [{ f: 0, set: { root: [0, P[I.Hips][1] - 0.01, 0], yaw: 0, foot_l: [0.09, ank, -0.03], foot_r: [-0.09, ank, 0.03], fyaw_l: 0, fyaw_r: 0 } },
			{ f: 100, set: { head_yaw: 20 } }],
		generators: [{ type: 'walk', f0: 6, steps: 4, heading: [0, 20] }] };
}

// World joint positions of the take at a frame, from its local rotations and hips (FK).
function bonesAt(take, f) {
	const sk = skeletonFor(take.rig), B = take.bones.length;
	const quats = Array.from({ length: B }, (_, b) => Array.from(take.rot.subarray((f * B + b) * 4, (f * B + b) * 4 + 4)));
	return fk(sk, quats, Array.from(take.hips.subarray(f * 3, f * 3 + 3))).P;
}
function assertSameBones(actual, expected, label) {
	assert.equal(actual?.schema, 'cozyclay.take.v3', `${label}: no take v3`);
	assert.equal(actual.frameCount, expected.frameCount, `${label}: frame count`);
	assert.deepEqual(actual.placement, expected.placement, `${label}: placement`);
	let worst = 0;
	for (const f of FRAMES) {
		const a = bonesAt(actual, f), b = bonesAt(expected, f);
		for (let j = 0; j < a.length; j++) worst = Math.max(worst, Math.hypot(a[j][0] - b[j][0], a[j][1] - b[j][1], a[j][2] - b[j][2]));
	}
	assert.ok(worst < 1e-9, `${label}: bones moved by ${worst} m`);
	assert.deepEqual([...actual.rot], [...expected.rot], `${label}: local rotations`);
	assert.deepEqual([...actual.hips], [...expected.hips], `${label}: hips`);
}
const characterRow = f => f.cast.read().find(row => row.id === 'actor-a');

test('take v3: compile, then undo and redo restore the same take; motion.clear still clears it', () => {
	const f = motionFixture();
	try {
		const compiled = ok(f.run('motion.compile', { characterId: 'actor-a', spec: walkSpec(characterRow(f).model) }, 'agent'));
		const installed = f.motion.motionFor('actor-a');
		assert.equal(installed?.schema, 'cozyclay.take.v3');
		assert.equal(f.motion.layer('actor-a').take.source?.spec?.frames, 120, 'the layer keeps the spec, not only a resource id');
		assert.equal(f.motion.layer('actor-a').take.source.rot, undefined, 'the source holds no baked arrays');
		assert.equal(ok(f.run('edit.undo', { receiptId: compiled.receiptId }, 'agent')).status, 'undone');
		assert.equal(f.motion.motionFor('actor-a'), null, 'undo removes the take');
		ok(f.run('edit.redo', {}, 'agent'));
		assertSameBones(f.motion.motionFor('actor-a'), installed, 'redo');
		ok(f.run('motion.clear', { characterId: 'actor-a' }, 'agent'));
		assert.equal(f.motion.motionFor('actor-a'), null, 'motion.clear removes the take');
		assert.equal(f.motion.layer('actor-a').take, null);
	} finally { f.dispose(); }
});

test('take v3: a scene save -> load compiles the saved source into identical bones', () => {
	const f = motionFixture();
	try {
		ok(f.run('motion.compile', { characterId: 'actor-a', spec: walkSpec(characterRow(f).model) }, 'agent'));
		const installed = f.motion.motionFor('actor-a'), descriptor = f.motion.layer('actor-a').take;
		// What the stage envelope carries (App.jsx stageCharacters), through JSON and the scene normalizer.
		const saved = JSON.parse(JSON.stringify(f.cast.read().map(row => ({ ...row, motionTake: savedTakeSource(f.motion.layer(row.id).take) }))));
		assert.ok(saved[0].motionTake && !saved[1].motionTake, 'only the compiled character saves a take');
		assert.ok(JSON.stringify(saved[0].motionTake).length < 20_000, 'the saved take is a small JSON source');
		const cast = saved.map((row, index) => createCharacterEntry(row, index));
		assert.equal(cast[0].motionTake.takeId, descriptor.studioTakeId, 'the Studio take id survives the save');
		f.motion.load(f.motion.sceneSlice({ cast }));
		const restored = f.motion.motionFor('actor-a');
		assert.notEqual(restored, installed, 'the take was compiled again, not reused');
		assertSameBones(restored, installed, 'reload');
		assert.equal(restored.studioTakeId, descriptor.studioTakeId);
		assert.equal(f.motion.layer('actor-a').take.frames, 120);
		assert.equal(f.motion.motionFor('actor-b'), null);
		// The reloaded take is an ordinary layer take: clearing and undo work on it.
		const cleared = ok(f.run('motion.clear', { characterId: 'actor-a' }, 'agent'));
		assert.equal(f.motion.motionFor('actor-a'), null);
		ok(f.run('edit.undo', { receiptId: cleared.receiptId }, 'agent'));
		assertSameBones(f.motion.motionFor('actor-a'), installed, 'undo clear after reload');
	} finally { f.dispose(); }
});

test('take v3: a skill-built take with a searched open value and a scene object reloads to the same bones', () => {
	const f = motionFixture();
	try {
		ok(f.run('object.add', { kind: 'cube', name: 'Post', placement: { x: 0, z: 2.6 } }, 'agent'));
		const spec = { schema: 'cozyclay.motion-spec.v1', fps: 24, frames: 200,
			use: [{ skill: 'standIdle', f0: 0, args: { at: [0, 0], heading: 0 } }, { skill: 'walkTo', f0: 10, args: { heading: [0, { range: [-60, 60] }], steps: 6, turnDistance: 0.8 } }] };
		const compiled = ok(f.run('motion.compile', { characterId: 'actor-a', spec }, 'agent'));
		const installed = f.motion.motionFor('actor-a'), source = f.motion.layer('actor-a').take.source;
		assert.ok(compiled.output?.search, 'the compile searched the open heading');
		assert.equal(typeof source.spec.use[1].args.heading[1], 'number', 'the stored spec carries the chosen value, not the range');
		assert.ok(Object.values(source.scene.objects).some(box => box.name === 'Post'), 'the compile scene travels with the source');
		const saved = JSON.parse(JSON.stringify(f.cast.read().map(row => ({ ...row, motionTake: savedTakeSource(f.motion.layer(row.id).take) }))));
		// The post moves after the save: the reload still compiles against the scene the take was made in.
		ok(f.run('object.update', { id: f.store.current.objects.find(o => o.name === 'Post').id, patch: { x: 3 } }, 'agent'));
		f.motion.load(f.motion.sceneSlice({ cast: saved.map((row, index) => createCharacterEntry(row, index)) }));
		assertSameBones(f.motion.motionFor('actor-a'), installed, 'skill reload');
	} finally { f.dispose(); }
});

test('take v3: a malformed saved source is dropped by the scene normalizer', () => {
	assert.equal(createCharacterEntry({ id: 'a', motionTake: { schema: 'cozyclay.take.v3', rig: 'x-bot-tpose', spec: { schema: 'nope' } } }).motionTake, null);
	assert.equal(createCharacterEntry({ id: 'a' }).motionTake, null);
});
