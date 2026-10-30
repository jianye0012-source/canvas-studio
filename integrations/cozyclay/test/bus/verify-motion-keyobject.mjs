// motion.keyObject (docs/motion-api-v3.1.md C14) through the real command bus and motion layer, on
// the baseball swing of session 294ac65a: a key on the carried bat is written into the installed
// take's spec, compiled and installed as one undo entry; removing the last key gives back the
// spec it started from; a hinged object takes its channel key; the refusals say why.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { motionFixture } from './motion-fixture.mjs';
import { specIdOf } from '../../src/motion3/spec-store.js';
import { SWING_SPEC, SWING_KEYS } from '../motion3/fixtures/bat-swing.mjs';

const ok = receipt => { assert.equal(receipt.ok, true, JSON.stringify(receipt).slice(0, 600)); return receipt; };
const refused = receipt => { assert.equal(receipt.ok, false, JSON.stringify(receipt).slice(0, 300)); return receipt.message; };

function batScene(f) {
	const byName = name => f.store.current.objects.find(o => o.name === name);
	const add = (kind, name, set) => {
		ok(f.run('object.add', { kind, name, placement: { x: set.x, z: set.z } }, 'agent'));
		ok(f.run('object.update', { id: byName(name).id, patch: set }, 'agent'));
		return byName(name).id;
	};
	return { bat: add('cylinder', 'Baseball Bat', { x: -0.4, y: 0, z: 0.3, scaleX: 0.06, scaleY: 0.84, scaleZ: 0.06 }),
		plate: add('cube', 'Home Plate', { x: 0, y: 0, z: 0.75, scaleX: 0.43, scaleY: 0.02, scaleZ: 0.43 }) };
}

test('motion.keyObject: keys the held bat, undoes as one entry, refuses where nothing holds it, keys a hinge channel', () => {
	const f = motionFixture();
	try {
		const { bat, plate } = batScene(f);
		const spec = structuredClone(SWING_SPEC);
		spec.objects = { [bat]: spec.objects.cylinder, [plate]: { pivot: [0, 0, 0.75], axis: [0, 1, 0], channel: 'plateTurn' } };
		spec.checks.allow = spec.checks.allow.map(a => ({ ...a, object: bat }));
		spec.goals = spec.goals.map(g => (g.moved ? { ...g, moved: `object:${bat}.center` } : g));
		const first = ok(f.run('motion.compile', { characterId: 'actor-a', spec }, 'agent')).output.specId;
		const take = () => f.motion.motionFor('actor-a'), keysOf = () => take().spec.objects[bat].keys?.map(k => k.f) ?? [];
		const key = (k, extra = {}) => f.run('motion.keyObject', { characterId: 'actor-a', objectId: bat, frame: k.f, ...(extra.remove ? {} : { pos: k.pos, rot: k.rot }), ...extra }, 'agent');

		const one = ok(key(SWING_KEYS[2]));
		assert.deepEqual(one.output.keyed, { objectId: bat, kind: 'carry', f: 47, keys: [47] });
		assert.equal(one.output.installed, true);
		assert.ok(one.affectedIds.includes('actor-a'));
		assert.equal(one.output.specId, specIdOf(take().spec), 'output.specId names the installed spec');
		assert.equal(typeof one.output.qa.ok, 'boolean');
		assert.deepEqual(take().spec.objects[bat].keys[0], SWING_KEYS[2], 'the key is stored as sent (rounded to 0.1 mm / 1e-5)');
		const at47 = Array.from(take().objects[bat].pos.subarray(47 * 3, 47 * 3 + 3));
		assert.ok(at47.every((v, i) => Math.abs(v - SWING_KEYS[2].pos[i]) < 1e-3), `the take draws the bat on its key: ${at47}`);

		ok(key(SWING_KEYS[0]));
		assert.deepEqual(keysOf(), [40, 47], 'keys stay sorted by frame');
		ok(f.run('edit.undo', {}, 'agent'));
		assert.deepEqual(keysOf(), [47], 'one undo removes one keyObject');
		ok(key({ ...SWING_KEYS[2], pos: [0.42, 1.17, 0.25] }));
		assert.deepEqual(take().spec.objects[bat].keys.map(k => k.pos), [[0.42, 1.17, 0.25]], 'a key at the same frame is replaced');

		const back = ok(key(SWING_KEYS[2], { remove: true }));
		assert.deepEqual(back.output.keyed, { objectId: bat, kind: 'carry', f: 47, removed: true, keys: [] });
		assert.equal(back.output.specId, first, 'removing the last key gives back the spec it started from');
		assert.equal(take().spec.objects[bat].keys, undefined);

		assert.match(refused(key(SWING_KEYS[2], { remove: true })), /has no key at f47; its keys: none/);
		assert.match(refused(key({ ...SWING_KEYS[2], f: 120 })), /frame 120 is outside the take \(0\.\.95\)/);
		assert.match(refused(f.run('motion.keyObject', { characterId: 'actor-a', objectId: bat, frame: 40 }, 'agent')), /needs pos \[x, y, z\] and rot \[x, y, z, w\]/);
		assert.match(refused(f.run('motion.keyObject', { characterId: 'actor-a', objectId: 'nope', frame: 40, pos: [0, 0, 0], rot: [0, 0, 0, 1] }, 'agent')),
			/"nope" is not in this take's spec\.objects .*drag it as a scene object/);
		ok(f.run('motion.compile', { characterId: 'actor-a', base: first, patch: [{ op: 'add', path: `/objects/${bat}/grab`, value: 30 }] }, 'agent'));
		assert.match(refused(key({ ...SWING_KEYS[0], f: 20 })), new RegExp(`"${bat}" is in hand only f30\\.\\.f95 \\(grab\\.\\.release\\); at f20 the take does not hold it`));

		// a hinge: the drawn rotation's turn about the hinge axis becomes the channel key
		const s30 = Math.sin(Math.PI / 12), c30 = Math.cos(Math.PI / 12);
		const hinge = ok(f.run('motion.keyObject', { characterId: 'actor-a', objectId: plate, frame: 10, pos: [9, 9, 9], rot: [0, s30, 0, c30] }, 'agent'));
		assert.deepEqual(hinge.output.keyed, { objectId: plate, kind: 'hinge', channel: 'plateTurn', f: 10, angle: 30 });
		assert.deepEqual(take().spec.keys.at(-1), { f: 10, set: { plateTurn: 30 } });
		const q = Array.from(take().objects[plate].quat.subarray(10 * 4, 10 * 4 + 4));
		assert.ok(Math.abs(q[1] - s30) < 1e-4 && Math.abs(q[3] - c30) < 1e-4, `the plate turns 30 deg at f10: ${q}`);
		ok(f.run('motion.keyObject', { characterId: 'actor-a', objectId: plate, frame: 0, angle: -15 }, 'agent'));
		assert.deepEqual(take().spec.keys[0].set.plateTurn, -15, 'a key already at that frame takes the channel');
		ok(f.run('edit.undo', {}, 'agent'));
		assert.equal(take().spec.keys[0].set.plateTurn, undefined, 'undo takes the hinge key back');
		assert.match(refused(f.run('motion.keyObject', { characterId: 'actor-a', objectId: plate, frame: 20, remove: true }, 'agent')), /has no key at f20; plateTurn is keyed at f10/);
	} finally { f.dispose(); }
});
