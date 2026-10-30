// motion.compile { install: "ifClean" } through the real command bus and motion layer: a dirty
// compile leaves the take and the undo history alone; a clean one installs in the same compile,
// and one undo brings the previous take back.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { motionFixture } from './motion-fixture.mjs';
import { skeletonFor } from '../../src/motion3/rigs/index.js';
import { specIdOf } from '../../src/motion3/spec-store.js';

const ok = receipt => { assert.equal(receipt.ok, true, JSON.stringify(receipt)); return receipt; };

function walkSpec(model, frames) {
	const sk = skeletonFor(model), I = sk.index, P = sk.restWorldPos, ank = P[I.LeftFoot][1];
	return { schema: 'cozyclay.motion-spec.v1', fps: 24, frames,
		keys: [{ f: 0, set: { root: [0, P[I.Hips][1] - 0.01, 0], yaw: 0, foot_l: [0.09, ank, -0.03], foot_r: [-0.09, ank, 0.03], fyaw_l: 0, fyaw_r: 0 } }],
		generators: [{ type: 'walk', f0: 6, steps: 4, heading: [0, 0] }] };
}

test('install ifClean: a dirty compile adds no history; a clean one installs and one undo restores the previous take', () => {
	const f = motionFixture();
	try {
		const model = f.cast.read().find(row => row.id === 'actor-a').model;
		const compile = args => ok(f.run('motion.compile', { characterId: 'actor-a', ...args }, 'agent'));
		const first = compile({ spec: walkSpec(model, 120) });
		const firstId = first.output.specId;
		assert.equal(specIdOf(f.motion.motionFor('actor-a').spec), firstId);

		const missed = { ...walkSpec(model, 130), goals: [{ name: 'hand at head', near: ['joint:LeftHand', 'joint:Head'], tol: 0.02, at: 60 }] };
		const dirty = compile({ spec: missed, install: 'ifClean' });
		assert.equal(dirty.output.qa.ok, false);
		assert.equal(dirty.output.installed, false);
		assert.deepEqual(dirty.affectedIds.filter(id => id === 'actor-a'), [], 'a take that was not installed is not an affected id');
		assert.equal(specIdOf(f.motion.motionFor('actor-a').spec), firstId, 'the take is unchanged');

		const clean = compile({ spec: walkSpec(model, 140), install: 'ifClean' });
		assert.equal(clean.output.qa.ok, true, JSON.stringify(clean.output.qa.groups?.slice(0, 2)));
		assert.equal(clean.output.installed, true);
		assert.ok(clean.affectedIds.includes('actor-a'));
		assert.equal(specIdOf(f.motion.motionFor('actor-a').spec), clean.output.specId, 'output.specId names the installed take');
		assert.equal(f.motion.motionFor('actor-a').frameCount, 140);

		const again = compile({ base: clean.output.specId, install: 'ifClean' });
		assert.equal(again.output.installed, true);
		assert.deepEqual(again.affectedIds.filter(id => id === 'actor-a'), [], 'the take already installed is left as it is');

		ok(f.run('edit.undo', {}, 'agent'));
		assert.equal(specIdOf(f.motion.motionFor('actor-a').spec), firstId, 'one undo restores the take before the ifClean install');
		ok(f.run('edit.undo', {}, 'agent'));
		assert.equal(f.motion.motionFor('actor-a'), null, 'the next undo removes the first install: the dirty and repeated compiles left no history entry');
	} finally { f.dispose(); }
});
